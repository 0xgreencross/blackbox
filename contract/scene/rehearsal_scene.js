/* Rehearsal scene. It only proves the loader path: window.BB (the record), window.BBF (the typeface as
   base64 TTF, space padded) and window.BBGO (resolves to the engine cores). Draws black and the label. */
window.BBGO.then(function (E) {
  var BB = window.BB, c = document.createElement("canvas");
  var S = Math.min(innerWidth, innerHeight) || 600;
  c.width = c.height = S;
  c.style.cssText = "display:block;margin:auto;position:absolute;inset:0;width:" + S + "px;height:" + S + "px";
  document.body.appendChild(c);
  var x = c.getContext("2d");
  function draw() {
    x.fillStyle = "#000"; x.fillRect(0, 0, S, S);
    x.fillStyle = "#fff"; x.textAlign = "center";
    x.font = Math.floor(S / 14) + "px Silkscreen, monospace";
    x.fillText(BB.label || "BLACKBOX", S / 2, S / 2);
    x.fillStyle = "#55555e";
    x.font = Math.floor(S / 28) + "px Silkscreen, monospace";
    x.fillText(BB.state + " // cores " + (E.V3_CORE ? E.V3_CORE.length : 0), S / 2, S / 2 + S / 12);
  }
  draw();
  try {
    var f = new FontFace("Silkscreen", "url(data:font/ttf;base64," + window.BBF.trim() + ")");
    f.load().then(function (ff) { document.fonts.add(ff); draw(); });
  } catch (e) {}
});
