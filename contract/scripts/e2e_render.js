/* Local end to end: deploy with the real scene, file, mint, read tokenURI sealed, land, read it declassified.
   Writes the animation_url HTML of each state to deployments-e2e/. Local hardhat node only. */
const fs=require("fs"), path=require("path"); const C=require("./lib/common.js"); const {ethers}=C;
(async()=>{ const {provider,wallet}=C.makeWallet(); if(!(await C.isLocal(provider))) throw new Error("local only");
  const st=JSON.parse(fs.readFileSync(path.join(process.env.DEPLOY_DIR,"sepolia.json"),"utf8"));
  const addr=JSON.parse(fs.readFileSync(path.join(process.env.DEPLOY_DIR,"sepolia.json"),"utf8")).contract.address;
  const art=C.loadArtifact(); const nm=new ethers.NonceManager(wallet); const bb=new ethers.Contract(addr,art.abi,nm);
  if(!(await bb.sceneLocked())) await (await bb.lockScene()).wait();
  const now=await C.chainNow(provider), rec=(await bb.recordCount())+1n;
  const ph=ethers.keccak256(ethers.toUtf8Bytes("M1E2E/SYNTHETIC "+now));
  await (await bb.file(rec,ph,325,now-1500,now+2100)).wait();
  const r=await bb.records(rec); await (await bb.mint(rec,{value:r.price})).wait(); await (await bb.mint(rec,{value:r.price})).wait();
  const out=path.join(process.env.DEPLOY_DIR,"..","deployments-e2e"); fs.mkdirSync(out,{recursive:true});
  const dump=async(id,tag)=>{ const uri=await bb.tokenURI(id,{gasLimit:60_000_000}); const j=JSON.parse(Buffer.from(uri.split(",")[1],"base64").toString());
    const html=Buffer.from(j.animation_url.split(",")[1],"base64").toString(); fs.writeFileSync(path.join(out,tag+".html"),html); fs.writeFileSync(path.join(out,tag+".json"),JSON.stringify({name:j.name,attributes:j.attributes},null,1));
    console.log(tag,"uri bytes",uri.length,"html bytes",html.length); };
  const tid=rec*100n+1n; await dump(tid,"sealed");
  await (await bb.land(rec,"DPS|TPE|2026-11-03|14A|325|3780|A333")).wait(); await dump(tid,"declassified"); await dump(rec*100n+2n,"declassified2");
})().catch(e=>{ console.error(e.shortMessage||e.message); process.exit(1); });
