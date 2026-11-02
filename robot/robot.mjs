/*
  robot.mjs - unattended registrar for BLACKBOX. Runs in GitHub Actions.

  Stages, in order, each idempotent and chain-state-first:
    FILE     records/recNNN/filing.json without receipt.filed -> file(...)
    LAND     filed, not landed, deadline passed or LANDED marker -> land(...)
    AUCTION  auction().end set, past, unsettled -> settleAuction()

  Refusals are logged and exit 0. Unexpected errors (RPC, revert) are logged,
  do not stop later stages, and make the process exit 1 at the end.
  Secret via env: REGISTRAR_KEY (hex). It is never logged.

  Stage functions take a ctx so they can run against a mock contract:
    ctx.root                  repository root
    ctx.now()                 unix seconds
    ctx.log(stage, rec, action, tx)
    ctx.chain(network)        -> { contract, send(method, args) -> {hash, blockNumber} }
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ethers } from "ethers";

export const ABI = [
  "function file(uint256 rec, bytes32 passHash, uint16 blockMinutes, uint64 windowOpen, uint64 deadline)",
  "function land(uint256 rec, string dossier)",
  "function records(uint256 rec) view returns (bytes32 passHash, uint64 windowOpen, uint64 deadline, uint64 landedAt, uint16 blockMinutes, uint16 cap, uint16 minted, uint128 price)",
  "function recordCount() view returns (uint256)",
  "function capFor(uint16 blockMinutes) pure returns (uint16)",
  "function priceFor(uint16 cap) pure returns (uint128)",
  "function auction() view returns (uint64 start, uint64 end, uint128 reserve, uint128 highBid, address highBidder, bool settled)",
  "function settleAuction()",
  "event Filed(uint256 indexed rec, bytes32 passHash, uint16 cap, uint128 price, uint64 windowOpen, uint64 deadline)",
  "event Landed(uint256 indexed rec, uint16 minted, uint16 cap, string dossier)",
];

const ZERO32 = "0x" + "00".repeat(32);
const MAX_FEE_CAP = 30n * 10n ** 9n; // 30 gwei
const PAST_OPEN_GRACE = 15 * 60;
const CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;

export class Refusal extends Error {}

// ---------- helpers ----------
export function recName(rec) {
  return "rec" + String(rec).padStart(3, "0");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1) + "\n");
  fs.renameSync(tmp, p);
}

export function loadRecords(root) {
  const base = path.join(root, "records");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((d) => /^rec\d{3,}$/.test(d) && fs.existsSync(path.join(base, d, "filing.json")))
    .map((d) => {
      const dir = path.join(base, d);
      const filing = readJson(path.join(dir, "filing.json"));
      return { dir, filing, rec: Number(filing.rec) };
    })
    .sort((a, b) => a.rec - b.rec);
}

function loadReceipt(dir) {
  const p = path.join(dir, "receipt.json");
  return fs.existsSync(p) ? readJson(p) : {};
}

function saveReceipt(dir, receipt) {
  writeJson(path.join(dir, "receipt.json"), receipt);
}

function isoNow(ctx) {
  return new Date(ctx.now() * 1000).toISOString();
}

export function safeErr(e) {
  const key = (process.env.REGISTRAR_KEY || "").replace(/^0x/, "");
  let msg = String(e?.shortMessage || e?.reason || e?.message || e).split("\n")[0].slice(0, 160);
  if (key) msg = msg.split(key).join("[redacted]");
  return `${e?.code || e?.name || "Error"}: ${msg}`;
}

async function findEvent(contract, name, rec) {
  const filter = contract.filters[name](rec);
  const logs = await contract.queryFilter(filter);
  return logs.length ? logs[logs.length - 1] : null;
}

// ---------- FILE ----------
export async function stageFile(ctx, items = loadRecords(ctx.root)) {
  let errors = 0;
  for (const { dir, filing, rec } of items) {
    const receipt = loadReceipt(dir);
    if (receipt.filed) continue;
    const log = (action, tx) => ctx.log("FILE", rec, action, tx);
    try {
      const { contract, send } = ctx.chain(filing.network);
      const r = await contract.records(rec);
      const count = Number(await contract.recordCount());
      const chainHash = String(r.passHash).toLowerCase();
      const wantHash = String(filing.passHash).toLowerCase();

      // chain first: already filed?
      if (rec <= count && chainHash !== ZERO32) {
        if (chainHash !== wantHash) {
          log("REFUSED chain has rec with different passHash");
          continue;
        }
        const ev = await findEvent(contract, "Filed", rec);
        if (!ev) {
          log("REFUSED filed on chain but Filed event not found; receipt not written");
          continue;
        }
        receipt.filed = {
          tx: ev.transactionHash,
          block: Number(ev.blockNumber),
          at: isoNow(ctx),
          cap: Number(ev.args.cap),
          price: String(ev.args.price),
        };
        saveReceipt(dir, receipt);
        log("receipt written from chain, no send", ev.transactionHash);
        continue;
      }

      const now = ctx.now();
      if (!/^0x[0-9a-fA-F]{64}$/.test(String(filing.passHash))) { log("REFUSED passHash is not 32 bytes hex"); continue; }
      if (rec !== count + 1) { log(`REFUSED rec ${rec} != recordCount+1 (${count + 1})`); continue; }
      if (filing.windowOpen < now - PAST_OPEN_GRACE && filing.allowPastOpen !== true) {
        log("REFUSED windowOpen is more than 15 minutes in the past and allowPastOpen is not true");
        continue;
      }
      if (!(filing.deadline > now)) { log("REFUSED deadline is not after now"); continue; }
      if (!(filing.deadline > filing.windowOpen)) { log("REFUSED deadline is not after windowOpen"); continue; }
      const capChain = Number(await contract.capFor(filing.blockMinutes));
      const priceChain = BigInt(await contract.priceFor(capChain));
      if (Number(filing.cap) !== capChain) { log(`REFUSED cap ${filing.cap} != capFor on chain ${capChain}`); continue; }
      if (BigInt(filing.price) !== priceChain) { log(`REFUSED price ${filing.price} != priceFor on chain ${priceChain}`); continue; }

      const sent = await send("file", [rec, filing.passHash, filing.blockMinutes, filing.windowOpen, filing.deadline]);
      receipt.filed = {
        tx: sent.hash,
        block: Number(sent.blockNumber),
        at: isoNow(ctx),
        cap: capChain,
        price: priceChain.toString(),
      };
      saveReceipt(dir, receipt);
      log("filed", sent.hash);
    } catch (e) {
      if (e instanceof Refusal) { log("REFUSED " + e.message); continue; }
      errors++;
      log("ERROR " + safeErr(e));
    }
  }
  return errors;
}

// ---------- LAND ----------
export async function stageLand(ctx, items = loadRecords(ctx.root)) {
  let errors = 0;
  for (const { dir, filing, rec } of items) {
    const receipt = loadReceipt(dir);
    if (!receipt.filed || receipt.landed) continue;
    const log = (action, tx) => ctx.log("LAND", rec, action, tx);
    try {
      const { contract, send } = ctx.chain(filing.network);
      const r = await contract.records(rec);
      if (String(r.passHash).toLowerCase() === ZERO32) { log("REFUSED receipt says filed but chain has no such rec"); continue; }

      // chain first: already landed?
      if (BigInt(r.landedAt) !== 0n) {
        const ev = await findEvent(contract, "Landed", rec);
        if (!ev) { log("REFUSED landed on chain but Landed event not found; receipt not written"); continue; }
        receipt.landed = {
          tx: ev.transactionHash,
          block: Number(ev.blockNumber),
          at: isoNow(ctx),
          minted: Number(r.minted),
          cap: Number(r.cap),
        };
        saveReceipt(dir, receipt);
        log("receipt written from chain, no send", ev.transactionHash);
        continue;
      }

      const early = fs.existsSync(path.join(dir, "LANDED"));
      const due = ctx.now() >= Number(r.deadline);
      if (!early && !due) continue;
      if (!filing.dossier || typeof filing.dossier !== "string") { log("REFUSED filing.json has no dossier string"); continue; }

      const sent = await send("land", [rec, filing.dossier]);
      const after = await contract.records(rec);
      receipt.landed = {
        tx: sent.hash,
        block: Number(sent.blockNumber),
        at: isoNow(ctx),
        minted: Number(after.minted),
        cap: Number(after.cap),
      };
      saveReceipt(dir, receipt);
      log(early && !due ? "landed early (LANDED marker)" : "landed after deadline", sent.hash);
    } catch (e) {
      if (e instanceof Refusal) { log("REFUSED " + e.message); continue; }
      errors++;
      log("ERROR " + safeErr(e));
    }
  }
  return errors;
}

// ---------- AUCTION ----------
export async function stageAuction(ctx, networks) {
  let errors = 0;
  for (const network of networks) {
    const log = (action, tx) => ctx.log("AUCTION", "-", `${network} ${action}`, tx);
    try {
      const { contract, send } = ctx.chain(network);
      const a = await contract.auction();
      const end = BigInt(a.end);
      if (end === 0n || BigInt(ctx.now()) < end || a.settled) continue;
      const sent = await send("settleAuction", []);
      log("settled", sent.hash);
    } catch (e) {
      if (e instanceof Refusal) { log("REFUSED " + e.message); continue; }
      errors++;
      log("ERROR " + safeErr(e));
    }
  }
  return errors;
}

// ---------- real chain adapter ----------
export function makeRealChain(root, log) {
  const cfg = readJson(path.join(root, "config", "chain.json"));
  const cache = new Map();
  return (network) => {
    if (cache.has(network)) return cache.get(network);
    const c = cfg[network];
    if (!c) throw new Refusal(`unknown network "${network}" (not in config/chain.json)`);
    if (!ethers.isAddress(c.contract)) throw new Refusal(`config/chain.json ${network}.contract is not an address`);
    const provider = new ethers.JsonRpcProvider(c.rpc, Number(c.chainId), { staticNetwork: true });
    const readContract = new ethers.Contract(c.contract, ABI, provider);
    let verified = null;
    const entry = {
      contract: readContract,
      async send(method, args) {
        const key = process.env.REGISTRAR_KEY || "";
        if (!key) throw new Refusal("REGISTRAR_KEY not set");
        if (!verified) {
          const net = await provider.getNetwork();
          if (Number(net.chainId) !== Number(c.chainId)) throw new Refusal(`rpc chainId ${net.chainId} != config ${c.chainId}`);
          verified = true;
        }
        const signer = new ethers.Wallet(key.startsWith("0x") ? key : "0x" + key, provider);
        const writer = readContract.connect(signer);
        const block = await provider.getBlock("latest");
        if (block?.baseFeePerGas != null && block.baseFeePerGas > MAX_FEE_CAP) {
          throw new Refusal(`base fee ${block.baseFeePerGas} wei exceeds the 30 gwei cap`);
        }
        const fee = await provider.getFeeData();
        let maxFee = fee.maxFeePerGas ?? fee.gasPrice;
        if (maxFee == null) throw new Refusal("provider returned no fee data");
        if (maxFee > MAX_FEE_CAP) maxFee = MAX_FEE_CAP;
        let prio = fee.maxPriorityFeePerGas ?? 0n;
        if (prio > maxFee) prio = maxFee;
        const fees = { maxFeePerGas: maxFee, maxPriorityFeePerGas: prio };
        const gas = await writer[method].estimateGas(...args, fees);
        const cost = gas * maxFee;
        const balance = await provider.getBalance(signer.address);
        if (balance < cost) {
          throw new Refusal(`wallet balance ${balance} wei below estimated cost ${cost} wei`);
        }
        const tx = await writer[method](...args, { ...fees, gasLimit: (gas * 12n) / 10n });
        log("SEND", "-", `${network} ${method} broadcast`, tx.hash);
        const rc = await tx.wait(1, CONFIRM_TIMEOUT_MS);
        if (!rc || rc.status !== 1) throw new Error(`${method} reverted on chain`);
        return { hash: tx.hash, blockNumber: rc.blockNumber };
      },
    };
    cache.set(network, entry);
    return entry;
  };
}

// ---------- main ----------
export async function runAll(ctx) {
  const items = loadRecords(ctx.root);
  if (!items.length) ctx.log("MAIN", "-", "no records with filing.json; nothing to do");
  let errors = 0;
  errors += await stageFile(ctx, items);
  errors += await stageLand(ctx, loadRecords(ctx.root));
  const networks = [...new Set(items.map((i) => i.filing.network))];
  errors += await stageAuction(ctx, networks);
  return errors;
}

function makeLog() {
  return (stage, rec, action, tx) => {
    const parts = [new Date().toISOString(), stage, rec, action];
    if (tx) parts.push(tx);
    console.log(parts.join(" | "));
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const log = makeLog();
  let errors = 0;
  try {
    const ctx = {
      root,
      now: () => Math.floor(Date.now() / 1000),
      log,
      chain: makeRealChain(root, log),
    };
    errors = await runAll(ctx);
  } catch (e) {
    errors = 1;
    log("MAIN", "-", "ERROR " + safeErr(e));
  }
  process.exit(errors ? 1 : 0);
}
