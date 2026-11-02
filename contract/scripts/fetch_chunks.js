// Reads the 14 GLASS chunk runtime codes from mainnet and saves them as fixtures.
const fs=require("fs"), path=require("path");
const RPC="https://ethereum-rpc.publicnode.com";
const ADDRS="0xcc2dc32902c3e9086720e05706295596fc4e05c9 0x286ec608e5796637ec244d381ef0623c50b5dafd 0x4e16485d3e0a7c384bd47972d3ec4d26e1307848 0x59c76dde76ea03ccd05b67574a7583ab57b359c0 0xa0a5f3b3c07cf63d3b59b820dd2a6b26801bcca1 0xa0ccafc21d02e9c497d5704a00ecb359e6120077 0x5763dc686f818a0a0b2eb6b9ae8c77bc7693aeed 0x3efb0a04695b5f39723c637a3dc0f9795d045990 0xac9a95d76f8a2fea920a340feafe12ca19b8e670 0x37bcc8c203eca2eb1e814f04443d6224aa0cf7af 0x203c2f00014fb5c614c4c0845f13c3746724a3ba 0xa20d09f1bdab0ce453b9c182680b2d6737da53f1 0xe3165d058cae493f06dc2b232ef6483cb19c8b28 0x9e7a8961611d093abeb4ce94c53e88b3e054bf69".split(" ");
(async()=>{ for(let i=0;i<ADDRS.length;i++){
  const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json","user-agent":"curl/8"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getCode",params:[ADDRS[i],"latest"]})}).then(r=>r.json());
  fs.writeFileSync(path.join(__dirname,"..","fixtures","chunks",String(i).padStart(2,"0")+".bin"),Buffer.from(r.result.slice(2),"hex"));
  console.log(i,ADDRS[i],(r.result.length-2)/2); } })();
