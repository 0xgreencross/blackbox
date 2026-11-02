#!/usr/bin/env python3
"""Tests for the BLACKBOX machine. SYNTHETIC passes only (invented names and PNRs).

    python3 machine/test_machine.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import decode as dec  # noqa: E402
import bb_record as bbr  # noqa: E402

try:
    from aztec_code_generator import AztecCode
except Exception:  # pragma: no cover
    AztecCode = None


def make_bcbp(name, pnr, frm, to, carrier, flight, julian, seat, seq, comp="Y"):
    s = ("M1" + name.ljust(20) + "E" + pnr.ljust(7) + frm + to + carrier.ljust(3)
         + flight.rjust(5) + f"{julian:03d}" + comp + seat.rjust(4, "0") + seq.rjust(5, "0") + "1" + "00")
    assert s[44:47].isdigit() and len(s) >= 58
    return s


PASSES = {
    "A": dict(name="DOE/JANE", pnr="ZZTEST", frm="DPS", to="TPE", carrier="BR", flight="0256",
              julian=335, seat="14A", seq="27"),
    "B": dict(name="ROE/RICHARD MR", pnr="QQDEMO", frm="LAX", to="MIA", carrier="AA", flight="0100",
              julian=340, seat="3C", seq="102"),
    "C": dict(name="SMYTHE/ALEXANDRA", pnr="XXFAKE", frm="ORD", to="GRR", carrier="UA", flight="4455",
              julian=60, seat="22F", seq="5"),
}
BCBP = {k: make_bcbp(**v) for k, v in PASSES.items()}


MASTER = "0x" + "11223344556677889900aabbccddeeff" * 2


def k256(b):
    from Crypto.Hash import keccak
    k = keccak.new(digest_bits=256)
    k.update(b)
    return k.digest()


def expected_hash(payload, rec):
    """Independent recomputation of the salted commitment."""
    salt = k256(bytes.fromhex(MASTER[2:]) + rec.to_bytes(32, "big"))
    return "0x" + k256(payload.encode() + salt).hex(), "0x" + salt.hex()


def canvas(code_img, size=(1500, 1000), pos=(700, 550)):
    c = Image.new("L", size, 255)
    c.paste(code_img.convert("L"), pos)
    return c


def pdf417_img(text):
    from pdf417gen import encode, render_image
    return render_image(encode(text, columns=8, security_level=3), scale=3, ratio=3, padding=25)


def qr_img(text):
    import qrcode
    q = qrcode.QRCode(border=4, box_size=6)
    q.add_data(text)
    q.make(fit=True)
    return q.make_image(fill_color="black", back_color="white").get_image()


def aztec_img(text):
    return AztecCode(text).image(module_size=6, border=4)


def noisy(img, std=14, seed=1):
    rng = np.random.default_rng(seed)
    a = np.array(img.convert("L")).astype(float) + rng.normal(0, std, (img.height, img.width))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


class DecodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def check(self, img, key, ext="png"):
        p = os.path.join(self.tmp, f"x.{ext}")
        img.save(p)
        text, info = dec.decode_file(p)
        self.assertEqual(text, BCBP[key], f"decode mismatch for {key}")
        return info

    def test_pdf417_qr_clean(self):
        self.check(canvas(pdf417_img(BCBP["A"])), "A")
        self.check(canvas(qr_img(BCBP["B"])), "B")
        self.check(canvas(pdf417_img(BCBP["C"])), "C", "jpg")

    @unittest.skipIf(AztecCode is None, "no aztec generator installed: Aztec test skipped")
    def test_aztec(self):
        self.check(canvas(aztec_img(BCBP["A"])), "A")

    def test_pdf_page(self):
        self.check(canvas(pdf417_img(BCBP["B"])), "B", "pdf")

    def test_rotated_12_with_noise_pdf417(self):
        img = canvas(pdf417_img(BCBP["A"])).rotate(12, resample=Image.BICUBIC, expand=True, fillcolor=255)
        self.check(noisy(img), "A")

    def test_rotated_12_with_noise_qr(self):
        img = canvas(qr_img(BCBP["C"])).rotate(12, resample=Image.BICUBIC, expand=True, fillcolor=255)
        self.check(noisy(img), "C")

    def test_non_m1_rejected(self):
        p = os.path.join(self.tmp, "n.png")
        qr_img("HELLO WORLD NOT A BOARDING PASS 1234567890").save(p)
        self.assertEqual(dec.decode_file(p), (None, None))

    def test_parse_fields(self):
        f = dec.parse_bcbp(BCBP["A"], 2026)
        self.assertEqual((f["from"], f["to"], f["carrier"], f["flight_number"], f["pnr"]),
                         ("DPS", "TPE", "BR", "0256", "ZZTEST"))
        self.assertEqual((f["name"], f["seat"], f["seq"], f["status"], f["legs"], f["eticket"]),
                         ("DOE/JANE", "14A", "27", "1", 1, "E"))
        self.assertEqual((f["julian"], f["date"], f["compartment"]), (335, "2026-12-01", "Y"))

    def test_hash(self):
        h = dec.pass_hash(BCBP["A"])
        self.assertRegex(h, r"^0x[0-9a-f]{64}$")
        self.assertEqual(h, dec.pass_hash(BCBP["A"]))
        self.assertNotEqual(h, dec.pass_hash(BCBP["B"]))
        # known keccak256 of empty string proves keccak (not sha3)
        self.assertEqual(dec.pass_hash(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")

    def test_rerender_roundtrip(self):
        out = os.path.join(self.tmp, "clean.png")
        dec.rerender(BCBP["A"], out)
        text, _ = dec.decode_file(out)
        self.assertEqual(text, BCBP["A"])


class PricingTests(unittest.TestCase):
    def test_cap_and_price(self):
        # NOTE: the brief listed 48666666666666666 for 325 min. The stated formula
        # 13e15 + 536e14*(13-5)/12 floors to 48733333333333333, which is asserted here.
        for minutes, cap, price in [(325, 5, 48733333333333333), (695, 12, 17466666666666666),
                                    (890, 13, 13000000000000000), (50, 1, 66600000000000000)]:
            self.assertEqual(bbr.cap_for(minutes), cap, minutes)
            self.assertEqual(bbr.price_wei(cap), price, minutes)

    def test_round_half_up_and_clamp(self):
        self.assertEqual(bbr.cap_for(90), 2)    # 1.5 -> 2
        self.assertEqual(bbr.cap_for(89), 1)
        self.assertEqual(bbr.cap_for(30), 1)    # 0.5 -> 1 via clamp
        self.assertEqual(bbr.cap_for(2000), 13)

    def test_km(self):
        self.assertAlmostEqual(bbr.great_circle_km("LAX", "JFK"), 3983, delta=15)
        for c in ("DPS TPE LAX MIA ORD JFK LGA FLL DFW GRR SFO NRT HND SIN HKG CGK".split()):
            self.assertIn(c, bbr.AIRPORTS)


def run(cmd, cwd, **kw):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, **kw)


class RepoTests(unittest.TestCase):
    """bb_record and gate inside a throwaway git repo."""

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        run(["git", "init", "-q"], self.repo)
        run(["git", "config", "user.email", "t@example.invalid"], self.repo)
        run(["git", "config", "user.name", "t"], self.repo)
        shutil.copytree(HERE, os.path.join(self.repo, "machine"),
                        ignore=shutil.ignore_patterns("__pycache__"))
        with open(os.path.join(self.repo, ".gitignore"), "w") as f:
            f.write("private/\nsource_scans/\n__pycache__/\n")
        os.makedirs(os.path.join(self.repo, "private"))
        open(os.path.join(self.repo, "private", "salt.txt"), "w").write(MASTER + "\n")
        self.img = os.path.join(self.repo, "pass.png")
        canvas(pdf417_img(BCBP["A"])).save(self.img)
        self.payload = os.path.join(self.repo, "payload.txt")
        with open(self.payload, "w") as f:
            f.write(BCBP["B"] + "\n")

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    def rec(self, *extra):
        return run([sys.executable, "machine/bb_record.py", *extra], self.repo)

    def base(self, n, src, minutes="325"):
        return ["--rec", str(n), *src, "--block-minutes", minutes, "--year", "2026",
                "--deadline", "2026-12-01T20:30:00+08:00"]

    def test_record_flow(self):
        r = self.rec(*self.base(4, ["--image", self.img]), "--aircraft", "B789")
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout + r.stderr
        for secret in ("ZZTEST", "DOE", "JANE", BCBP["A"]):
            self.assertNotIn(secret, out)
        f = json.load(open(os.path.join(self.repo, "records/rec004/filing.json")))
        self.assertEqual(list(f), ["rec", "passHash", "blockMinutes", "windowOpen", "deadline", "cap",
                                   "price", "allowPastOpen", "dossier", "network"])
        self.assertEqual((f["rec"], f["cap"], f["price"], f["network"], f["allowPastOpen"]),
                         (4, 5, "48733333333333333", "mainnet", False))
        self.assertEqual(f["dossier"], "DPS|TPE|2026-12-01|14A|325|3818|B789")
        want, salt = expected_hash(BCBP["A"], 4)
        self.assertEqual(f["passHash"], want)
        for sec in (MASTER[2:], salt[2:], MASTER, salt):
            self.assertNotIn(sec, out)
            self.assertNotIn(sec, open(os.path.join(self.repo, "records/rec004/filing.json")).read())
        v = self.rec("--verify", "4")
        self.assertEqual(v.returncode, 0, v.stderr)
        self.assertIn("VERIFY OK", v.stdout)
        self.assertNotIn(salt[2:], v.stdout)
        legs0 = json.load(open(os.path.join(self.repo, "private/legs_private.json")))[0]
        self.assertEqual(legs0["recSalt"], salt)
        self.assertNotIn(MASTER[2:], json.dumps(legs0))
        f["passHash"] = "0x" + "00" * 32
        json.dump(f, open(os.path.join(self.repo, "records/rec004/filing.json"), "w"))
        self.assertNotEqual(self.rec("--verify", "4").returncode, 0)
        f["passHash"] = want
        json.dump(f, open(os.path.join(self.repo, "records/rec004/filing.json"), "w"))
        self.assertEqual(f["deadline"], "2026-12-01T12:30:00Z")
        raw = open(os.path.join(self.repo, "records/rec004/filing.json")).read()
        for secret in ("ZZTEST", "DOE", "JANE", "M1DOE"):
            self.assertNotIn(secret, raw)
        self.assertIn("PERMANENT", r.stdout)
        self.assertIn("0.048733 ETH", r.stdout)
        self.assertIn("Asia/Makassar", r.stdout)
        legs = json.load(open(os.path.join(self.repo, "private/legs_private.json")))
        self.assertEqual(legs[0]["pnr"], "ZZTEST")
        self.assertEqual(legs[0]["payload"], BCBP["A"])
        self.assertEqual(oct(os.stat(os.path.join(self.repo, "private/legs_private.json")).st_mode & 0o777), "0o600")

    def test_refusals(self):
        self.assertEqual(self.rec(*self.base(4, ["--image", self.img])).returncode, 0)
        dup = self.rec(*self.base(5, ["--image", self.img]))      # same pass, other rec
        self.assertNotEqual(dup.returncode, 0)
        self.assertIn("already registered", dup.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.repo, "records/rec005")))
        again = self.rec(*self.base(4, ["--payload-file", self.payload]))   # rec folder exists
        self.assertNotEqual(again.returncode, 0)
        unk = self.rec(*self.base(6, ["--payload-file", self.payload]), "--window-open", "2020-01-01T00:00:00Z")
        self.assertNotEqual(unk.returncode, 0)                    # past open without flag
        ok = self.rec(*self.base(6, ["--payload-file", self.payload], "695"),
                      "--window-open", "2020-01-01T00:00:00Z", "--allow-past-open", "--network", "sepolia")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        f = json.load(open(os.path.join(self.repo, "records/rec006/filing.json")))
        self.assertEqual((f["cap"], f["price"], f["allowPastOpen"], f["network"]),
                         (12, "17466666666666666", True, "sepolia"))

    def test_salt_required(self):
        sp = os.path.join(self.repo, "private", "salt.txt")
        os.remove(sp)
        self.assertNotEqual(self.rec(*self.base(4, ["--image", self.img])).returncode, 0)
        open(sp, "w").write("0x1234\n")
        r = self.rec(*self.base(4, ["--image", self.img]))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("malformed", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.repo, "records/rec004")))

    def test_gate_salt(self):
        self.assertEqual(self.rec(*self.base(4, ["--image", self.img])).returncode, 0)
        _, salt = expected_hash(BCBP["A"], 4)
        for i, sec in enumerate((salt, MASTER[2:])):
            self.stage(f"docs/s{i}.md", f"x {sec.upper()} y\n")
            g = self.gate()
            self.assertEqual(g.returncode, 1)
            self.assertIn(f"docs/s{i}.md", g.stderr)
            self.assertIn("salt", g.stderr)
            self.assertNotIn(sec[-20:], g.stderr.lower())
            run(["git", "reset", "-q", f"docs/s{i}.md"], self.repo)

    def test_unknown_airport_and_missing_args(self):
        pl = os.path.join(self.repo, "p2.txt")
        open(pl, "w").write(make_bcbp("TEST/ZED", "ZZAAAA", "XXX", "DPS", "BR", "1", 10, "1A", "1"))
        r = self.rec(*self.base(7, ["--payload-file", pl]))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unknown airport", r.stderr)
        r2 = self.rec(*self.base(7, ["--payload-file", pl]), "--km", "1234")
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertNotEqual(self.rec("--image", self.img).returncode, 0)

    def test_refuses_when_private_not_ignored(self):
        open(os.path.join(self.repo, ".gitignore"), "w").write("")
        r = self.rec(*self.base(4, ["--image", self.img]))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("gitignored", r.stderr)

    def test_deregister(self):
        self.assertEqual(self.rec(*self.base(4, ["--image", self.img])).returncode, 0)
        self.assertEqual(self.rec(*self.base(5, ["--payload-file", self.payload])).returncode, 0)
        with open(os.path.join(self.repo, "records/rec005/receipt.json"), "w") as f:
            f.write("{}")
        self.assertNotEqual(self.rec("--deregister", "5").returncode, 0)   # filed: refused
        self.assertTrue(os.path.isdir(os.path.join(self.repo, "records/rec005")))
        self.assertEqual(self.rec("--deregister", "4").returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.repo, "records/rec004")))
        legs = json.load(open(os.path.join(self.repo, "private/legs_private.json")))
        self.assertEqual([l["rec"] for l in legs], [5])

    # ---- gate ----
    def gate(self, *extra):
        return run([sys.executable, "machine/gate.py", *extra], self.repo)

    def stage(self, rel, content):
        p = os.path.join(self.repo, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").write(content)
        run(["git", "add", "-f", rel], self.repo)

    def test_gate(self):
        self.assertEqual(self.rec(*self.base(4, ["--image", self.img])).returncode, 0)
        self.stage("docs/ok.md", "Record 4 filed. Route DPS-TPE. Nothing secret here.\n")
        g = self.gate()
        self.assertEqual(g.returncode, 0, g.stderr)

        self.stage("docs/pnr.md", "booking ref zztest was here\n")
        g = self.gate()
        self.assertEqual(g.returncode, 1)
        self.assertIn("docs/pnr.md", g.stderr)
        self.assertIn("PNR", g.stderr)
        self.assertNotIn("ZZTEST", g.stderr.upper())
        run(["git", "reset", "-q", "docs/pnr.md"], self.repo)

        self.stage("docs/name.md", "passenger Doe flew\n")
        g = self.gate()
        self.assertEqual(g.returncode, 1)
        self.assertIn("docs/name.md", g.stderr)
        self.assertIn("surname", g.stderr)
        self.assertNotIn("DOE", g.stderr.replace("DOE/", ""))   # secret not echoed
        run(["git", "reset", "-q", "docs/name.md"], self.repo)

        self.stage("docs/bcbp.md", "raw: " + BCBP["C"] + "\n")
        g = self.gate()
        self.assertEqual(g.returncode, 1)
        self.assertIn("BCBP", g.stderr)
        self.assertNotIn("SMYTHE", g.stderr)
        run(["git", "reset", "-q", "docs/bcbp.md"], self.repo)

        self.stage("private/other.txt", "[]")
        g = self.gate()
        self.assertEqual(g.returncode, 1)
        self.assertIn("private/other.txt", g.stderr)
        self.assertIn("forbidden", g.stderr)
        run(["git", "reset", "-q", "private/other.txt"], self.repo)

        self.stage("source_scans/a.png", "x")
        self.assertEqual(self.gate().returncode, 1)
        run(["git", "reset", "-q", "source_scans/a.png"], self.repo)

        self.assertEqual(self.gate().returncode, 0)
        # --paths on an unstaged file
        open(os.path.join(self.repo, "loose.txt"), "w").write("ZZTEST\n")
        g = self.gate("--paths", "loose.txt")
        self.assertEqual(g.returncode, 1)
        self.assertIn("loose.txt", g.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
