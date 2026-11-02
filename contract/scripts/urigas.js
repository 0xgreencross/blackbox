// One-shot tokenURI gas: eth_estimateGas on the direct call (what an RPC charges) and the in-EVM probe figure.
const { ethers } = require("hardhat"); const fs=require("fs"),path=require("path");
const { coatScene, coatFont, parts } = require("./coat.js");
async function deployCode(s,c){ const i=Buffer.concat([Buffer.from([0x61,c.length>>8,c.length&255,0x80,0x60,0x0a,0x3d,0x39,0x3d,0xf3]),c]); return (await (await s.sendTransaction({data:"0x"+i.toString("hex")})).wait()).contractAddress; }
async function main(){ console.log("start NJ", process.env.NJ); const [o,reg,a]=await ethers.getSigners(); const D=path.join(__dirname,"..","fixtures","chunks"); const ch=[]; for(const f of fs.readdirSync(D).sort()) ch.push(await deployCode(o,fs.readFileSync(path.join(D,f))));
 const bb=await (await ethers.getContractFactory("BLACKBOX")).deploy(ch,reg.address);
 const scenePath=process.argv[2]||path.join(__dirname,"..","scene","blackbox_scene.js");
 const scene=fs.existsSync(scenePath)?fs.readFileSync(scenePath,"utf8"):"window.BBGO.then(function(E){});";
 for(const p of parts(coatScene(scene))) await bb.addScene(p);
 for(const p of parts(coatFont(fs.readFileSync(path.join(__dirname,"..","fixtures","Silkscreen-Regular.ttf"))))) await bb.addFont(p);
 await bb.lockScene();
 const now=(await ethers.provider.getBlock("latest")).timestamp;
 await bb.connect(reg).file(1,ethers.keccak256("0x01"),325,now,now+99999); await bb.connect(a).mint(1,{value:(await bb.records(1)).price});
 const out={scene_bytes:Buffer.byteLength(scene)};
 out.sealed=(await bb.tokenURI.estimateGas(101)).toString();
 await bb.connect(reg).land(1,"DPS|TPE|2026-11-03|14A|325|3780|A333"); out.declassified=(await bb.tokenURI.estimateGas(101)).toString();
 const legs=[[695,"TPE|LAX|2026-11-03|41K|695|10900|B77W"],[303,"LAX|MIA|2026-11-04|22F|303|3760|A321"],[352,"MIA|LAX|2026-12-08|22F|352|3760|A321"],[890,"LAX|TPE|2026-12-08|41K|890|10900|B77W"],[325,"TPE|DPS|2026-12-10|33A|325|3780|A333"]];
 const NJ=+(process.env.NJ||2);
 for(let i=0;i<NJ-1;i++){ const L=legs[i%legs.length]; await bb.connect(reg).file(i+2,ethers.keccak256(ethers.toBeHex(i+2,32)),L[0],now,now+99999); await bb.connect(reg).land(i+2,L[1]); }
 const img=await ethers.getContractAt("BlackboxImage", await bb.imager()); const mins=[]; for(let i=1;i<=NJ;i++) mins.push(Number((await bb.records(i)).blockMinutes));
 out['render_only_'+NJ+'rec']=(await img.render.estimateGas(false, Number(await bb.seedOf(0)), mins)).toString();
 const t=(await ethers.provider.getBlock("latest")).timestamp; await bb.startAuction(t,100,0); await bb.connect(a).bid({value:1n});
 await ethers.provider.send("evm_increaseTime",[1000]); await ethers.provider.send("evm_mine",[]); await bb.settleAuction();
 const P=await (await ethers.getContractFactory("GasProbe")).deploy(); const [g,len]=await P.measure(await bb.getAddress(),0,{gasLimit:60000000});
 out['journey_'+NJ+'rec_probe_exec']=g.toString(); out['journey_uri_bytes']=len.toString();
 if(NJ<=2) out['journey_'+NJ+'rec_estimate']=(await bb.tokenURI.estimateGas(0)).toString();
 console.log(JSON.stringify(out)); fs.writeFileSync("urigas.out.json", JSON.stringify(out));
}
main().catch(e=>{ console.error('FAILED', e && e.message); process.exitCode=1; });
