#!/usr/bin/env python3
"""bb_record.py - BLACKBOX machine: one boarding pass in, one filing.json out.

    python3 machine/bb_record.py --rec 4 --image pass.jpg --block-minutes 325 \
        --deadline 2026-12-01T07:30:00+08:00 --year 2026 [--aircraft B789] [--km N]
    python3 machine/bb_record.py --rec 4 --payload-file p.txt ...
    python3 machine/bb_record.py --deregister 4

Run from the repo root (or pass --root). Writes records/recNNN/filing.json
(public) and appends the leg to private/legs_private.json (gitignored, holds
the live payload, PNR and name). Prints no name, no PNR, no payload.
"""
import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import decode as dec  # noqa: E402

# lat, lon in degrees
AIRPORTS = {
    "DPS": (-8.7482, 115.1672), "TPE": (25.0777, 121.2328), "LAX": (33.9416, -118.4085),
    "MIA": (25.7959, -80.2870), "ORD": (41.9742, -87.9073), "JFK": (40.6413, -73.7781),
    "LGA": (40.7769, -73.8740), "FLL": (26.0726, -80.1527), "DFW": (32.8998, -97.0403),
    "GRR": (42.8808, -85.5228), "SFO": (37.6213, -122.3790), "NRT": (35.7720, 140.3929),
    "HND": (35.5494, 139.7798), "SIN": (1.3644, 103.9915), "HKG": (22.3080, 113.9185),
    "CGK": (-6.1256, 106.6559),
    # extras
    "AUS": (30.1945, -97.6699), "EWR": (40.6895, -74.1745), "ATL": (33.6407, -84.4277),
    "SEA": (47.4502, -122.3088), "DEN": (39.8561, -104.6737), "BOS": (42.3656, -71.0096),
    "ICN": (37.4602, 126.4407), "KUL": (2.7456, 101.7099), "BKK": (13.6900, 100.7501),
    "LAS": (36.0840, -115.1537), "MDW": (41.7868, -87.7522), "MCO": (28.4312, -81.3081),
}


def die(msg, code=1):
    print(f"ABORT: {msg}", file=sys.stderr)
    sys.exit(code)


