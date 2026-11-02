#!/usr/bin/env python3
"""decode.py - boarding pass photo or PDF -> raw BCBP + parsed fields + commitment.

Library use:
    from decode import decode_file, parse_bcbp, pass_hash, rerender
CLI use (prints NO name, NO PNR, NO payload):
    python3 machine/decode.py pass.jpg --year 2026
    python3 machine/decode.py --payload-file payload.txt --year 2026 --rerender clean.png
    python3 machine/decode.py clean.png --year 2026

Accepts PDF417, QRCode, Aztec and DataMatrix. Only text starting with "M1"
(single-leg IATA BCBP) is accepted. Recovery sweep, cheap passes first:
crop sweep, 1x to 4x upscale, autocontrast, sharpen, median denoise, fixed
and Otsu and adaptive thresholds, three zxing binarizers, then a small
rotation sweep for angled photos. Stops at the first valid M1 hit.
"""
import argparse
import os
import sys
import tempfile
from datetime import date, timedelta

import numpy as np
from PIL import Image, ImageFilter, ImageOps

Image.MAX_IMAGE_PIXELS = None

import zxingcpp
from Crypto.Hash import keccak

try:
    import cv2
except Exception:  # pragma: no cover
    cv2 = None
try:
    from pyzbar import pyzbar as _pyzbar
except Exception:  # pragma: no cover
    _pyzbar = None

BF = zxingcpp.BarcodeFormat
WANT_FORMATS = (BF.PDF417, BF.QRCode, BF.Aztec, BF.DataMatrix)
MAX_SIDE = 5200  # cap on upscaled candidate size


# --------------------------------------------------------------------------
# hashing and parsing
# --------------------------------------------------------------------------
def pass_hash(payload: str) -> str:
    """keccak256 of the payload bytes (UTF-8, exactly as decoded), 0x hex."""
    k = keccak.new(digest_bits=256)
    k.update(payload.encode("utf-8"))
    return "0x" + k.hexdigest()


def julian_to_date(julian: int, year: int) -> date:
    d = date(year, 1, 1) + timedelta(days=julian - 1)
    if d.year != year:
        raise ValueError(f"julian day {julian} is not valid in {year}")
    return d


def parse_bcbp(s: str, year: int) -> dict:
    """Parse the IATA BCBP mandatory unique+repeated fields of a one-leg pass."""
    if not s.startswith("M1"):
        raise ValueError("not an M1 BCBP")
    if len(s) < 58:
        raise ValueError("BCBP too short for mandatory fields")
    julian_txt = s[44:47]
    if not julian_txt.isdigit():
        raise ValueError("julian date field is not numeric")
    julian = int(julian_txt)
    if not 1 <= julian <= 366:
        raise ValueError("julian date out of range")
    carrier = s[36:39].strip()
    number = s[39:44].strip()
    seat_raw = s[48:52]
    return {
        "format_code": s[0],
        "legs": int(s[1]),
        "name": s[2:22].strip(),
        "eticket": s[22],
        "pnr": s[23:30].strip(),
        "from": s[30:33],
        "to": s[33:36],
        "carrier": carrier,
        "flight_number": number,
        "flight": carrier + number,
        "julian": julian,
        "date": julian_to_date(julian, year).isoformat(),
        "compartment": s[47],
        "seat_raw": seat_raw,
        "seat": seat_raw.strip().lstrip("0"),
        "seq": s[52:57].strip().lstrip("0") or "0",
        "status": s[57],
    }


# --------------------------------------------------------------------------
# image loading
# --------------------------------------------------------------------------
def load_pages(path, dpi=300):
    """Yield PIL images: one for a photo, one per page for a PDF."""
    if path.lower().endswith(".pdf"):
        import pymupdf
        doc = pymupdf.open(path)
        for page in doc:
            pix = page.get_pixmap(dpi=dpi, alpha=False)
            yield Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        return
    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    yield img


