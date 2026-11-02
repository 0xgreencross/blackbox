#!/usr/bin/env python3
"""gate.py - pre-commit PII gate.

    python3 machine/gate.py [--paths a b ...] [--root DIR]

Scans every staged file (git diff --cached, content as staged) plus any
--paths for: PNRs and surname tokens from private/legs_private.json, full
payloads, and anything shaped like a BCBP start. Refuses staged paths under
private/ or source_scans/. Names the file and the kind of hit, never the
secret. Exit 1 on any hit, 0 if clean.

Install:  printf '#!/bin/sh\\npython3 machine/gate.py || exit 1\\n' > .git/hooks/pre-commit
          chmod +x .git/hooks/pre-commit
"""
import argparse
import json
import os
import re
import subprocess
import sys

FORBIDDEN_DIRS = ("private", "source_scans")
BCBP_RE = re.compile(r"(?<![A-Za-z0-9])M1[A-Z][A-Z0-9 /^<>.+\-]{19,}")


def git(root, *args):
    return subprocess.run(["git", "-C", root, *args], capture_output=True, check=True).stdout


def staged_files(root):
    out = git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    return [p for p in out.decode("utf-8", "surrogateescape").split("\0") if p]


def secrets(root):
    p = os.path.join(root, "private", "legs_private.json")
    pnrs, tokens, payloads = set(), set(), set()
    sp = os.path.join(root, "private", "salt.txt")
    if os.path.exists(sp):
        m = re.search(r"[0-9a-fA-F]{64}", open(sp, encoding="utf-8").read())
        if m:
            payloads.add(("salt", m.group(0).lower()))
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for leg in json.load(f):
                if leg.get("pnr"):
                    pnrs.add(leg["pnr"].strip().lower())
                for t in re.split(r"[/\s]+", leg.get("name", "")):
                    if len(t) >= 3:
                        tokens.add(t.lower())
                if leg.get("recSalt"):
                    payloads.add(("salt", leg["recSalt"][2:].lower()))
                if leg.get("payload"):
                    payloads.add(leg["payload"])
    return pnrs, tokens, payloads


def scan_text(label, text, pnrs, tokens, payloads):
    """Return the list of hit kinds for one text blob (name or content)."""
    low = text.lower()
    kinds = []
    if any(p in low for p in pnrs):
        kinds.append("PNR")
    if any(t in low for t in tokens):
        kinds.append("passenger surname/name token")
    if any(p in text for p in payloads if isinstance(p, str)):
        kinds.append("full BCBP payload")
    if any(p[1] in low for p in payloads if isinstance(p, tuple)):
        kinds.append("salt")
    if BCBP_RE.search(text):
        kinds.append("BCBP-shaped string (M1...)")
    return kinds


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--paths", nargs="*", default=[], help="extra files to scan from the worktree")
    ap.add_argument("--root", help="repo root (default: git toplevel of cwd)")
    a = ap.parse_args()
    try:
        root = a.root or git(os.getcwd(), "rev-parse", "--show-toplevel").decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("GATE: not inside a git repo", file=sys.stderr)
        return 2
    try:
        staged = staged_files(root)
    except subprocess.CalledProcessError:
        print("GATE: cannot list staged files", file=sys.stderr)
        return 2
    pnrs, tokens, payloads = secrets(root)

    problems = []
    targets = [(p, "staged") for p in staged] + [(p, "path") for p in a.paths]
    for path, origin in targets:
        norm = os.path.normpath(path).replace(os.sep, "/")
        if norm.split("/")[0] in FORBIDDEN_DIRS:
            problems.append((path, "forbidden location (private/ or source_scans/)"))
            continue
        for k in scan_text(path, path, pnrs, tokens, payloads):
            problems.append((path, f"{k} in the file NAME"))
        try:
            if origin == "staged":
                data = git(root, "show", f":{path}")
            else:
                with open(os.path.join(root, path) if not os.path.isabs(path) else path, "rb") as f:
                    data = f.read()
        except (subprocess.CalledProcessError, OSError):
            problems.append((path, "unreadable, cannot verify"))
            continue
        for k in scan_text(path, data.decode("latin-1"), pnrs, tokens, payloads):
            problems.append((path, f"{k} in content"))

    if problems:
        print("GATE: REFUSED. Commit blocked.", file=sys.stderr)
        for path, kind in problems:
            print(f"  {path}: {kind}", file=sys.stderr)
        return 1
    print(f"GATE: clean ({len(targets)} file(s) scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
