// Runs the robot stages against an in-memory mock contract. No network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { stageFile, stageLand, stageAuction } from "./robot.mjs";

const NOW = 1_800_000_000;
const H1 = "0x" + "11".repeat(32);
const H2 = "0x" + "22".repeat(32);
const ZERO = "0x" + "00".repeat(32);

function mockContract() {
  const recs = new Map();
  const events = [];
  const state = { sends: [], block: 100, auction: { end: 0n, settled: false } };
  const tx = (n) => "0x" + n.toString(16).padStart(64, "0");
  const c = {
    state,
    async recordCount() { return BigInt(recs.size); },
    async records(rec) {
      return recs.get(Number(rec)) ?? { passHash: ZERO, windowOpen: 0n, deadline: 0n, landedAt: 0n, blockMinutes: 0n, cap: 0n, minted: 0n, price: 0n };
    },
    async capFor(bm) { return BigInt(bm) === 325n ? 5n : 3n; },
    async priceFor(cap) { return BigInt(cap) === 5n ? 48666666666666666n : 1n; },
    async auction() { return { start: 0n, end: state.auction.end, reserve: 0n, highBid: 0n, highBidder: ZERO, settled: state.auction.settled }; },
    filters: {
      Filed: (rec) => ({ name: "Filed", rec: Number(rec) }),
      Landed: (rec) => ({ name: "Landed", rec: Number(rec) }),
    },
    async queryFilter(f) { return events.filter((e) => e.name === f.name && e.rec === f.rec); },
    // test helpers to pre-seed chain state
    seedFiled(rec, passHash, cap = 5n, price = 48666666666666666n, deadline = BigInt(NOW + 3600)) {
      recs.set(rec, { passHash, windowOpen: BigInt(NOW), deadline, landedAt: 0n, blockMinutes: 325n, cap, minted: 0n, price });
      events.push({ name: "Filed", rec, transactionHash: tx(900 + rec), blockNumber: 50, args: { cap, price } });
    },
    seedLanded(rec) {
      const r = recs.get(rec); r.landedAt = BigInt(NOW - 10); r.minted = 3n;
      events.push({ name: "Landed", rec, transactionHash: tx(800 + rec), blockNumber: 60, args: {} });
    },
  };
  // send() mimics the signer path and applies the state change
  c.send = async (method, args) => {
    state.sends.push(method);
    state.block++;
    const hash = tx(state.block);
    if (method === "file") {
      const [rec, passHash, bm, wo, dl] = args;
      recs.set(rec, { passHash, windowOpen: BigInt(wo), deadline: BigInt(dl), landedAt: 0n, blockMinutes: BigInt(bm), cap: 5n, minted: 0n, price: 48666666666666666n });
      events.push({ name: "Filed", rec, transactionHash: hash, blockNumber: state.block, args: { cap: 5n, price: 48666666666666666n } });
    } else if (method === "land") {
      const r = recs.get(args[0]); r.landedAt = BigInt(NOW); r.minted = 2n;
      events.push({ name: "Landed", rec: args[0], transactionHash: hash, blockNumber: state.block, args: {} });
    } else if (method === "settleAuction") {
      state.auction.settled = true;
    }
    return { hash, blockNumber: state.block };
  };
  return c;
}

function setup(filings, { receipts = {}, landed = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bbtest-"));
  for (const f of filings) {
    const dir = path.join(root, "records", "rec" + String(f.rec).padStart(3, "0"));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "filing.json"), JSON.stringify(f));
    if (receipts[f.rec]) fs.writeFileSync(path.join(dir, "receipt.json"), JSON.stringify(receipts[f.rec]));
    if (landed.includes(f.rec)) fs.writeFileSync(path.join(dir, "LANDED"), "");
  }
  const mock = mockContract();
  const logs = [];
  const ctx = { root, now: () => NOW, log: (...a) => logs.push(a.join(" | ")), chain: () => ({ contract: mock, send: mock.send }) };
  const receipt = (rec) => {
    const p = path.join(root, "records", "rec" + String(rec).padStart(3, "0"), "receipt.json");
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  };
  return { ctx, mock, logs, receipt };
}

const filing = (o = {}) => ({
  rec: 1, passHash: H1, blockMinutes: 325, windowOpen: NOW + 600, deadline: NOW + 3600,
  cap: 5, price: "48666666666666666", allowPastOpen: false,
  dossier: "DPS|TPE|2026-11-03|14A|325|3780|A333", network: "sepolia", ...o,
});
const filedReceipt = { filed: { tx: "0xaa", block: 1, at: "x", cap: 5, price: "1" } };

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("fresh filing", async () => {
  const t = setup([filing()]);
  await stageFile(t.ctx);
  assert.deepEqual(t.mock.state.sends, ["file"]);
  const r = t.receipt(1);
  assert.equal(r.filed.cap, 5);
  assert.equal(r.filed.price, "48666666666666666");
  assert.match(r.filed.tx, /^0x[0-9a-f]{64}$/);
});

