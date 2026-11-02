// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.24;

/*
  DITHERVOID // BLACKBOX :: the still image (the thumbnail marketplaces show).

  No text. A dim floor graticule, and the curtain: one band per sixth of its height, an ordered
  4x4 Bayer dither that grows denser toward the top, a sparse reflection below. Climb and
  descent come from the scheduled block minutes. The skew comes from the token seed, so every
  edition sits at its own angle. Sealed: greys. Declassified: the colours of the scheme the
  PANDORA engine rolls for the same seed (mulberry32, second draw), so the thumbnail and the
  live loop agree. Deployed by BLACKBOX's constructor; pure; holds nothing.
*/
contract BlackboxImage {
    /// 25 schemes x 3 colours (bands 0-1, 2-3, 4-5), RGB, in the engine's SCHEME_KEYS order.
    bytes private constant SCHEMES =
        hex"ff1f9c19f0ffbbff000a5d2b39ff1400ff00ff2a1aff7a00ff9b00ff5fc85fd0ffff00ff6a5cff19c6ff4400ff42424c8a8a96ff1f9caaff00eaff00ffff00ff2fd6ff71ceff00cc00aaff00ffee00ffffff9500ffd000ffde002eff9ec8ff2eff00ffb400ffff2fffff00ffff2e6aff7a2effb40000aa0000ff4100ff41690999e3058c4ab144ff00c80ea1f05dffffff00e000fa0086ffff644aaa3ec8190dffffff00c800ff005dffffff00ffff770000ff74ff0085ff00ff00ffff0000ffff000000ff001e152b722fcd99f8b5c200a20994ee00c3745529edef472bf1da2e";
    bytes private constant GREYS = hex"30303655555e7a7a86";
    bytes private constant B4 = hex"0008020a0c040e06030b01090f070d05";
    /// dots per 4x4 cell, per band: the curtain (0.25 + 0.7 * top fraction) and its reflection (x 0.22)
    bytes private constant MAIN = hex"06080a0c0e10";
    bytes private constant REFL = hex"020203030304";
    bytes16 private constant HEX = "0123456789abcdef";
    int256 private constant S = 1e6;

    struct Buf { bytes d; uint256 n; bytes id; }

    /// seed: the token seed (skew and colours). mins: one entry per curtain, left to right.
    function render(bool sealed_, uint32 seed, uint16[] calldata mins) external pure returns (bytes memory) {
        uint256 n = mins.length;
        require(n > 0, "none");
        Buf memory b = Buf(new bytes(15000 + 9000 * n), 0, _idOf(seed, sealed_));
        bytes memory cols = sealed_ ? GREYS : _scheme(seed);
        _w(b, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><defs>');
        bytes memory b4 = B4;
        bytes memory mainD = MAIN;
        bytes memory reflD = REFL;
        for (uint256 k = 0; k < 6; k++) {
            _pattern(b, "m", k, cols, k >> 1, uint8(mainD[k]), b4);
            _pattern(b, "r", k, cols, k >> 1, uint8(reflD[k]), b4);
        }
        _w(b, '</defs><rect width="1000" height="1000" fill="#000"/>');
        _floor(b);
        int256 skew = -90 + int256(uint256(seed % 61));
        /* detail falls with the number of curtains, so the journey's cost stays bounded (24 records max) */
        (uint256 K, uint256 B) = n == 1 ? (uint256(32), uint256(6)) : n <= 6 ? (uint256(16), uint256(6)) : n <= 12 ? (uint256(10), uint256(3)) : (uint256(6), uint256(3));
        for (uint256 i = 0; i < n; i++) {
            int256 xa = 170 + int256(660 * i / n);
            int256 xb = 170 + int256(660 * (i + 1) / n);
            _curtain(b, xa, xb, mins[i], skew, K, B);
        }
        _w(b, "</svg>");
        bytes memory out = b.d;
        uint256 len = b.n;
        assembly { mstore(out, len) }
        return out;
    }

    // ------------------------------------------------------------------ the roll
    /// mulberry32((seed ^ 0xC41E)), first draw discarded (the engine's mode), si = floor(second * 27).
    function schemeIndex(uint32 seed) public pure returns (uint256 si) {
        unchecked {
            uint32 a = seed ^ 0xC41E;
            uint32 r;
            for (uint256 i = 0; i < 2; i++) {
                a += 0x6D2B79F5;
                uint32 t = (a ^ (a >> 15)) * (1 | a);
                t = (t + ((t ^ (t >> 7)) * (61 | t))) ^ t;
                r = t ^ (t >> 14);
            }
            si = (uint256(r) * 27) >> 32;
        }
    }

    function _scheme(uint32 seed) private pure returns (bytes memory c) {
        uint256 si = schemeIndex(seed);
        if (si > 24) si = 0;                       // generated schemes: the DITHERVOID row
        c = new bytes(9);
        for (uint256 i = 0; i < 9; i++) c[i] = SCHEMES[si * 9 + i];
    }

    // ------------------------------------------------------------------ pieces
    function _pattern(Buf memory b, bytes1 kind, uint256 band, bytes memory cols, uint256 ci, uint8 dots, bytes memory b4) private pure {
        _w(b, '<pattern id="'); _w(b, b.id); _w(b, abi.encodePacked(kind, bytes1(uint8(48 + band))));
        _w(b, '" width="24" height="24" patternUnits="userSpaceOnUse">');
        bytes memory tail = abi.encodePacked('" width="6" height="6" fill="#', _hex(cols, ci), '"/>');
        for (uint256 i = 0; i < 16; i++) {
            if (uint8(b4[i]) >= dots) continue;
            _s(b, '<rect x="', 9); _num(b, int256((i % 4) * 6));
            _s(b, '" y="', 5); _num(b, int256((i >> 2) * 6));
            _w(b, tail);
        }
        _s(b, "</pattern>", 10);
    }

    function _floor(Buf memory b) private pure {
        for (int256 i = 0; i <= 12; i++) {
            int256 y = 560 + 30 * i + (6 * i * i) / 5;
            _line(b, 0, y, 1000, y - 60, uint256((i * 25) % 360));
        }
        for (int256 i = -6; i <= 16; i++) {
            int256 x = i * 80;
            _line(b, 500 + ((x - 500) * 35) / 100, 560, x, 1000, uint256((((i * 30 + 60) % 360) + 360) % 360));
        }
    }

    function _line(Buf memory b, int256 x1, int256 y1, int256 x2, int256 y2, uint256 hue) private pure {
        _s(b, '<line x1="', 10); _num(b, x1); _s(b, '" y1="', 6); _num(b, y1);
        _s(b, '" x2="', 6); _num(b, x2); _s(b, '" y2="', 6); _num(b, y2);
        _s(b, '" stroke="hsl(', 14); _num(b, int256(hue)); _s(b, ',70%,11%)" stroke-width="3"/>', 29);
    }

    function _curtain(Buf memory b, int256 xa, int256 xb, uint16 blockMin, int256 skew, uint256 K, uint256 B) private pure {
        int256 m = int256(uint256(blockMin == 0 ? 1 : blockMin));
        int256 c = _max(_min(300000, 22 * S / m), 160000);
        int256 d = _max(_min(350000, 32 * S / m), 200000);
        int256[] memory X = new int256[](K + 1);
        int256[] memory Y = new int256[](K + 1);
        int256[] memory H = new int256[](K + 1);
        for (uint256 k = 0; k <= K; k++) {
            int256 t = int256(k) * S / int256(K);
            X[k] = xa + (xb - xa) * int256(k) / int256(K);
            int256 u = ((xa - 170) * S * int256(K) + (xb - xa) * int256(k) * S) / (660 * int256(K));
            Y[k] = 600 * S + skew * (u - S / 2) * 6 / 10;
            int256 p = t < c ? t * S / c : (t > S - d ? (S - t) * S / d : S);
            if (p > S) p = S;
            if (p < 0) p = 0;
            H[k] = 330 * ((p * p / S) * (3 * S - 2 * p) / S);
        }
        for (uint256 band = 0; band < B; band++) {
            uint256 pi = (band + 1) * 6 / B - 1;          // with three bands: patterns 1, 3, 5, still densest at the top
            _poly(b, X, Y, H, int256(band), int256(B), -1, bytes1("m"), pi, K);
            _poly(b, X, Y, H, int256(band), int256(B), 1, bytes1("r"), pi, K);
        }
    }

    /// dir -1: the curtain, above the base line; dir 1: the reflection, 0.85 deep, below it.
    function _poly(Buf memory b, int256[] memory X, int256[] memory Y, int256[] memory H, int256 band, int256 nb, int256 dir, bytes1 kind, uint256 bi, uint256 K) private pure {
        int256 scale = dir < 0 ? int256(100) : int256(85);
        _s(b, '<polygon points="', 17);
        for (uint256 k = 0; k <= K; k++) _pt(b, X[k], Y[k] + dir * H[k] * scale / 100 * band / nb);
        for (uint256 j = 0; j <= K; j++) { uint256 k = K - j; _pt(b, X[k], Y[k] + dir * H[k] * scale / 100 * (band + 1) / nb); }
        _s(b, '" fill="url(#', 13); _w(b, b.id);
        _w(b, abi.encodePacked(kind, bytes1(uint8(48 + bi))));
        _s(b, ')"/>', 4);
    }

    function _pt(Buf memory b, int256 x, int256 yS) private pure {
        _num(b, x); _s(b, ",", 1); _num(b, (yS + S / 2) / S); _s(b, " ", 1);
    }

    // ------------------------------------------------------------------ the buffer
    function _w(Buf memory b, bytes memory s) private pure {
        uint256 n = b.n;
        bytes memory d = b.d;
        require(n + s.length <= d.length, "svg buffer");
        assembly { mcopy(add(add(d, 32), n), add(s, 32), mload(s)) }
        b.n = n + s.length;
    }

    /// a short literal (at most 32 bytes) without allocating it
    function _s(Buf memory b, bytes32 word, uint256 len) private pure {
        bytes memory d = b.d;
        uint256 n = b.n;
        require(n + 32 <= d.length, "svg buffer");
        assembly { mstore(add(add(d, 32), n), word) }
        b.n = n + len;
    }

    /// a signed integer in decimal, written in place (|v| < 1e7)
    function _num(Buf memory b, int256 v) private pure {
        bytes memory d = b.d;
        uint256 n = b.n;
        require(n + 32 <= d.length, "svg buffer");
        assembly {
            let p := add(add(d, 32), n)
            if slt(v, 0) { mstore8(p, 45) p := add(p, 1) n := add(n, 1) v := sub(0, v) }
            let len := 1
            for { let x := v } gt(x, 9) { x := div(x, 10) } { len := add(len, 1) }
            let e := add(p, len)
            for { let x := v } 1 {} {
                e := sub(e, 1)
                mstore8(e, add(48, mod(x, 10)))
                x := div(x, 10)
                if iszero(x) { break }
            }
            n := add(n, len)
        }
        b.n = n;
    }

    /// "b" + the seed in hex + "s" or "d": pattern ids that cannot collide when several images share a page
    function _idOf(uint32 seed, bool sealed_) private pure returns (bytes memory id) {
        id = new bytes(10);
        id[0] = "b";
        for (uint256 i = 0; i < 8; i++) id[1 + i] = HEX[(seed >> (28 - 4 * i)) & 15];
        id[9] = sealed_ ? bytes1("s") : bytes1("d");
    }

    function _hex(bytes memory cols, uint256 ci) private pure returns (bytes memory h) {
        h = new bytes(6);
        for (uint256 i = 0; i < 3; i++) {
            uint8 v = uint8(cols[ci * 3 + i]);
            h[2 * i] = HEX[v >> 4];
            h[2 * i + 1] = HEX[v & 15];
        }
    }

    function _min(int256 a, int256 b) private pure returns (int256) { return a < b ? a : b; }
    function _max(int256 a, int256 b) private pure returns (int256) { return a > b ? a : b; }
}
