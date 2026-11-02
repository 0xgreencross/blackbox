const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("fs"), path = require("path"), zlib = require("zlib"), crypto = require("crypto"), vm = require("vm");

const TREASURY = "0x2bCb25A1934D4696A0d733EF8f514095003C6a18";
const PAGE_SHA = "b638f728c8068f8892acf3772d7463f5cdb89e785c15a05757a7010cbc70e412";
const FIX = path.join(__dirname, "..", "fixtures");
const chunkBytes = () => fs.readdirSync(path.join(FIX, "chunks")).sort().map(f => fs.readFileSync(path.join(FIX, "chunks", f)));
const GAS = {};
const { coatScene, coatFont, uncoat, parts } = require("../scripts/coat.js");

/* deploys a contract whose runtime code is exactly `code` */
async function deployCode(signer, code) {
  const init = Buffer.concat([Buffer.from([0x61, code.length >> 8, code.length & 255, 0x80, 0x60, 0x0a, 0x3d, 0x39, 0x3d, 0xf3]), code]);
  const tx = await signer.sendTransaction({ data: "0x" + init.toString("hex") });
  const rc = await tx.wait();
  return rc.contractAddress;
}
const TEST_SCENE = 'window.BBGO.then(function(E){window.OUT={core:E.V3_CORE.length,core2:E.V3_CORE2.length,driver:E.V3_DRIVER.length,card:E.CARD_CH.length,seed:window.BB.seed,state:window.BB.state,font:window.BBF.trim().length};});';
const DOSSIER = "DPS|TPE|2026-11-03|14A|325|3780|A333";
const H = n => ethers.keccak256(ethers.toUtf8Bytes("M1SYNTHETIC/PASS " + n));

async function fixture({ lock = true } = {}) {
  const [owner, reg, a, b, c] = await ethers.getSigners();
  const chunks = [];
  for (const code of chunkBytes()) chunks.push(await deployCode(owner, code));
  const F = await ethers.getContractFactory("BLACKBOX");
  const bb = await F.deploy(chunks, reg.address);
  const drc = await bb.deploymentTransaction().wait(); GAS.deploy = drc.gasUsed;
  if (lock) {
    for (const p of parts(coatScene(TEST_SCENE))) await (await bb.addScene(p)).wait();
    for (const p of parts(coatFont(fs.readFileSync(path.join(FIX, "Silkscreen-Regular.ttf"))))) await (await bb.addFont(p)).wait();
    await (await bb.lockScene()).wait();
  }
  return { bb, chunks, owner, reg, a, b, c };
}
async function fileRec(bb, reg, rec, minutes = 325, hash = H(rec)) {
  const now = await time.latest();
  const tx = await bb.connect(reg).file(rec, hash, minutes, now, now + 6 * 3600);
  const rc = await tx.wait(); GAS.file = rc.gasUsed; return rc;
}
function decodeURI_(uri) {
  expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
  const json = JSON.parse(Buffer.from(uri.slice(29), "base64").toString("utf8"));
  const html = Buffer.from(json.animation_url.slice("data:text/html;base64,".length), "base64").toString("utf8");
  return { json, html };
}

