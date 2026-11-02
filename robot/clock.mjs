/*
  clock.mjs - prints seconds until the robot next has work, or "none".
  Work = a filed record not yet landed (due at its deadline), a filing.json not yet filed
  whose deadline is still ahead (due now), or an auction past its end and unsettled.
  Read-only, no key. GitHub cron is unreliable, so robot-clock.yml sleeps on this and wakes the robot.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "config/chain.json"), "utf8"));
const ABI = [
  "function records(uint256 rec) view returns (bytes32 passHash, uint64 windowOpen, uint64 deadline, uint64 landedAt, uint16 blockMinutes, uint16 cap, uint16 minted, uint128 price)",
  "function auction() view returns (uint64 start, uint64 end, uint128 reserve, uint128 highBid, address highBidder, bool settled)",
];
const toUnix = (v) => (typeof v === "number" ? v : Math.floor(Date.parse(v) / 1000));
const now = Math.floor(Date.now() / 1000);
const contracts = new Map();
const contractFor = (net) => {
  const n = cfg[net];
  if (!n || !n.contract) return null;
  if (!contracts.has(net)) contracts.set(net, new ethers.Contract(n.contract, ABI, new ethers.JsonRpcProvider(n.rpc)));
  return contracts.get(net);
};

let next = Infinity;
const dir = path.join(root, "records");
for (const d of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
  const f = path.join(dir, d, "filing.json");
  if (!fs.existsSync(f)) continue;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
  const c = contractFor(j.network);
  if (!c) continue;
  try {
    const r = await c.records(j.rec);
    const deadline = Number(r.deadline), landed = Number(r.landedAt);
    if (landed) continue;
    if (deadline) next = Math.min(next, deadline);
    else if (toUnix(j.deadline) > now) next = Math.min(next, now);
  } catch (e) {
    next = Math.min(next, now + 600);
  }
}
for (const [, c] of contracts) {
  try {
    const a = await c.auction();
    if (Number(a.end) && !a.settled) next = Math.min(next, Number(a.end));
  } catch { /* contract without an auction yet */ }
}
console.log(next === Infinity ? "none" : String(Math.max(0, next - now)));