# --------------------------------------------------------------------------
# candidate generation
# --------------------------------------------------------------------------
CROP_BOXES = [
    (0, 0, 1, 1),
    (0.70, 0, 1, 1), (0, 0.55, 1, 1), (0, 0, 1, 0.45), (0, 0, 0.30, 1),
    (0.5, 0.5, 1, 1), (0.5, 0, 1, 0.5), (0, 0.5, 0.5, 1), (0, 0, 0.5, 0.5),
    (0.25, 0.25, 0.75, 0.75), (0, 0.25, 1, 0.75), (0.25, 0, 0.75, 1),
]


def _crop(g, box):
    W, H = g.size
    return g.crop((int(W * box[0]), int(H * box[1]), int(W * box[2]), int(H * box[3])))


def _scaled(c, s):
    if s == 1:
        return c
    w, h = int(c.width * s), int(c.height * s)
    if max(w, h) > MAX_SIDE or min(w, h) < 40:
        return None
    return c.resize((w, h), Image.LANCZOS if s > 1 else Image.BOX)


def _preps(c, level):
    """Yield (tag, image) variants of a grayscale image."""
    yield "raw", c
    ac = ImageOps.autocontrast(c, cutoff=1)
    yield "ac", ac
    if level == 0:
        return
    yield "sharp", ac.filter(ImageFilter.SHARPEN)
    yield "median", ac.filter(ImageFilter.MedianFilter(3))
    for t in (96, 128, 160):
        yield f"thr{t}", ac.point(lambda p, t=t: 255 if p > t else 0)
    if cv2 is not None:
        a = np.array(ac)
        _, otsu = cv2.threshold(a, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        yield "otsu", Image.fromarray(otsu)
        blur = cv2.GaussianBlur(a, (3, 3), 0)
        for bs in (31, 71):
            ad = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                       cv2.THRESH_BINARY, bs, 10)
            yield f"adapt{bs}", Image.fromarray(ad)


def _read(img, binarizers):
    arr = np.array(img)
    for b in binarizers:
        try:
            res = zxingcpp.read_barcodes(arr, formats=list(WANT_FORMATS), binarizer=b,
                                         try_rotate=True, try_downscale=True)
        except TypeError:
            res = zxingcpp.read_barcodes(arr, binarizer=b, try_rotate=True, try_downscale=True)
        for r in res:
            if r.format in WANT_FORMATS and r.text.startswith("M1"):
                yield r.text, str(r.format).split(".")[-1]
    if _pyzbar is not None:
        try:
            for s in _pyzbar.decode(img):
                if s.type in ("QRCODE", "PDF417", "CODE128"):
                    t = s.data.decode("utf-8", "replace")
                    if t.startswith("M1"):
                        yield t, "pyzbar-" + s.type
        except Exception:
            pass


def _valid(text):
    try:
        parse_bcbp(text, 2024)
        return True
    except ValueError:
        return False


ANGLES = (-12, 12, -6, 6, -18, 18, -3, 3, -24, 24, -30, 30, -9, 9, -15, 15)


