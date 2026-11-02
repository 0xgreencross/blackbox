#!/usr/bin/env node
/* End-to-end lifecycle rehearsal, run by the owner who is also the registrar.
   env: RPC_URL  DEPLOYER_KEY  MAX_GWEI (default 30)  DEPLOY_DIR (optional)
   reads deployments/sepolia.json, writes deployments/sepolia-rehearsal.json (every tx hash and assertion).
   Exits non-zero on any failed assertion. The key is never printed. */
const path = require("path");
const C = require("./lib/common.js");
const { ethers } = C;

const TREASURY = "0x2bCb25A1934D4696A0d733EF8f514095003C6a18";
const DOSSIER = "DPS|TPE|2026-11-03|14A|325|3780|A333";
const LEAKS = ["DPS", "TPE", "14A", "2026-11-03", "ROUTE", "SEAT", "dossier"];

const receipt = { network: "sepolia", startedAt: new Date().toISOString(), txs: [], assertions: [], ok: false };
let outPath;
const save = () => C.writeJson(outPath, receipt);
function check(name, cond, detail) {
  const pass = !!cond;
  receipt.assertions.push({ name, pass, detail: detail === undefined ? undefined : String(detail) });
  console.log(`  ${pass ? "PASS" : "FAIL"} ${name}${detail !== undefined && !pass ? " (" + detail + ")" : ""}`);
  save();
}
async function poll(fn, ms = 90000, every = 2000) {
  const end = Date.now() + ms; let last;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    if (Date.now() > end) { if (last) throw last; return null; }
    await C.sleep(every);
  }
}
function decode(uri) {
  if (!uri.startsWith("data:application/json;base64,")) throw new Error("tokenURI is not a base64 json data uri");
  const json = JSON.parse(Buffer.from(uri.slice(29), "base64").toString("utf8"));
  const html = Buffer.from(json.animation_url.slice("data:text/html;base64,".length), "base64").toString("utf8");
  return { json, html };
}