def great_circle_km(a, b):
    for c in (a, b):
        if c not in AIRPORTS:
            die(f"unknown airport code {c}: add it to AIRPORTS or pass --km")
    (la1, lo1), (la2, lo2) = AIRPORTS[a], AIRPORTS[b]
    p1, p2 = math.radians(la1), math.radians(la2)
    dphi, dl = p2 - p1, math.radians(lo2 - lo1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return round(2 * 6371.0088 * math.asin(math.sqrt(h)))


def cap_for(block_minutes):
    """clamp(round(minutes/60), 1, 13), round half up, integer math."""
    return max(1, min(13, (2 * block_minutes + 60) // 120))


def price_wei(cap):
    """13e15 + 536e14 * (13 - cap) / 12, floored."""
    return 13 * 10**15 + (536 * 10**14 * (13 - cap)) // 12


def parse_ts(label, s, required_offset=True):
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        die(f"{label} is not ISO8601: {s!r}")
    if dt.tzinfo is None:
        die(f"{label} needs an explicit UTC offset (e.g. +08:00 or Z)")
    return dt.astimezone(timezone.utc)


def iso_utc(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def paths(root):
    return (os.path.join(root, "private", "legs_private.json"), os.path.join(root, "records"))


def load_legs(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        die("private/legs_private.json must be a JSON list")
    return data


def save_legs(path, legs):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(legs, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def check_ignored(root):
    """If root is a git repo, private/ must be gitignored before we write secrets."""
    try:
        inside = subprocess.run(["git", "-C", root, "rev-parse", "--is-inside-work-tree"],
                                capture_output=True, text=True)
    except FileNotFoundError:
        return
    if inside.returncode != 0:
        return
    r = subprocess.run(["git", "-C", root, "check-ignore", "-q", "private/legs_private.json"])
    if r.returncode != 0:
        die("private/ is not gitignored in this repo. Add 'private/' to .gitignore first.")


def keccak(b):
    from Crypto.Hash import keccak as _k
    k = _k.new(digest_bits=256)
    k.update(b)
    return k.digest()


def read_master_salt(root):
    p = os.path.join(root, "private", "salt.txt")
    try:
        txt = open(p, encoding="utf-8").read()
    except OSError:
        die("private/salt.txt is missing (32-byte master salt, one line, 0x-prefixed hex)")
    line = txt.strip()
    if "\n" in line or not re.fullmatch(r"0x[0-9a-fA-F]{64}", line):
        die("private/salt.txt is malformed: need one line, 0x + 64 hex chars")
    return bytes.fromhex(line[2:])


def rec_salt(master, rec):
    """recSalt = keccak256(masterSalt ++ uint256(rec) big-endian 32 bytes)."""
    return keccak(master + rec.to_bytes(32, "big"))


def salted_hash(payload, salt):
    """passHash = keccak256(payload UTF-8 bytes ++ recSalt), 0x hex."""
    return "0x" + keccak(payload.encode("utf-8") + salt).hex()


def verify(root, n):
    legs_path, rec_root = paths(root)
    leg = next((l for l in load_legs(legs_path) if l.get("rec") == n), None)
    if not leg:
        die(f"rec {n} is not in the private registry")
    try:
        filing = json.load(open(os.path.join(rec_root, f"rec{n:03d}", "filing.json")))
    except OSError:
        die(f"records/rec{n:03d}/filing.json not found")
    calc = salted_hash(leg["payload"], bytes.fromhex(leg["recSalt"][2:]))
    if calc == filing["passHash"] == leg["passHash"]:
        print(f"VERIFY OK rec {n}: recomputed passHash {calc} matches filing.json and registry")
        return
    die(f"VERIFY MISMATCH rec {n}: recomputed hash does not match filing.json/registry")


def deregister(root, n):
    legs_path, rec_root = paths(root)
    legs = load_legs(legs_path)
    rec_dir = os.path.join(rec_root, f"rec{n:03d}")
    if os.path.exists(os.path.join(rec_dir, "receipt.json")):
        die(f"rec {n} has a receipt.json: it is filed on chain, not a cancelled leg. Nothing changed.")
    kept = [l for l in legs if l.get("rec") != n]
    removed = len(legs) - len(kept)
    if removed:
        save_legs(legs_path, kept)
    if os.path.isdir(rec_dir):
        shutil.rmtree(rec_dir)
    print(f"deregistered rec {n}: {removed} private entry removed, "
          f"folder {'deleted' if not os.path.isdir(rec_dir) else 'kept'}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rec", type=int, help="explicit record number (never inferred)")
    ap.add_argument("--image")
    ap.add_argument("--payload-file")
    ap.add_argument("--block-minutes", type=int, help="scheduled block time, operator entered")
    ap.add_argument("--deadline", help="ISO8601 with offset: scheduled arrival plus buffer")
    ap.add_argument("--year", type=int, help="year of the flight")
    ap.add_argument("--window-open", help="ISO8601 with offset (default now)")
    ap.add_argument("--allow-past-open", action="store_true")
    ap.add_argument("--network", choices=("mainnet", "sepolia"), default="mainnet")
    ap.add_argument("--aircraft", default="")
    ap.add_argument("--km", type=int)
    ap.add_argument("--tz", default="Asia/Makassar")
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--deregister", type=int, metavar="N")
    ap.add_argument("--verify", type=int, metavar="REC",
                    help="recompute the salted hash from the registry and compare to filing.json")
    a = ap.parse_args()
    root = os.path.abspath(a.root)

    if a.deregister is not None:
        deregister(root, a.deregister)
        return

    if a.verify is not None:
        verify(root, a.verify)
        return

    missing = [n for n, v in (("--rec", a.rec), ("--block-minutes", a.block_minutes),
                              ("--deadline", a.deadline), ("--year", a.year)) if v is None]
    if missing:
        die("missing required: " + ", ".join(missing))
    if bool(a.image) == bool(a.payload_file):
        die("give exactly one of --image or --payload-file")
    if a.rec < 1:
        die("--rec must be >= 1")
    if a.block_minutes < 1:
        die("--block-minutes must be positive")
    if "|" in a.aircraft:
        die("--aircraft must not contain '|'")
    try:
        tz = ZoneInfo(a.tz)
    except Exception:
        die(f"unknown timezone {a.tz}")

    now = datetime.now(timezone.utc).replace(microsecond=0)
    w_open = parse_ts("--window-open", a.window_open) if a.window_open else now
    deadline = parse_ts("--deadline", a.deadline)
    if deadline <= w_open:
        die("deadline must be after window open")
    if a.window_open and w_open < now and not a.allow_past_open:
        die("--window-open is in the past; pass --allow-past-open if intended")

    # decode (never retype a payload)
    if a.payload_file:
        try:
            payload = dec.read_payload_file(a.payload_file)
        except (ValueError, OSError) as e:
            die(str(e))
    else:
        payload, _ = dec.decode_file(a.image)
        if not payload:
            die("NO DECODE. Retake the photo, or supply --payload-file.", 2)
    try:
        f = dec.parse_bcbp(payload, a.year)
    except ValueError as e:
        die(f"decoded but could not parse: {e}")
    check_ignored(root)
    salt = rec_salt(read_master_salt(root), a.rec)
    h = salted_hash(payload, salt)

    legs_path, rec_root = paths(root)
    legs = load_legs(legs_path)
    for l in legs:
        if l.get("payload") == payload and l.get("rec") != a.rec:
            die(f"this exact pass is already registered under rec {l.get('rec')}")
        if l.get("rec") == a.rec:
            die(f"rec {a.rec} already exists in the private registry")
    rec_dir = os.path.join(rec_root, f"rec{a.rec:03d}")
    if os.path.exists(rec_dir):
        die(f"records/rec{a.rec:03d} already exists")

    km = a.km if a.km is not None else great_circle_km(f["from"], f["to"])
    cap = cap_for(a.block_minutes)
    price = price_wei(cap)
    dossier = "|".join([f["from"], f["to"], f["date"], f["seat"], str(a.block_minutes),
                        str(km), a.aircraft])
    filing = {
        "rec": a.rec,
        "passHash": h,
        "blockMinutes": a.block_minutes,
        "windowOpen": iso_utc(w_open),
        "deadline": iso_utc(deadline),
        "cap": cap,
        "price": str(price),
        "allowPastOpen": bool(a.allow_past_open),
        "dossier": dossier,
        "network": a.network,
    }

    # private first, so a crash never leaves a public record without its preimage
    legs.append({"rec": a.rec, "payload": payload, "pnr": f["pnr"], "name": f["name"],
                 "recSalt": "0x" + salt.hex(), "carrier": f["carrier"], "flight": f["flight"], "date": f["date"],
                 "passHash": h})
    save_legs(legs_path, legs)
    os.makedirs(rec_dir)
    with open(os.path.join(rec_dir, "filing.json"), "w", encoding="utf-8") as fh:
        json.dump(filing, fh, indent=1)
        fh.write("\n")

    def both(dt):
        return f"{dt.strftime('%Y-%m-%d %H:%M')} UTC | {dt.astimezone(tz).strftime('%Y-%m-%d %H:%M %Z')} ({a.tz})"

    eth = (Decimal(price) / Decimal(10**18)).quantize(Decimal("0.000001"))
    print("=== PERMANENT: these values go on chain and cannot be changed ===")
    print(f"rec            {a.rec}")
    print(f"route          {f['from']}-{f['to']}  ({km} km)")
    print(f"date           {f['date']}")
    print(f"block minutes  {a.block_minutes}")
    print(f"cap            {cap}")
    print(f"price          {eth} ETH ({price} wei)")
    print(f"window open    {both(w_open)}")
    print(f"deadline       {both(deadline)}")
    print(f"allowPastOpen  {filing['allowPastOpen']}   network {a.network}")
    print(f"dossier        {dossier}")
    print(f"passHash       {h}")
    print(f"written        records/rec{a.rec:03d}/filing.json ; private registry updated")


if __name__ == "__main__":
    main()
