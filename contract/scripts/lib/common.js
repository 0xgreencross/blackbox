/* Shared helpers for deploy.js and rehearse.js. Plain ethers v6, no hardhat runtime. */
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..", "..");
const ARTIFACT = path.join(ROOT, "artifacts", "contracts", "BLACKBOX.sol", "BLACKBOX.json");
const deployDir = () => process.env.DEPLOY_DIR || path.join(ROOT, "deployments");
const CHAIN_IDS = { sepolia: 11155111n, mainnet: 1n };

function loadArtifact() {
  if (!fs.existsSync(ARTIFACT)) throw new Error("artifact missing, run `npx hardhat compile` first: " + ARTIFACT);
  return JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
}

function parseArgs(argv) {
  const o = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registrar") o.values.registrar = argv[++i];
    else if (a.startsWith("--registrar=")) o.values.registrar = a.slice(12);
    else if (a.startsWith("--")) o.flags.add(a.slice(2));
    else throw new Error("unknown argument " + a);
  }
  return o;
}

function makeWallet() {
  const rpc = process.env.RPC_URL, k = process.env.DEPLOYER_KEY;
  if (!rpc) throw new Error("RPC_URL is required");
  if (!k) throw new Error("DEPLOYER_KEY is required");
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 1 });
  provider.pollingInterval = 1500;
  let wallet;
  try { wallet = new ethers.Wallet(k.startsWith("0x") ? k : "0x" + k, provider); }
  catch { throw new Error("DEPLOYER_KEY is not a valid private key (value not shown)"); }
  return { provider, wallet };
}

/* EIP-1559 fees with a hard ceiling. Refuses to send while the base fee is above the cap. */
async function fees(provider, maxGwei) {
  const cap = ethers.parseUnits(String(maxGwei), "gwei");
  const base = (await provider.getBlock("latest")).baseFeePerGas ?? 0n;
  if (base > cap) throw new Error(`base fee ${ethers.formatUnits(base, "gwei")} gwei is above MAX_GWEI ${maxGwei}`);
  const fd = await provider.getFeeData();
  let max = fd.maxFeePerGas ?? cap; if (max > cap) max = cap;
  let tip = fd.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei"); if (tip > max) tip = max;
  return { maxFeePerGas: max, maxPriorityFeePerGas: tip };
}

/* fees plus an explicit nonce read straight from the node (bypasses ethers' short read cache,
   which can hand back a stale count right after a tx is mined) */
async function opts(provider, address, maxGwei) {
  const f = await fees(provider, maxGwei);
  f.nonce = Number(await provider.send("eth_getTransactionCount", [address, "pending"]));
  return f;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function chainNow(provider) { return (await provider.getBlock("latest")).timestamp; }
async function isLocal(provider) { return (await provider.getNetwork()).chainId === 31337n; }

/* Move chain time to at least `ts`. Local node: evm_increaseTime + evm_mine. Live: poll block time. */
async function waitUntilChainTime(provider, ts, label = "") {
  if (await isLocal(provider)) {
    const now = await chainNow(provider);
    if (ts > now) { await provider.send("evm_increaseTime", [ts - now + 1]); await provider.send("evm_mine", []); }
    return;
  }
  let last = -1;
  for (;;) {
    const now = await chainNow(provider);
    if (now >= ts) return;
    const left = ts - now;
    if (left !== last) { console.log(`  waiting ${label}: chain time ${left}s short`); last = left; }
    await sleep(Math.min(Math.max(left * 250, 1500), 6000));
  }
}

function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; } }
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n"); }

module.exports = { ethers, ROOT, ARTIFACT, CHAIN_IDS, deployDir, loadArtifact, parseArgs, makeWallet, fees, opts, sleep, chainNow, isLocal, waitUntilChainTime, readJson, writeJson };
