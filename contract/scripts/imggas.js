const { ethers } = require("hardhat");
(async()=>{ const img=await (await ethers.getContractFactory("BlackboxImage")).deploy();
 for (const [s,m] of [[true,[325]],[false,[325]],[false,[325,695]],[false,[325,695,303,352,890,325]]]) console.log(s?"sealed":"open", m.length, (await img.render.estimateGas(s, 1483259616, m)).toString());
})();
