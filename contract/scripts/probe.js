const { ethers } = require("hardhat"); const fs=require("fs"),path=require("path");
async function deployCode(signer, code){ const init=Buffer.concat([Buffer.from([0x61,code.length>>8,code.length&255,0x80,0x60,0x0a,0x3d,0x39,0x3d,0xf3]),code]); return (await (await signer.sendTransaction({data:"0x"+init.toString("hex")})).wait()).contractAddress; }
(async()=>{ const [o,reg,a]=await ethers.getSigners(); const D=path.join(__dirname,"..","fixtures","chunks"); const ch=[]; for(const f of fs.readdirSync(D).sort()) ch.push(await deployCode(o,fs.readFileSync(path.join(D,f))));
 const bb=await (await ethers.getContractFactory("BLACKBOX")).deploy(ch,reg.address);
 await bb.addScene(ethers.toUtf8Bytes("window.BBGO.then(function(E){});")); const font=fs.readFileSync(path.join(__dirname,"..","fixtures","Silkscreen-Regular.ttf")); for(let x=0;x<font.length;x+=24000) await bb.addFont(font.subarray(x,x+24000)); await bb.lockScene();
 const now=(await ethers.provider.getBlock("latest")).timestamp; await bb.connect(reg).file(1,ethers.keccak256("0x01"),325,now,now+9999);
 await bb.connect(a).mint(1,{value:(await bb.records(1)).price});
 const t=[["coat",()=>bb.coat()],["scene",()=>bb.scene()],["font",()=>bb.font()]];
 for(const [n,f] of t){ const r=await f(); console.log(n,(r.length-2)/2, process.memoryUsage().rss>>20,"MB"); }
 console.time("uri"); const u=await bb.tokenURI(101); console.timeEnd("uri"); console.log("uri len",u.length, process.memoryUsage().rss>>20,"MB");
 console.log("gas", (await bb.tokenURI.estimateGas(101)).toString(), process.memoryUsage().rss>>20,"MB");
})();
