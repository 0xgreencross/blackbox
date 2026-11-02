// SPDX-License-Identifier: CC0-1.0
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/*
  DITHERVOID // BLACKBOX. Greencross.

  The chain is the recorder. Every flight writes a record that cannot be amended.
  A record is filed at the boarding call: the keccak256 of the boarding pass payload,
  the scheduled block minutes, the window. Editions are minted only while the aircraft
  is in the air. At landing the window closes; supply that was not claimed never exists.

  The art is rendered from the chain alone. The PANDORA v3 engine is read from the
  fourteen code chunks that already hold it on Ethereum (the GLASS coat, fingerprinted
  below); the BLACKBOX scene and its typeface are stored here, then locked.

  Money: nothing is kept. Every wei received is forwarded to the treasury in the same
  transaction. The only exception is an auction refund that a bidder's wallet refused,
  held for that bidder to withdraw.
*/
contract BLACKBOX is ERC721, ERC2981, Ownable {
    using Strings for uint256;

    // ------------------------------------------------------------------ constants
    address public constant TREASURY = 0x2bCb25A1934D4696A0d733EF8f514095003C6a18;
    /// Royalty on resales, basis points, paid by marketplaces that honor EIP-2981. PENDING artist confirmation.
    uint96 public constant ROYALTY_BPS = 690;
    /// The PANDORA page in its three coats: the fourteen chunks' code hashes, chained in order (as GLASS).
    bytes32 public constant PAGE = 0x4b3ffe1cab65c035925ab5d4062e182ce781cbf90d045d8b057950493666f72f;
    uint16 public constant MAX_CAP = 13;
    uint256 public constant EXTENSION = 10 minutes;

    // ------------------------------------------------------------------ records
    struct Record {
        bytes32 passHash;
        uint64 windowOpen;
        uint64 deadline;
        uint64 landedAt;
        uint16 blockMinutes;
        uint16 cap;
        uint16 minted;
        uint128 price;
    }
    mapping(uint256 => Record) public records;
    mapping(uint256 => string) public dossierOf;
    mapping(bytes32 => bool) public hashUsed;
    uint256 public recordCount;
    uint256 public landedCount;
    /// Records 1..journeyCount make the complete journey. Fixed when the auction starts; filing then ends.
    uint256 public journeyCount;
    address public registrar;

    event Filed(uint256 indexed rec, bytes32 passHash, uint16 cap, uint128 price, uint64 windowOpen, uint64 deadline);
    event Landed(uint256 indexed rec, uint16 minted, uint16 cap, string dossier);
    event Minted(uint256 indexed rec, uint256 tokenId, address to, uint16 index);
    event RegistrarSet(address registrar);

    // ------------------------------------------------------------------ the 1/1
    struct Auction {
        uint64 start;
        uint64 end;
        uint128 reserve;
        uint128 highBid;
        address highBidder;
        bool settled;
    }
    Auction public auction;
    mapping(address => uint256) public pendingReturns;

    event AuctionStarted(uint64 start, uint64 end, uint128 reserve);
    event Bid(address indexed bidder, uint128 amount, uint64 end);
    event AuctionSettled(address winner, uint128 amount);
    event AuctionVoid(uint64 end);
    /// ERC-4906
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    // ------------------------------------------------------------------ engine, scene, font
    address[] private _engine;
    address[] private _scene;
    address[] private _font;
    bool public sceneLocked;

    error NotRegistrar();
    error Locked();
    error NotLocked();
    error BadRecord();
    error WindowClosed();
    error SoldOut();
    error WrongPrice();
    error AuctionState();
    error LowBid();
    error SendFailed();
    error BadDossier();

    modifier onlyRegistrar() {
        if (msg.sender != registrar) revert NotRegistrar();
        _;
    }

    constructor(address[] memory chunks_, address registrar_) ERC721("DITHERVOID // BLACKBOX", "BLACKBOX") Ownable(msg.sender) {
        bytes32 acc;
        for (uint256 i = 0; i < chunks_.length; i++) {
            require(chunks_[i].code.length > 1, "a chunk is missing");
            acc = keccak256(abi.encodePacked(acc, chunks_[i].codehash));
        }
        require(acc == PAGE, "not the page");
        _engine = chunks_;
        registrar = registrar_;
        _setDefaultRoyalty(TREASURY, ROYALTY_BPS);
        emit RegistrarSet(registrar_);
    }

    // ------------------------------------------------------------------ admin
    function setRegistrar(address r) external onlyOwner {
        registrar = r;
        emit RegistrarSet(r);
    }

    /* THE SCENE AND THE TYPEFACE ARE STORED ALREADY COATED, like the engine, so tokenURI only puts
       them together and never encodes them. scene = base64(base64(S)) where S is the scene script
       padded with trailing spaces to a multiple of 9 bytes; font = base64(base64(F)) where F is
       base64(TTF) padded with trailing spaces to a multiple of 9. scripts/coat.js makes both and
       checks them. Parts are stored as code (SSTORE2), at most 24,000 bytes each, in order. */
    function addScene(bytes calldata part) external onlyOwner {
        if (sceneLocked) revert Locked();
        _scene.push(_store(part));
    }

    function addFont(bytes calldata part) external onlyOwner {
        if (sceneLocked) revert Locked();
        _font.push(_store(part));
    }

    /// Irreversible. After this the art can never change. Filing requires it.
    function lockScene() external onlyOwner {
        if (sceneLocked) revert Locked();
        require(_scene.length > 0, "no scene");
        sceneLocked = true;
    }

    // ------------------------------------------------------------------ the recorder
    function capFor(uint16 blockMinutes) public pure returns (uint16) {
        uint256 c = (uint256(blockMinutes) + 30) / 60;
        if (c < 1) c = 1;
        if (c > MAX_CAP) c = MAX_CAP;
        return uint16(c);
    }

    function priceFor(uint16 cap) public pure returns (uint128) {
        require(cap >= 1 && cap <= MAX_CAP, "cap");
        return uint128(13e15 + (536e14 * uint256(MAX_CAP - cap)) / 12);
    }

    /// Filed at the boarding call, never on a schedule. The record number is explicit.
    function file(uint256 rec, bytes32 passHash, uint16 blockMinutes, uint64 windowOpen, uint64 deadline) external onlyRegistrar {
        if (!sceneLocked) revert NotLocked();
        if (auction.end != 0) revert AuctionState();
        if (rec != recordCount + 1) revert BadRecord();
        require(passHash != bytes32(0) && !hashUsed[passHash], "hash");
        require(blockMinutes > 0, "minutes");
        require(deadline > block.timestamp && deadline > windowOpen, "deadline");
        uint16 cap = capFor(blockMinutes);
        uint128 price = priceFor(cap);
        records[rec] = Record(passHash, windowOpen, deadline, 0, blockMinutes, cap, 0, price);
        hashUsed[passHash] = true;
        recordCount = rec;
        emit Filed(rec, passHash, cap, price, windowOpen, deadline);
    }

    /// The landing. Closes the window, fixes supply at what was claimed, declassifies.
    /// dossier = "FROM|TO|YYYY-MM-DD|SEAT|BLOCKMIN|KM|AIRCRAFT"
    function land(uint256 rec, string calldata dossier) external onlyRegistrar {
        Record storage r = records[rec];
        if (r.passHash == bytes32(0) || r.landedAt != 0) revert BadRecord();
        _checkDossier(bytes(dossier));
        r.landedAt = uint64(block.timestamp);
        dossierOf[rec] = dossier;
        landedCount += 1;
        emit Landed(rec, r.minted, r.cap, dossier);
        emit BatchMetadataUpdate(rec * 100 + 1, rec * 100 + (r.minted > 1 ? r.minted : 1));
        emit MetadataUpdate(0);
    }

    function mint(uint256 rec) external payable {
        Record storage r = records[rec];
        if (r.passHash == bytes32(0)) revert BadRecord();
        if (r.landedAt != 0 || block.timestamp < r.windowOpen || block.timestamp >= r.deadline) revert WindowClosed();
        if (r.minted >= r.cap) revert SoldOut();
        if (msg.value != r.price) revert WrongPrice();
        uint16 index = r.minted + 1;
        r.minted = index;
        uint256 tokenId = rec * 100 + index;
        _mint(msg.sender, tokenId);
        emit Minted(rec, tokenId, msg.sender, index);
        _forward(msg.value);
    }

    // ------------------------------------------------------------------ the complete journey, by English auction
    function startAuction(uint64 start, uint64 duration, uint128 reserve) external onlyOwner {
        if (auction.end != 0) revert AuctionState();
        require(recordCount > 0 && landedCount == recordCount && duration > 0, "auction");
        journeyCount = recordCount;
        auction = Auction(start, start + duration, reserve, 0, address(0), false);
        emit AuctionStarted(start, start + duration, reserve);
        emit MetadataUpdate(0);
    }

    function bid() external payable {
        Auction storage a = auction;
        if (a.end == 0 || a.settled || block.timestamp < a.start || block.timestamp >= a.end) revert AuctionState();
        if (msg.value < a.reserve || msg.value == 0) revert LowBid();
        if (a.highBid != 0 && msg.value * 100 < uint256(a.highBid) * 110) revert LowBid();
        address prev = a.highBidder;
        uint128 prevBid = a.highBid;
        a.highBidder = msg.sender;
        a.highBid = uint128(msg.value);
        if (a.end - block.timestamp < EXTENSION) a.end = uint64(block.timestamp + EXTENSION);
        emit Bid(msg.sender, uint128(msg.value), a.end);
        if (prev != address(0)) {
            (bool ok, ) = prev.call{value: prevBid, gas: 30000}("");
            if (!ok) pendingReturns[prev] += prevBid;
        }
    }

    function withdrawReturn() external {
        uint256 v = pendingReturns[msg.sender];
        pendingReturns[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: v}("");
        if (!ok) revert SendFailed();
    }

    function settleAuction() external {
        Auction storage a = auction;
        if (a.end == 0 || a.settled || block.timestamp < a.end) revert AuctionState();
        if (a.highBidder == address(0)) {
            /* no bids: the auction is void and can be started again; the journey stays frozen */
            emit AuctionVoid(a.end);
            delete auction;
            emit MetadataUpdate(0);
            return;
        }
        a.settled = true;
        emit AuctionSettled(a.highBidder, a.highBid);
        emit MetadataUpdate(0);
        _mint(a.highBidder, 0);
        _forward(a.highBid);
    }

    // ------------------------------------------------------------------ money
    receive() external payable { _forward(msg.value); }

    /// Filing depends on an owner having locked the scene; the contract is never left ownerless.
    function renounceOwnership() public pure override { revert("no renounce"); }

    function _forward(uint256 v) private {
        if (v == 0) return;
        (bool ok, ) = TREASURY.call{value: v}("");
        if (!ok) revert SendFailed();
    }

    // ------------------------------------------------------------------ seeds
    function seedOf(uint256 tokenId) public view returns (uint32) {
        if (tokenId == 0) return uint32(bytes4(keccak256(_landedHashes())));
        Record storage r = records[tokenId / 100];
        uint256 index = tokenId % 100;
        require(r.passHash != bytes32(0) && index >= 1 && index <= r.minted, "token");
        return uint32(bytes4(keccak256(abi.encodePacked(r.passHash, index))));
    }

    function _landedHashes() private view returns (bytes memory out) {
        for (uint256 i = 1; i <= journeyCount; i++) out = abi.encodePacked(out, records[i].passHash);
    }

    // ------------------------------------------------------------------ storage of code
    function _store(bytes calldata data) private returns (address p) {
        require(data.length > 0 && data.length <= 24000, "size");
        bytes memory code = abi.encodePacked(hex"00", data);
        bytes memory init = abi.encodePacked(hex"61", uint16(code.length), hex"80600a3d393df3", code);
        assembly { p := create(0, add(init, 32), mload(init)) }
        require(p != address(0), "store");
    }

    function _read(address[] storage parts) private view returns (bytes memory out) {
        uint256 total;
        for (uint256 i = 0; i < parts.length; i++) total += parts[i].code.length - 1;
        out = new bytes(total);
        uint256 off;
        for (uint256 i = 0; i < parts.length; i++) {
            address c = parts[i];
            uint256 n = c.code.length - 1;
            assembly { extcodecopy(c, add(add(out, 32), off), 1, n) }
            off += n;
        }
    }

    function engineChunks() external view returns (address[] memory) { return _engine; }
    function coat() public view returns (bytes memory) { return _read(_engine); }
    function scene() public view returns (bytes memory) { return _read(_scene); }
    function font() public view returns (bytes memory) { return _read(_font); }

    // ------------------------------------------------------------------ the token
    /* The HTML loader. The page is: PRE (the record object) | the typeface in base64 | MID (the start
       of the engine's unpacking) | the engine's gzip in base64 | T1 (the unpacking ends, the three engine
       cores are cut from the page by their literal markers) | the scene | T2. Every piece is padded with
       spaces so that base64 splits on whole groups at both depths: the large pieces are stored coated
       and only concatenated here. */
    string private constant H1 = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DITHERVOID // BLACKBOX</title><style>html,body{margin:0;background:#000;height:100%;overflow:hidden}</style></head><body><script>\nwindow.BB=';
    string private constant H2 = '\nwindow.BBF="';
    string private constant MID = '";\n</script><script>window.BBGO=(async()=>{var b=Uint8Array.from(atob("';
    string private constant T1 = '"),function(c){return c.charCodeAt(0)});\nvar d=new DecompressionStream("gzip"),w=d.writable.getWriter();w.write(b);w.close();\nvar h=await new Response(d.readable).text();\nfunction L(m){var i=h.indexOf("const "+m+"=\\"");if(i<0)throw new Error("core "+m);i+=m.length+7;var j=i+1;for(;;j++){var c=h.charCodeAt(j);if(c===92){j++;continue}if(c===34)break}return JSON.parse(h.slice(i,j+1))}\nvar a=h.indexOf("const CARD_CH=["),z=h.indexOf("]",a);\nreturn {V3_CORE:L("V3_CORE"),V3_CORE2:L("V3_CORE2"),V3_DRIVER:L("V3_DRIVER"),CARD_CH:JSON.parse(h.slice(a+14,z+1).split(String.fromCharCode(39)).join(String.fromCharCode(34)))};})();\n</script><script>\n';
    string private constant T2 = '\n</script></body></html>';

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        (bytes memory name_, bytes memory bbObj, bytes memory attrs, bytes memory svg, bool sealed_) = _meta(id);
        bytes memory pre = abi.encodePacked(H1, bbObj, ";", _spaces(bytes(H1).length + bbObj.length + 1 + bytes(H2).length), H2);
        bytes memory b64pre = bytes(Base64.encode(pre));
        bytes memory jsonHead = abi.encodePacked(
            '{"name":"', name_,
            '","description":"', _desc(id, sealed_),
            '","image":"data:image/svg+xml;base64,', Base64.encode(svg),
            '","animation_url":');
        bytes memory jh = abi.encodePacked(jsonHead, _spaces(jsonHead.length + 23 + b64pre.length), '"data:text/html;base64,', b64pre);
        bytes memory jsonTail = abi.encodePacked(Base64.encode(bytes(T2)), '","attributes":[', attrs, "]}");
        return string(abi.encodePacked(
            "data:application/json;base64,", Base64.encode(jh),
            font(), _coat2(bytes(MID)),
            coat(), _coat2(bytes(T1)),
            scene(), Base64.encode(jsonTail)));
    }

    /// base64(base64(x padded with spaces to a multiple of nine)): a constant piece of the page, coated.
    function _coat2(bytes memory x) private pure returns (bytes memory) {
        uint256 n = (9 - (x.length % 9)) % 9;
        bytes memory p = new bytes(x.length + n);
        for (uint256 i = 0; i < x.length; i++) p[i] = x[i];
        for (uint256 i = x.length; i < p.length; i++) p[i] = " ";
        return bytes(Base64.encode(bytes(Base64.encode(p))));
    }

    function _desc(uint256 id, bool sealed_) private pure returns (bytes memory) {
        if (id == 0) return "The complete journey: every landed record of the BLACKBOX recorder, combined. Rendered from the chain alone. Greencross.";
        if (sealed_) return "A flight in progress. The record is sealed: label and hash only, until landing. Rendered from the chain alone. Greencross.";
        return "A flight record, declassified at landing. Supply is what was claimed while the aircraft was in the air. Rendered from the chain alone. Greencross.";
    }

    function _meta(uint256 id) private view returns (bytes memory name_, bytes memory bb, bytes memory attrs, bytes memory svg, bool sealed_) {
        if (id == 0) {
            name_ = "DITHERVOID // BLACKBOX // THE COMPLETE JOURNEY";
            bb = abi.encodePacked('{"seed":', uint256(seedOf(0)).toString(), ',"rec":0,"index":0,"sealed":false,"state":"JOURNEY","label":"THE COMPLETE JOURNEY","records":', _journey(), '}');
            attrs = abi.encodePacked('{"trait_type":"STATE","value":"JOURNEY"},{"trait_type":"RECORDS","value":', journeyCount.toString(), '}');
            svg = _svg("THE COMPLETE JOURNEY", journeyCount.toString(), " RECORDS");
            return (name_, bb, attrs, svg, false);
        }
        uint256 rec = id / 100;
        uint256 index = id % 100;
        Record storage r = records[rec];
        sealed_ = r.landedAt == 0;
        string memory state = sealed_ ? "SEALED" : "DECLASSIFIED";
        string memory tf = sealed_ ? "true" : "false";
        bytes memory label = abi.encodePacked("REC ", _pad3(rec), " // ", _pad2(index));
        string memory hash = uint256(r.passHash).toHexString(32);
        name_ = abi.encodePacked("BLACKBOX ", label);
        bb = abi.encodePacked(
            '{"seed":', uint256(seedOf(id)).toString(),
            ',"rec":', rec.toString(), ',"index":', index.toString(),
            ',"cap":', uint256(r.cap).toString(), ',"minted":', uint256(r.minted).toString(),
            ',"sealed":', tf,
            ',"state":"', state,
            '","label":"', label, '","passHash":"', hash, '"');
        bb = abi.encodePacked(bb, sealed_ ? bytes("") : abi.encodePacked(',"dossier":"', dossierOf[rec], '"'), "}");
        attrs = abi.encodePacked(
            '{"trait_type":"REC","value":', rec.toString(), '},',
            '{"trait_type":"STATE","value":"', state, '"},',
            '{"trait_type":"HASH","value":"', hash, '"}');
        if (!sealed_) attrs = abi.encodePacked(attrs, _declassifiedAttrs(rec, r));
        svg = _svg(string(label), state, "");
    }

    function _declassifiedAttrs(uint256 rec, Record storage r) private view returns (bytes memory) {
        bytes[7] memory f = _split(bytes(dossierOf[rec]));
        return abi.encodePacked(
            abi.encodePacked(
                ',{"trait_type":"ROUTE","value":"', f[0], " > ", f[1], '"}',
                ',{"trait_type":"DATE","value":"', f[2], '"}',
                ',{"trait_type":"SEAT","value":"', f[3], '"}'),
            abi.encodePacked(
                ',{"trait_type":"BLOCK MINUTES","value":"', f[4], '"}',
                ',{"trait_type":"KM","value":"', f[5], '"}',
                ',{"trait_type":"AIRCRAFT","value":"', f[6], '"}'),
            abi.encodePacked(
                ',{"trait_type":"EDITION CAP","value":', uint256(r.cap).toString(), '}',
                ',{"trait_type":"MINTED","value":', uint256(r.minted).toString(), '}'));
    }

    function _journey() private view returns (bytes memory out) {
        out = "[";
        bool first = true;
        for (uint256 i = 1; i <= journeyCount; i++) {
            out = abi.encodePacked(out, first ? bytes("") : bytes(","), '{"rec":', i.toString(), ',"passHash":"', uint256(records[i].passHash).toHexString(32), '","dossier":"', dossierOf[i], '","minted":', uint256(records[i].minted).toString(), "}");
            first = false;
        }
        out = abi.encodePacked(out, "]");
    }

    function _svg(string memory label, string memory line2, string memory line2b) private pure returns (bytes memory) {
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#000"/>',
            '<g font-family="Menlo,Consolas,monospace" text-anchor="middle"><text x="500" y="440" font-size="26" letter-spacing="8" fill="#a0a0a0">DITHERVOID // BLACKBOX</text>',
            '<text x="500" y="530" font-size="56" letter-spacing="6" fill="#ffffff">', label, '</text>',
            '<text x="500" y="600" font-size="22" letter-spacing="4" fill="#55555e">', line2, line2b, '</text>',
            '<text x="500" y="940" font-size="18" letter-spacing="4" fill="#55555e">THE RECORD LIVES IN THE ANIMATION</text></g></svg>');
    }

    // ------------------------------------------------------------------ tiny libs
    /// Only A-Z a-z 0-9 | - . space, seven fields, at most 96 bytes: nothing can break the JSON or the HTML.
    function _checkDossier(bytes memory d) private pure {
        if (d.length == 0 || d.length > 96) revert BadDossier();
        uint256 bars;
        for (uint256 i = 0; i < d.length; i++) {
            bytes1 c = d[i];
            if (c == "|") { bars++; continue; }
            bool ok = (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-" || c == "." || c == " ";
            if (!ok) revert BadDossier();
        }
        if (bars != 6) revert BadDossier();
    }

    function _split(bytes memory d) private pure returns (bytes[7] memory f) {
        uint256 k;
        uint256 s;
        for (uint256 i = 0; i <= d.length; i++) {
            if (i == d.length || d[i] == "|") {
                bytes memory part = new bytes(i - s);
                for (uint256 j = 0; j < part.length; j++) part[j] = d[s + j];
                f[k++] = part;
                s = i + 1;
            }
        }
    }

    function _spaces(uint256 len) private pure returns (bytes memory) {
        uint256 n = (3 - (len % 3)) % 3;
        if (n == 0) return "";
        if (n == 1) return " ";
        return "  ";
    }

    function _pad3(uint256 v) private pure returns (bytes memory) {
        if (v < 10) return abi.encodePacked("00", v.toString());
        if (v < 100) return abi.encodePacked("0", v.toString());
        return bytes(v.toString());
    }

    function _pad2(uint256 v) private pure returns (bytes memory) {
        if (v < 10) return abi.encodePacked("0", v.toString());
        return bytes(v.toString());
    }

    function supportsInterface(bytes4 i) public view override(ERC721, ERC2981) returns (bool) {
        return i == 0x49064906 || super.supportsInterface(i);
    }
}
