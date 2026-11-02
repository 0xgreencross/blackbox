/* Coats the scene and the typeface for BLACKBOX.addScene / addFont.
   coat = base64(base64(x padded with spaces to a multiple of 9)). For the scene x is the script;
   for the typeface x is base64(TTF). Parts are cut at 24,000 bytes. Usage as a module, or:
   node scripts/coat.js scene.js font.ttf   -> writes coated/scene.coat and coated/font.coat, prints parts. */
const fs = require("fs"), path = require("path");
const pad9 = b => Buffer.concat([b, Buffer.alloc((9 - (b.length % 9)) % 9, 0x20)]);
const coat2 = b => Buffer.from(Buffer.from(pad9(b).toString("base64")).toString("base64"));
function coatScene(src) {
  const b = Buffer.from(src, "utf8");
  if (/<\/script/i.test(src)) throw new Error("the scene may not contain </script");
  return coat2(b);
}
function coatFont(ttf) { return coat2(Buffer.from(ttf.toString("base64"))); }
const uncoat = c => Buffer.from(Buffer.from(c.toString(), "base64").toString(), "base64").toString().replace(/ +$/, "");
const parts = (buf, n = 24000) => { const out = []; for (let o = 0; o < buf.length; o += n) out.push(buf.subarray(o, o + n)); return out; };
module.exports = { coatScene, coatFont, uncoat, parts };
if (require.main === module) {
  const [scenePath, fontPath] = process.argv.slice(2);
  fs.mkdirSync("coated", { recursive: true });
  const sc = coatScene(fs.readFileSync(scenePath, "utf8")), fc = coatFont(fs.readFileSync(fontPath));
  if (uncoat(sc) !== fs.readFileSync(scenePath, "utf8").replace(/ +$/, "")) throw new Error("scene round trip");
  fs.writeFileSync("coated/scene.coat", sc); fs.writeFileSync("coated/font.coat", fc);
  console.log("scene", sc.length, "bytes,", parts(sc).length, "parts; font", fc.length, "bytes,", parts(fc).length, "parts");
}