def decode_image(img):
    """Return (payload, info) or (None, None). info holds symbology and stage only."""
    g = img.convert("L")
    default_b = (zxingcpp.Binarizer.LocalAverage,)
    all_b = (zxingcpp.Binarizer.LocalAverage, zxingcpp.Binarizer.GlobalHistogram,
             zxingcpp.Binarizer.FixedThreshold)
    seen = set()

    def run(c, cid, scales, level, binarizers, stage):
        for s in scales:
            cs = _scaled(c, s)
            if cs is None:
                continue
            for tag, v in _preps(cs, level):
                key = (cid, s, tag, len(binarizers))
                if key in seen:
                    continue
                seen.add(key)
                for text, fmt in _read(v, binarizers):
                    if _valid(text):
                        return text, {"symbology": fmt, "stage": f"{stage}:{cid}:x{s}:{tag}"}
        return None

    big = max(g.size) > 3000
    # pass 0: quick, whole image and crops at native scale
    for i, box in enumerate(CROP_BOXES):
        r = run(_crop(g, box), i, (1,), 0, default_b, "quick")
        if r:
            return r
    # pass 0b: angled photos, cheap rotation sweep on the whole frame
    for ang in ANGLES:
        rot = g.rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=255)
        r = run(rot, f"rotq{ang}", (1,), 0, default_b, "rotate-quick")
        if r:
            return r
    # pass 1: crop sweep, 2x to 4x upscale (plus 0.5x for huge inputs), all preps and binarizers
    scales = (1, 2, 3, 4) + ((0.5,) if big else ())
    for i, box in enumerate(CROP_BOXES):
        r = run(_crop(g, box), i, scales, 1, all_b, "sweep")
        if r:
            return r
    # pass 2: rotation sweep for angled photos
    for ang in ANGLES:
        rot = g.rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=255)
        for i in (0, 1, 2, 4, 9):
            r = run(_crop(rot, CROP_BOXES[i]), f"rot{ang}_{i}", (1, 2, 3), 1,
                    default_b + (zxingcpp.Binarizer.GlobalHistogram,), "rotate")
            if r:
                return r
    return None, None


def decode_file(path):
    """Decode a photo or PDF. Returns (payload, info) or (None, None)."""
    for page_no, img in enumerate(load_pages(path), 1):
        text, info = decode_image(img)
        if text:
            info["page"] = page_no
            return text, info
    return None, None


# --------------------------------------------------------------------------
# payload file and clean re-render
# --------------------------------------------------------------------------
def read_payload_file(path):
    """Read a raw payload. Only trailing line breaks are removed; nothing else."""
    with open(path, "rb") as f:
        data = f.read().decode("utf-8")
    while data.endswith(("\n", "\r")):
        data = data[:-1]
    if not data.startswith("M1"):
        raise ValueError("payload file does not start with M1")
    return data


def rerender(payload, out_path, columns=10, scale=4):
    """Render a clean PDF417 of a known payload and verify it decodes back to it."""
    from pdf417gen import encode, render_image
    codes = encode(payload, columns=columns, security_level=4)
    img = render_image(codes, scale=scale, ratio=3, padding=40).convert("L")
    img.save(out_path)
    back, _ = decode_image(img)
    if back != payload:
        raise RuntimeError("clean re-render did not round-trip")
    return out_path


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", nargs="?", help="photo or PDF")
    ap.add_argument("--payload-file", help="read the raw payload from a file, skip imaging")
    ap.add_argument("--year", type=int, default=date.today().year, help="year of the flight")
    ap.add_argument("--rerender", metavar="OUT.png", help="write a clean PDF417 of the payload")
    a = ap.parse_args()

    try:
        if a.payload_file:
            payload, info = read_payload_file(a.payload_file), {"symbology": "file", "stage": "payload-file"}
        elif a.image:
            payload, info = decode_file(a.image)
        else:
            ap.error("give an image/PDF or --payload-file")
    except (ValueError, OSError) as e:
        print(f"ABORT: {e}", file=sys.stderr)
        return 1
    if not payload:
        print("NO DECODE. Retake flat, straight-on, even light, no gloss; or use --payload-file "
              "with a known payload and --rerender for a clean code.", file=sys.stderr)
        return 2
    try:
        f = parse_bcbp(payload, a.year)
    except ValueError as e:
        print(f"ABORT: decoded but could not parse: {e}", file=sys.stderr)
        return 1
    print(f"decoded via {info['symbology']} ({info['stage']})")
    print(f"route {f['from']}-{f['to']}  date {f['date']}  seat {f['seat']}  "
          f"compartment {f['compartment']}  status {f['status']}")
    print(f"passHash {pass_hash(payload)}")
    if a.rerender:
        rerender(payload, a.rerender)
        print(f"clean re-render written: {a.rerender} (contains the live payload, keep it private)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