async function main() {
  const { provider, wallet } = C.makeWallet();
  const me = wallet.address, maxGwei = process.env.MAX_GWEI || "30";
  const chainId = (await provider.getNetwork()).chainId;
  const dep = C.readJson(path.join(C.deployDir(), "sepolia.json"), null);
  outPath = path.join(C.deployDir(), "sepolia-rehearsal.json");
  if (!dep || !dep.contract || !dep.contract.address) throw new Error("deployments/sepolia.json has no contract; run deploy.js first");
  if (dep.chainId !== chainId.toString()) throw new Error("deployments/sepolia.json is for chain " + dep.chainId + ", connected to " + chainId);
  const art = C.loadArtifact();
  const bb = new ethers.Contract(dep.contract.address, art.abi, wallet);
  const local = chainId === 31337n;
  /* public RPCs are load-balanced and lag each other: every state change waits for 2 confirmations
     (1 on the local automining chain, where a second block would never come) */
  const CONF = local ? 1 : 2;
  receipt.chainId = chainId.toString(); receipt.contract = dep.contract.address; receipt.signer = me;
  console.log(`rehearsal on chain ${chainId}, contract ${dep.contract.address}, signer ${me}`);

  async function tx(label, fn) {
    const t = await fn(await C.opts(provider, me, maxGwei));
    console.log(`  tx ${label}: ${t.hash}`);
    const entry = { label, hash: t.hash }; receipt.txs.push(entry); save();
    const rc = await t.wait(CONF);
    entry.block = rc.blockNumber; entry.status = rc.status; entry.gasUsed = rc.gasUsed.toString(); save();
    if (rc.status !== 1) throw new Error(label + " reverted");
    return rc;
  }
  const revertName = async p => { try { await p; return null; } catch (e) { return e.revert?.name || e.errorName || ("other:" + (e.shortMessage || e.message)); } };

  check("signer is owner and registrar", (await bb.owner()) === me && (await bb.registrar()) === me, `${await bb.owner()} / ${await bb.registrar()}`);
  if ((await bb.auction()).end !== 0n) throw new Error("an auction already exists on this deployment; run deploy.js --fresh for a new one");
  if ((await bb.recordCount()) !== (await bb.landedCount())) throw new Error("an earlier record is still unlanded on this deployment");

  // ------------------------------------------------------------ lock
  if (!(await bb.sceneLocked())) await tx("lockScene", f => bb.lockScene(f));
  check("scene locked", await poll(() => bb.sceneLocked(), 30000));

  // ------------------------------------------------------------ file
  const rec = (await bb.recordCount()) + 1n;
  const passHash = ethers.keccak256(ethers.toUtf8Bytes("M1REHEARSAL/TEST " + Date.now()));
  const now = await C.chainNow(provider);
  const windowOpen = now, deadline = now + 180;
  const cap = await bb.capFor(325), price = await bb.priceFor(cap);
  check("capFor(325) is 5", cap === 5n, cap);
  /* the node that estimates file() may not have seen the lock yet: wait until a simulated file() no longer reverts NotLocked */
  const fileSim = await poll(async () => { const e = await revertName(bb.file.staticCall(rec, passHash, 325, windowOpen, deadline)); return e === "NotLocked" ? null : (e || "ok"); }, 60000);
  check("file() simulates cleanly after the lock", fileSim === "ok", fileSim);
  await tx("file", f => bb.file(rec, passHash, 325, windowOpen, deadline, f));
  const r = await poll(async () => { const x = await bb.records(rec); return x.passHash === passHash ? x : null; }, 30000);
  check("record filed with expected price and cap", r && r.price === price && r.cap === cap, r && r.price);
  receipt.rec = rec.toString(); receipt.passHash = passHash;

  // ------------------------------------------------------------ mint 2, treasury delta
  const sent = [];
  for (let i = 1; i <= 2; i++) {
    const t = await bb.mint(rec, { value: price, ...(await C.opts(provider, me, maxGwei)) });
    console.log(`  tx mint ${i}: ${t.hash}`);
    const entry = { label: "mint " + i, hash: t.hash }; receipt.txs.push(entry); sent.push([t, entry]);
  }
  save();
  const blocks = [];
  for (const [t, entry] of sent) {
    const rc = await t.wait(CONF); entry.block = rc.blockNumber; entry.status = rc.status; entry.gasUsed = rc.gasUsed.toString(); blocks.push(rc.blockNumber);
    if (rc.status !== 1) throw new Error(entry.label + " reverted");
  }
  save();
  const lo = Math.min(...blocks), hi = Math.max(...blocks);
  const delta = (await provider.getBalance(TREASURY, hi)) - (await provider.getBalance(TREASURY, lo - 1));
  check("treasury delta equals 2x price over the mint blocks", delta === 2n * price, `${delta} vs ${2n * price}`);
  check("contract holds nothing", (await provider.getBalance(dep.contract.address)) === 0n);
  const tokenId = rec * 100n + 1n;
  check("minted tokens owned by signer", (await poll(() => bb.ownerOf(tokenId))) === me && (await bb.ownerOf(tokenId + 1n)) === me);

  // ------------------------------------------------------------ sealed tokenURI
  const sealed = decode(await poll(() => bb.tokenURI(tokenId), 90000, 3000));
  const sealedText = JSON.stringify(sealed.json) + sealed.html.slice(0, 2000);
  const leaked = LEAKS.filter(l => sealedText.includes(l));
  check("sealed tokenURI has no dossier fields", leaked.length === 0, leaked.join(","));
  check("sealed attributes are REC, STATE, HASH", sealed.json.attributes.map(a => a.trait_type).join() === "REC,STATE,HASH");
  check("sealed state is SEALED", sealed.json.attributes.find(a => a.trait_type === "STATE")?.value === "SEALED");

  // ------------------------------------------------------------ wait for deadline, land
  console.log("  waiting for the deadline");
  await C.waitUntilChainTime(provider, deadline, "deadline");
  await tx("land", f => bb.land(rec, DOSSIER, f));
  check("record landed", await poll(async () => (await bb.records(rec)).landedAt > 0n, 30000));
  const mintErr = await poll(async () => await revertName(bb.mint.staticCall(rec, { value: price })), 30000);
  check("mint reverts after landing with WindowClosed", mintErr === "WindowClosed", mintErr);

  // ------------------------------------------------------------ declassified tokenURI
  const open = await poll(async () => {
    const d = decode(await bb.tokenURI(tokenId));
    return d.json.attributes.some(a => a.trait_type === "ROUTE") ? d : null;
  }, 90000, 3000);
  const at = open ? Object.fromEntries(open.json.attributes.map(a => [a.trait_type, a.value])) : {};
  check("declassified attributes appear", open && at.ROUTE === "DPS > TPE" && at.SEAT === "14A" && at.KM === "3780" && at.AIRCRAFT === "A333" && at["EDITION CAP"] === 5 && at.MINTED === 2, JSON.stringify(at));
  check("declassified page carries the dossier", open && open.html.includes('"dossier":"' + DOSSIER + '"'));

  // ------------------------------------------------------------ auction
  const start = await C.chainNow(provider);
  const reserve = ethers.parseEther("0.001");
  await tx("startAuction", f => bb.startAuction(start, 120, reserve, f));
  check("journeyCount fixed", await poll(async () => (await bb.journeyCount()) === rec, 30000));
  await tx("bid", f => bb.bid({ value: reserve, ...f }));
  const a1 = await poll(async () => { const a = await bb.auction(); return a.highBidder === me ? a : null; }, 30000);
  check("signer is high bidder", !!a1);
  // a bid inside the last 10 minutes pushes the end to bid time + EXTENSION, so read the real end
  const end = Number(a1.end);
  console.log("  waiting for the auction end (bids extend to a 10 minute minimum)");
  await C.waitUntilChainTime(provider, end, "auction end");
  const rc = await tx("settleAuction", f => bb.settleAuction(f));
  const d2 = (await provider.getBalance(TREASURY, rc.blockNumber)) - (await provider.getBalance(TREASURY, rc.blockNumber - 1));
  check("ownerOf(0) is the bidder", (await poll(() => bb.ownerOf(0n))) === me);
  check("treasury delta on settle equals the bid", d2 === reserve, `${d2} vs ${reserve}`);
  check("contract holds nothing at the end", (await provider.getBalance(dep.contract.address)) === 0n);
}

main().catch(e => {
  console.error("REHEARSAL ERROR:", e.shortMessage || e.message);
  if (!outPath) process.exit(1);
  receipt.assertions.push({ name: "fatal", pass: false, detail: String(e.shortMessage || e.message) });
}).finally(() => {
  if (!outPath) return;
  const failed = receipt.assertions.filter(a => !a.pass);
  receipt.ok = failed.length === 0 && receipt.assertions.length > 0;
  receipt.finishedAt = new Date().toISOString();
  save();
  console.log(receipt.ok ? `rehearsal PASSED (${receipt.assertions.length} assertions)` : `rehearsal FAILED (${failed.length} failed)`);
  console.log("receipt", outPath);
  process.exit(receipt.ok ? 0 : 1);
});