test("already-filed idempotency", async () => {
  const t = setup([filing()]);
  t.mock.seedFiled(1, H1);
  await stageFile(t.ctx);
  assert.deepEqual(t.mock.state.sends, []);
  assert.equal(t.receipt(1).filed.block, 50);
  await stageFile(t.ctx); // rerun with receipt present
  assert.deepEqual(t.mock.state.sends, []);
});

test("rec gap refused", async () => {
  const t = setup([filing({ rec: 2 })]);
  await stageFile(t.ctx);
  assert.deepEqual(t.mock.state.sends, []);
  assert.equal(t.receipt(2), null);
  assert.ok(t.logs.some((l) => l.includes("REFUSED") && l.includes("recordCount+1")));
});

test("past windowOpen refused (and allowed with allowPastOpen)", async () => {
  const t = setup([filing({ windowOpen: NOW - 1000 })]);
  await stageFile(t.ctx);
  assert.deepEqual(t.mock.state.sends, []);
  assert.ok(t.logs.some((l) => l.includes("REFUSED") && l.includes("windowOpen")));
  const u = setup([filing({ windowOpen: NOW - 1000, allowPastOpen: true })]);
  await stageFile(u.ctx);
  assert.deepEqual(u.mock.state.sends, ["file"]);
});

test("cap/price mismatch refused", async () => {
  const a = setup([filing({ cap: 4 })]);
  await stageFile(a.ctx);
  assert.deepEqual(a.mock.state.sends, []);
  assert.ok(a.logs.some((l) => l.includes("REFUSED") && l.includes("cap")));
  const b = setup([filing({ price: "48666666666666667" })]);
  await stageFile(b.ctx);
  assert.deepEqual(b.mock.state.sends, []);
  assert.ok(b.logs.some((l) => l.includes("REFUSED") && l.includes("price")));
});

test("land after deadline", async () => {
  const t = setup([filing({ deadline: NOW - 5 })], { receipts: { 1: filedReceipt } });
  t.mock.seedFiled(1, H1, 5n, 48666666666666666n, BigInt(NOW - 5));
  await stageLand(t.ctx);
  assert.deepEqual(t.mock.state.sends, ["land"]);
  const r = t.receipt(1).landed;
  assert.equal(r.minted, 2);
  assert.equal(r.cap, 5);
});

test("land early via LANDED file (and not without it)", async () => {
  const t = setup([filing()], { receipts: { 1: filedReceipt }, landed: [1] });
  t.mock.seedFiled(1, H1);
  await stageLand(t.ctx);
  assert.deepEqual(t.mock.state.sends, ["land"]);
  assert.ok(t.receipt(1).landed);
  const n = setup([filing()], { receipts: { 1: filedReceipt } });
  n.mock.seedFiled(1, H1);
  await stageLand(n.ctx);
  assert.deepEqual(n.mock.state.sends, []);
});

test("already-landed no-op", async () => {
  const done = { ...filedReceipt, landed: { tx: "0xbb", block: 2, at: "x", minted: 3, cap: 5 } };
  const t = setup([filing({ deadline: NOW - 5 })], { receipts: { 1: done } });
  t.mock.seedFiled(1, H1);
  await stageLand(t.ctx);
  assert.deepEqual(t.mock.state.sends, []);
  // landed on chain but receipt missing: receipt healed, no send
  const h = setup([filing({ deadline: NOW - 5 })], { receipts: { 1: filedReceipt } });
  h.mock.seedFiled(1, H1);
  h.mock.seedLanded(1);
  await stageLand(h.ctx);
  assert.deepEqual(h.mock.state.sends, []);
  assert.equal(h.receipt(1).landed.minted, 3);
});

test("auction settles once, then no-op", async () => {
  const t = setup([filing()]);
  t.mock.state.auction.end = BigInt(NOW - 1);
  await stageAuction(t.ctx, ["sepolia"]);
  await stageAuction(t.ctx, ["sepolia"]);
  assert.deepEqual(t.mock.state.sends, ["settleAuction"]);
  const u = setup([filing()]);
  await stageAuction(u.ctx, ["sepolia"]); // end == 0
  assert.deepEqual(u.mock.state.sends, []);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message.split("\n")[0]}`); }
}
process.exit(failed ? 1 : 0);