describe("BLACKBOX", function () {
  it("rejects a swapped or missing engine chunk", async () => {
    const [owner, reg] = await ethers.getSigners();
    const codes = chunkBytes(); const chunks = [];
    for (const code of codes) chunks.push(await deployCode(owner, code));
    const F = await ethers.getContractFactory("BLACKBOX");
    const sw = chunks.slice(); [sw[0], sw[1]] = [sw[1], sw[0]];
    await expect(F.deploy(sw, reg.address)).to.be.revertedWith("not the page");
    await expect(F.deploy(chunks.slice(0, 13), reg.address)).to.be.revertedWith("not the page");
    await expect(F.deploy([...chunks.slice(0, 13), owner.address], reg.address)).to.be.revertedWith("a chunk is missing");
    const ok = await F.deploy(chunks, reg.address);
    expect(await ok.PAGE()).to.equal("0x4b3ffe1cab65c035925ab5d4062e182ce781cbf90d045d8b057950493666f72f");
  });

  it("cap and price table", async () => {
    const { bb } = await fixture({ lock: false });
    const exp = { 50: [1, "66600000000000000"], 90: [2, "62133333333333333"], 303: [5, "48733333333333333"], 325: [5, "48733333333333333"], 352: [6, "44266666666666666"], 695: [12, "17466666666666666"], 890: [13, "13000000000000000"], 29: [1, "66600000000000000"], 30: [1, "66600000000000000"] };
    for (const m in exp) {
      const cap = await bb.capFor(m); expect(Number(cap)).to.equal(exp[m][0], "cap " + m);
      expect((await bb.priceFor(cap)).toString()).to.equal(exp[m][1], "price " + m);
    }
  });

  it("file guards", async () => {
    const { bb, reg, a } = await fixture({ lock: false });
    const now = await time.latest();
    await expect(bb.connect(reg).file(1, H(1), 325, now, now + 3600)).to.be.revertedWithCustomError(bb, "NotLocked");
    await bb.addScene(coatScene(TEST_SCENE)); await bb.lockScene();
    await expect(bb.lockScene()).to.be.revertedWithCustomError(bb, "Locked");
    await expect(bb.addScene("0x01")).to.be.revertedWithCustomError(bb, "Locked");
    await expect(bb.connect(a).file(1, H(1), 325, now, now + 3600)).to.be.revertedWithCustomError(bb, "NotRegistrar");
    await expect(bb.connect(reg).file(2, H(1), 325, now, now + 3600)).to.be.revertedWithCustomError(bb, "BadRecord");
    await expect(bb.connect(reg).file(1, H(1), 325, now, now - 1)).to.be.revertedWith("deadline");
    await expect(bb.connect(reg).file(1, ethers.ZeroHash, 325, now, now + 3600)).to.be.revertedWith("hash");
    await expect(bb.connect(reg).file(1, H(1), 325, now, now + 3600)).to.emit(bb, "Filed");
    await expect(bb.connect(reg).file(2, H(1), 325, now, now + 3600)).to.be.revertedWith("hash");
    const r = await bb.records(1);
    expect(r.cap).to.equal(5); expect(r.price).to.equal(48733333333333333n); expect(await bb.recordCount()).to.equal(1);
  });

  it("mint: exact price, forwards to treasury, cap and window, land closes", async () => {
    const { bb, reg, a, b } = await fixture();
    await fileRec(bb, reg, 1, 50); // cap 1, unique
    const r = await bb.records(1);
    await expect(bb.connect(a).mint(1, { value: r.price - 1n })).to.be.revertedWithCustomError(bb, "WrongPrice");
    await expect(bb.connect(a).mint(1, { value: r.price + 1n })).to.be.revertedWithCustomError(bb, "WrongPrice");
    const before = await ethers.provider.getBalance(TREASURY);
    const tx = await bb.connect(a).mint(1, { value: r.price }); const rc = await tx.wait(); GAS.mint = rc.gasUsed;
    expect(await ethers.provider.getBalance(TREASURY) - before).to.equal(r.price);
    expect(await ethers.provider.getBalance(await bb.getAddress())).to.equal(0n);
    expect(await bb.ownerOf(101)).to.equal(a.address);
    await expect(bb.connect(b).mint(1, { value: r.price })).to.be.revertedWithCustomError(bb, "SoldOut");
    await fileRec(bb, reg, 2, 325);
    const p2 = (await bb.records(2)).price;
    await bb.connect(b).mint(2, { value: p2 });
    await time.increase(6 * 3600 + 1);
    await expect(bb.connect(b).mint(2, { value: p2 })).to.be.revertedWithCustomError(bb, "WindowClosed");
    await fileRec(bb, reg, 3, 325);
    await expect(bb.connect(a).land(3, DOSSIER)).to.be.revertedWithCustomError(bb, "NotRegistrar");
    await expect(bb.connect(reg).land(3, 'DPS|TPE|"x|14A|325|3780|A333')).to.be.revertedWithCustomError(bb, "BadDossier");
    await expect(bb.connect(reg).land(3, "DPS|TPE|2026")).to.be.revertedWithCustomError(bb, "BadDossier");
    const lt = bb.connect(reg).land(3, DOSSIER);
    await expect(lt).to.emit(bb, "BatchMetadataUpdate").withArgs(301, 301).and.to.emit(bb, "MetadataUpdate").withArgs(0);
    GAS.land = (await (await lt).wait()).gasUsed;
    await expect(bb.connect(reg).land(3, DOSSIER)).to.be.revertedWithCustomError(bb, "BadRecord");
    await expect(bb.connect(a).mint(3, { value: (await bb.records(3)).price })).to.be.revertedWithCustomError(bb, "WindowClosed");
    await expect(bb.connect(reg).land(9, DOSSIER)).to.be.revertedWithCustomError(bb, "BadRecord");
    const now = await time.latest();
    await bb.connect(reg).file(4, H(4), 325, now + 600, now + 7200);
    await expect(bb.connect(a).mint(4, { value: (await bb.records(4)).price })).to.be.revertedWithCustomError(bb, "WindowClosed");
  });

  it("tokenURI: three coats decode to the exact on-chain page; sealed leaks nothing; loader runs", async () => {
    const { bb, reg, a } = await fixture();
    await fileRec(bb, reg, 1, 325);
    await bb.connect(a).mint(1, { value: (await bb.records(1)).price });
    GAS.tokenURI_sealed = await bb.tokenURI.estimateGas(101);
    let { json, html } = decodeURI_(await bb.tokenURI(101));
    expect(json.name).to.equal("BLACKBOX REC 001 // 01");
    const s = JSON.stringify(json) + html.slice(0, 2000);
    for (const leak of ["DPS", "TPE", "14A", "2026-11-03", "ROUTE", "SEAT", "dossier"]) expect(s.includes(leak)).to.equal(false, "sealed leaks " + leak);
    expect(json.attributes.map(x => x.trait_type)).to.deep.equal(["REC", "STATE", "HASH"]);
    const m = html.match(/atob\("([A-Za-z0-9+\/=\s]+)"\)/);
    const gz = Buffer.from(m[1].trim(), "base64");
    const page = zlib.gunzipSync(gz);
    expect(crypto.createHash("sha256").update(page).digest("hex")).to.equal(PAGE_SHA);
    expect(Buffer.from(json.image.slice(26), "base64").toString().includes("REC 001 // 01")).to.equal(true);
    for (const ch of JSON.stringify(json)) expect(ch).to.not.equal("—");
    // run the loader exactly as a browser would: it must hand the scene the three cores and the card list
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
    const ctx = { window: {}, atob: x => Buffer.from(x, "base64").toString("latin1"), Uint8Array, DecompressionStream, Response, JSON, Error, String, console };
    ctx.window = ctx; vm.createContext(ctx);
    for (const sc of scripts) vm.runInContext(sc, ctx);
    await ctx.BBGO; await new Promise(r => setTimeout(r, 50));
    expect(ctx.OUT).to.deep.equal({ core: 177039, core2: 1129, driver: 13772, card: 37, seed: Number(await bb.seedOf(101)), state: "SEALED", font: Math.ceil(32220 / 3) * 4 });
    // declassified
    await bb.connect(reg).land(1, DOSSIER);
    GAS.tokenURI_declassified = await bb.tokenURI.estimateGas(101);
    ({ json, html } = decodeURI_(await bb.tokenURI(101)));
    const at = Object.fromEntries(json.attributes.map(x => [x.trait_type, x.value]));
    expect(at.ROUTE).to.equal("DPS > TPE"); expect(at.SEAT).to.equal("14A"); expect(at.KM).to.equal("3780"); expect(at["EDITION CAP"]).to.equal(5); expect(at.MINTED).to.equal(1);
    expect(html.includes('"dossier":"' + DOSSIER + '"')).to.equal(true);
    const seed = BigInt(ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256"], [H(1), 1])).slice(0, 10));
    expect(await bb.seedOf(101)).to.equal(seed);
  });

  it("auction: start rules, increments, extension, refund, refused-refund fallback, settle forwards", async () => {
    const { bb, reg, a, b, owner } = await fixture();
    await expect(bb.startAuction(0, 3600, 0)).to.be.revertedWith("auction");
    await fileRec(bb, reg, 1, 325); await bb.connect(reg).land(1, DOSSIER);
    await fileRec(bb, reg, 2, 695);
    await expect(bb.startAuction(0, 3600, 0)).to.be.revertedWith("auction");          // a record still in the air
    await bb.connect(reg).land(2, "TPE|LAX|2026-11-03|41K|695|10900|B77W");
    await expect(bb.connect(a).startAuction(0, 3600, 0)).to.be.revertedWithCustomError(bb, "OwnableUnauthorizedAccount");
    const now = await time.latest();
    await expect(bb.startAuction(now + 10, 3600, ethers.parseEther("0.1"))).to.emit(bb, "MetadataUpdate").withArgs(0);
    expect(await bb.journeyCount()).to.equal(2);
    await expect(bb.startAuction(now + 10, 3600, 0)).to.be.revertedWithCustomError(bb, "AuctionState");
    const t0 = await time.latest();
    await expect(bb.connect(reg).file(3, H(3), 325, t0, t0 + 3600)).to.be.revertedWithCustomError(bb, "AuctionState");
    await expect(bb.connect(a).bid({ value: ethers.parseEther("0.1") })).to.be.revertedWithCustomError(bb, "AuctionState");
    await time.increase(20);
    await expect(bb.connect(a).bid({ value: ethers.parseEther("0.09") })).to.be.revertedWithCustomError(bb, "LowBid");
    const R = await (await ethers.getContractFactory("RefuseBidder")).deploy();
    await R.bid(await bb.getAddress(), { value: ethers.parseEther("0.1") });
    await expect(bb.connect(a).bid({ value: ethers.parseEther("0.109") })).to.be.revertedWithCustomError(bb, "LowBid");
    await bb.connect(a).bid({ value: ethers.parseEther("0.11") });               // R refuses its refund: held for it
    expect(await bb.pendingReturns(await R.getAddress())).to.equal(ethers.parseEther("0.1"));
    const bBefore = await ethers.provider.getBalance(a.address);
    await bb.connect(b).bid({ value: ethers.parseEther("0.2") });                // a is refunded by push
    expect(await ethers.provider.getBalance(a.address) - bBefore).to.equal(ethers.parseEther("0.11"));
    await R.setAccept(true); await R.pull(await bb.getAddress());
    expect(await ethers.provider.getBalance(await R.getAddress())).to.equal(ethers.parseEther("0.1"));
    const end0 = (await bb.auction()).end;
    await time.increaseTo(Number(end0) - 60);
    await bb.connect(a).bid({ value: ethers.parseEther("0.3") });                // last minutes: extends
    const end1 = (await bb.auction()).end;
    expect(end1).to.be.greaterThan(end0);
    await expect(bb.settleAuction()).to.be.revertedWithCustomError(bb, "AuctionState");
    await time.increaseTo(Number(end1));
    const before = await ethers.provider.getBalance(TREASURY);
    await expect(bb.connect(b).settleAuction()).to.emit(bb, "MetadataUpdate").withArgs(0);
    expect(await ethers.provider.getBalance(TREASURY) - before).to.equal(ethers.parseEther("0.3"));
    expect(await bb.ownerOf(0)).to.equal(a.address);
    expect(await ethers.provider.getBalance(await bb.getAddress())).to.equal(0n);
    await expect(bb.settleAuction()).to.be.revertedWithCustomError(bb, "AuctionState");
    GAS.tokenURI_journey = await bb.tokenURI.estimateGas(0);
    const { json } = decodeURI_(await bb.tokenURI(0));
    expect(json.name).to.include("THE COMPLETE JOURNEY");
    expect(await bb.seedOf(0)).to.equal(BigInt(ethers.keccak256(ethers.concat([H(1), H(2)])).slice(0, 10)));
  });

  it("auction with no bids is void, mints nothing, and can be started again; filing stays closed", async () => {
    const { bb, reg, a } = await fixture();
    await fileRec(bb, reg, 1, 325); await bb.connect(reg).land(1, DOSSIER);
    const now = await time.latest(); await bb.startAuction(now, 100, 0);
    await time.increase(200);
    await expect(bb.settleAuction()).to.emit(bb, "AuctionVoid");
    await expect(bb.ownerOf(0)).to.be.revertedWithCustomError(bb, "ERC721NonexistentToken");
    expect((await bb.auction()).end).to.equal(0n);
    expect(await bb.journeyCount()).to.equal(1);
    const t = await time.latest(); await bb.startAuction(t, 100, 0);
    await bb.connect(a).bid({ value: 1n }); await time.increase(700); await bb.settleAuction();   // a bid in the last 10 minutes extends to now + 10 min
    expect(await bb.ownerOf(0)).to.equal(a.address);
  });

  it("ERC-4906 interface, no renounce", async () => {
    const { bb } = await fixture({ lock: false });
    expect(await bb.supportsInterface("0x49064906")).to.equal(true);
    expect(await bb.supportsInterface("0x2a55205a")).to.equal(true);
    expect(await bb.supportsInterface("0x80ac58cd")).to.equal(true);
    await expect(bb.renounceOwnership()).to.be.revertedWith("no renounce");
  });

  it("tokenURI gas with a 25 KB scene and the real Silkscreen font through coat.js", async () => {
    const [owner, reg, a] = await ethers.getSigners();
    const chunks = []; for (const code of chunkBytes()) chunks.push(await deployCode(owner, code));
    const bb = await (await ethers.getContractFactory("BLACKBOX")).deploy(chunks, reg.address);
    const scene = TEST_SCENE + "\n/*" + "x".repeat(25000 - TEST_SCENE.length - 5) + "*/";
    expect(Buffer.byteLength(scene)).to.equal(25000);
    let sceneGas = 0n, fontGas = 0n, sParts = 0, fParts = 0;
    for (const p of parts(coatScene(scene))) { sceneGas += (await (await bb.addScene(p)).wait()).gasUsed; sParts++; }
    for (const p of parts(coatFont(fs.readFileSync(path.join(FIX, "Silkscreen-Regular.ttf"))))) { fontGas += (await (await bb.addFont(p)).wait()).gasUsed; fParts++; }
    await bb.lockScene();
    expect(uncoat(await bb.scene().then(h => Buffer.from(h.slice(2), "hex")))).to.equal(scene);
    await fileRec(bb, reg, 1, 325);
    await bb.connect(a).mint(1, { value: (await bb.records(1)).price });
    GAS.upload_scene_25KB = sceneGas + " (" + sParts + " parts)"; GAS.upload_font = fontGas + " (" + fParts + " parts)";
    GAS.tokenURI_25KB_scene_real_font = await bb.tokenURI.estimateGas(101);
    const { html } = decodeURI_(await bb.tokenURI(101));
    expect(html.includes("x".repeat(100))).to.equal(true);
  });

  it("royalty and stray ETH", async () => {
    const { bb, a } = await fixture({ lock: false });
    const [rcv, amt] = await bb.royaltyInfo(101, ethers.parseEther("1"));
    expect(rcv).to.equal(TREASURY); expect(amt).to.equal(ethers.parseEther("0.069"));
    const before = await ethers.provider.getBalance(TREASURY);
    await a.sendTransaction({ to: await bb.getAddress(), value: 12345n });
    await expect(a.sendTransaction({ to: await bb.getAddress(), value: 5n, data: "0xdeadbeef" })).to.be.reverted;
    expect(await ethers.provider.getBalance(TREASURY) - before).to.equal(12345n);
    expect(await ethers.provider.getBalance(await bb.getAddress())).to.equal(0n);
  });

  after(() => { console.log("\nGAS", Object.fromEntries(Object.entries(GAS).map(([k, v]) => [k, v.toString()]))); });
});
