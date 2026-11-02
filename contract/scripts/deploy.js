#!/usr/bin/env node
/* Plain ethers v6 deploy for BLACKBOX. Not hardhat-run: uses the compiled artifact.
   env:  RPC_URL  DEPLOYER_KEY  NETWORK (sepolia|mainnet)  SCENE_PATH  MAX_GWEI (default 30)
         DEPLOY_DIR (optional, default contract/deployments)
   args: --chunks            deploy the 14 chunk copies from fixtures (sepolia only)
         --registrar ADDR    registrar address, or "self" for the deployer
         --lock              also call lockScene (never done unless asked)
         --fresh             archive an existing state file and start over
   Idempotent: deployments/NETWORK.json records tx hash and address per step; a rerun checks the
   chain and skips completed steps. The key is never printed. */
const fs = require("fs"), path = require("path");
const C = require("./lib/common.js");
const { ethers } = C;
const { coatScene, coatFont, parts } = require("./coat.js");

const GLASS = "0xF125024a394C0518D85D7a416cc9df96177107f4";
const FIX = path.join(__dirname, "..", "fixtures");
const chunkBytes = () => fs.readdirSync(path.join(FIX, "chunks")).sort().map(f => fs.readFileSync(path.join(FIX, "chunks", f)));

/* runtime code deployer, as in test/blackbox.test.js */
const initFor = code => "0x" + Buffer.concat([Buffer.from([0x61, code.length >> 8, code.length & 255, 0x80, 0x60, 0x0a, 0x3d, 0x39, 0x3d, 0xf3]), code]).toString("hex");

async function main() {
  const args = C.parseArgs(process.argv.slice(2));
  const network = process.env.NETWORK;
  if (!["sepolia", "mainnet"].includes(network)) throw new Error("NETWORK must be sepolia or mainnet");
  const useChunks = args.flags.has("chunks"), doLock = args.flags.has("lock");
  if (useChunks && network !== "sepolia") throw new Error("--chunks is only allowed when NETWORK=sepolia");
  if (!process.env.SCENE_PATH) throw new Error("SCENE_PATH is required");
  if (!args.values.registrar) throw new Error("--registrar ADDRESS (or self) is required");
  const maxGwei = process.env.MAX_GWEI || "30";

  const { provider, wallet } = C.makeWallet();
  const me = wallet.address;
  const chainId = (await provider.getNetwork()).chainId;
  const local = chainId === 31337n;
  if (!(chainId === C.CHAIN_IDS[network] || (local && network === "sepolia")))
    throw new Error(`chainId ${chainId} does not match NETWORK=${network}`);
  const registrar = args.values.registrar === "self" ? me : ethers.getAddress(args.values.registrar);

  const art = C.loadArtifact();
  const statePath = path.join(C.deployDir(), network + ".json");
  if (args.flags.has("fresh") && fs.existsSync(statePath)) {
    const arch = statePath.replace(/\.json$/, "." + Date.now() + ".json");
    fs.renameSync(statePath, arch); console.log("archived old state to", path.basename(arch));
  }
  const st = C.readJson(statePath, null) || { network, chainId: chainId.toString(), steps: {} };
  if (st.chainId !== chainId.toString()) throw new Error("state file chainId differs from the connected chain");
  if (st.deployer && st.deployer !== me) throw new Error("state file was made by a different deployer");
  st.deployer = me; st.registrar = registrar; st.chunks ||= []; st.scene ||= []; st.font ||= [];
  const save = () => C.writeJson(statePath, st);
  save();

  console.log(`network ${network} chainId ${chainId} deployer ${me} registrar ${registrar} maxGwei ${maxGwei}`);
  const bal = await provider.getBalance(me);
  console.log("deployer balance", ethers.formatEther(bal), "ETH");

  /* send, record the hash at once (so a crash can be resumed), then wait */
  async function send(label, slot, build) {
    const tx = await build(await C.opts(provider, me, maxGwei));
    slot.tx = tx.hash; save();
    console.log(`  tx ${label}: ${tx.hash}`);
    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error(label + " reverted: " + tx.hash);
    slot.block = rc.blockNumber; slot.gasUsed = rc.gasUsed.toString();
    return rc;
  }
  /* a recorded tx that is still pending: wait for it instead of sending again */
  async function resume(slot) {
    if (!slot.tx) return null;
    const rc = await provider.getTransactionReceipt(slot.tx);
    if (rc) return rc.status === 1 ? rc : null;
    if (await provider.getTransaction(slot.tx)) { console.log("  waiting for pending", slot.tx); return provider.waitForTransaction(slot.tx, 1, 600000); }
    return null;
  }

  // ---------------------------------------------------------------- chunks
  let chunkAddrs;
  const want = chunkBytes();
  if (useChunks) {
    chunkAddrs = [];
    for (let i = 0; i < want.length; i++) {
      const slot = (st.chunks[i] ||= {});
      const ok = async a => a && ethers.keccak256(await provider.getCode(a)) === ethers.keccak256("0x" + want[i].toString("hex"));
      if (!(await ok(slot.address))) {
        const rc = await resume(slot);
        if (rc && (await ok(rc.contractAddress))) slot.address = rc.contractAddress;
        else {
          delete slot.tx; delete slot.address;
          const r = await send(`chunk ${i}`, slot, f => wallet.sendTransaction({ data: initFor(want[i]), ...f }));
          slot.address = r.contractAddress;
          if (!(await ok(slot.address))) throw new Error("chunk " + i + " code mismatch after deploy");
        }
        save();
      } else console.log(`  chunk ${i} ok ${slot.address}`);
      chunkAddrs.push(slot.address);
    }
  } else {
    const glass = new ethers.Contract(GLASS, ["function chunks() view returns (address[])"], provider);
    chunkAddrs = [...(await glass.chunks())];
    if (chunkAddrs.length !== want.length) throw new Error("GLASS returned " + chunkAddrs.length + " chunks");
    for (let i = 0; i < want.length; i++)
      if (ethers.keccak256(await provider.getCode(chunkAddrs[i])) !== ethers.keccak256("0x" + want[i].toString("hex")))
        throw new Error("GLASS chunk " + i + " does not match the fixture bytes");
    st.chunks = chunkAddrs.map(address => ({ address, source: "GLASS" }));
    console.log("  chunks read from GLASS and verified against fixtures"); save();
  }

  // ---------------------------------------------------------------- contract
  const cslot = (st.contract ||= {});
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  async function contractOk() {
    if (!cslot.address || (await provider.getCode(cslot.address)) === "0x") return false;
    const c = new ethers.Contract(cslot.address, art.abi, provider);
    if ((await c.registrar()).toLowerCase() !== registrar.toLowerCase()) throw new Error("deployed registrar differs from --registrar");
    const eng = await c.engineChunks();
    if (eng.join() !== chunkAddrs.join()) throw new Error("deployed contract uses different chunks than this run");
    return true;
  }
  if (!(await contractOk())) {
    const rc = await resume(cslot);
    if (rc && rc.contractAddress) cslot.address = rc.contractAddress;
    else {
      delete cslot.tx; delete cslot.address;
      const r = await send("BLACKBOX", cslot, async f => {
        const dtx = await factory.getDeployTransaction(chunkAddrs, registrar);
        return wallet.sendTransaction({ ...dtx, ...f });
      });
      cslot.address = r.contractAddress;
    }
    save();
    if (!(await contractOk())) throw new Error("contract check failed after deploy");
  } else console.log("  BLACKBOX ok", cslot.address);
  const bb = new ethers.Contract(cslot.address, art.abi, wallet);
  if ((await bb.owner()).toLowerCase() !== me.toLowerCase()) throw new Error("deployer is not the contract owner");

  // ---------------------------------------------------------------- scene and font
  const sceneSrc = fs.readFileSync(process.env.SCENE_PATH, "utf8");
  async function upload(name, coated, fn, view) {
    const ps = parts(coated);
    const onchain = Buffer.from((await bb[view]()).slice(2), "hex");
    if (!coated.subarray(0, onchain.length).equals(onchain)) throw new Error(`on-chain ${name} is not a prefix of the file given (different content)`);
    if (onchain.length !== coated.length && onchain.length % 24000 !== 0) throw new Error(`on-chain ${name} has an odd length, refusing to continue`);
    const done = onchain.length === coated.length ? ps.length : onchain.length / 24000;
    const locked = await bb.sceneLocked();
    if (done < ps.length && locked) throw new Error(`${name} is incomplete but the scene is locked`);
    for (let i = 0; i < ps.length; i++) {
      const slot = (st[name][i] ||= {});
      if (i < done) { console.log(`  ${name} part ${i + 1}/${ps.length} ok`); continue; }
      delete slot.tx;
      await send(`${name} part ${i + 1}/${ps.length}`, slot, f => bb[fn](ps[i], f));
      save();
    }
    st[name].length = ps.length;
    const after = Buffer.from((await bb[view]()).slice(2), "hex");
    if (!after.equals(coated)) throw new Error(name + " on chain differs from the coated file");
    st[name + "Bytes"] = coated.length; save();
  }
  await upload("scene", coatScene(sceneSrc), "addScene", "scene");
  await upload("font", coatFont(fs.readFileSync(path.join(FIX, "Silkscreen-Regular.ttf"))), "addFont", "font");

  // ---------------------------------------------------------------- lock (only on request)
  if (await bb.sceneLocked()) { console.log("  scene is locked"); }
  else if (doLock) {
    const slot = (st.lock ||= {}); delete slot.tx;
    await send("lockScene", slot, f => bb.lockScene(f)); save();
  } else console.log("  scene NOT locked (pass --lock to lock)");

  st.done = true; st.updatedAt = new Date().toISOString(); save();
  console.log("deploy complete. contract", cslot.address);
  console.log("state", statePath);
}
main().catch(e => { console.error("DEPLOY FAILED:", e.shortMessage || e.message); if (process.env.DEBUG) console.error(e); process.exit(1); });
