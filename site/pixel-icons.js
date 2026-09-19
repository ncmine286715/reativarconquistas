/* ReativaConquistas — icones pixel-art 100% locais (sem upload).
   Trofeu, espada e bloco de grama desenhados via canvas -> PNG (pack_icon.png).
   Expõe window.RC_icons: { list, make(id)->Promise<Uint8Array>, preview(canvas,id) }.
*/
(function () {
  "use strict";

  var PAL = {
    G: "#5EBB2B", g: "#3E8E1F",
    D: "#8A5A33", d: "#6B4226", s: "#4E2F1B",
    W: "#F2FBFF", L: "#4DE3E3",
    O: "#8A5A33", H: "#6B4226", h: "#4E2F1B",
    Y: "#FFC93C", y: "#D9962B"
  };

  var MAPS = {
    grama: [
      "GGGGGGGGGGGGGGGG",
      "GgGGGGgGGGGGGgGG",
      "GGGgGGGGGGgGGGGG",
      "gGGGGgGGGGGGGgGG",
      "DDDDDDDDDDDDDDDD",
      "DdDDDsDDDDDDsDDD",
      "DDDDDdDDDDdDDDDD",
      "DsDDDsDDDsDDDDdD",
      "DDDdDDDDDDdDDDDD",
      "DdDDDsDDDDDDsDDD",
      "DDDDDdDDDDdDDDDD",
      "DdDDDsDDDDDsDDDD",
      "DDDDDdDDDDdDDDDD",
      "DsDDDDDsDDDDDDdD",
      "DDDdDDDDDDdDDDDD",
      "dDdDdDdDdDdDdDdD"
    ],
    espada: [
      ".......WW.......",
      ".......WLW......",
      "......WLLW......",
      "......WLLW......",
      "......WLLW......",
      "......WLLW......",
      "......WLLW......",
      "......WLLW......",
      "......WLLW......",
      "....OOWLLWOO....",
      ".....HHHHHH.....",
      ".......HH.......",
      ".......HH.......",
      ".......HH.......",
      "......HHHH......",
      "......HhhH......"
    ],
    trofeu: [
      "..YYYYYYYYYYYY..",
      ".YYYYYYYYYYYYYY.",
      ".YYyYYYYYYYYyYY.",
      ".YYyYYYYYYYYyYY.",
      "..YYyYYYYYYyYY..",
      "..OYYyYYYYyYYO..",
      ".OOYYyYYYYyYYOO.",
      ".OOOYYyYYyYYOOO.",
      "..OOOYYYYYYOOO..",
      "...OOYYYYYYOO...",
      "....OOYYYYOO....",
      ".....OYYYYO.....",
      ".....OYYYYO.....",
      "......YYYY......",
      "....YYYYYYYY....",
      "...YYYYYYYYYY..."
    ]
  };

  var NAMES = { trofeu: "Trofeu", espada: "Espada", grama: "Bloco de grama" };

  function draw(ctx, id, px, ox, oy) {
    var map = MAPS[id];
    if (!map) throw new Error("Icone desconhecido: " + id);
    for (var y = 0; y < 16; y++) {
      var row = map[y];
      for (var x = 0; x < 16; x++) {
        var ch = row[x];
        if (ch === ".") continue;
        var c = PAL[ch];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(ox + x * px, oy + y * px, px, px);
      }
    }
  }

  function preview(canvas, id) {
    var s = 3;
    canvas.width = 16 * s;
    canvas.height = 16 * s;
    var ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, id, s, 0, 0);
  }

  function make(id) {
    return new Promise(function (resolve, reject) {
      try {
        var c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        var ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        draw(ctx, id, 4, 0, 0);
        c.toBlob(function (blob) {
          if (!blob) { reject(new Error("Falha ao gerar PNG.")); return; }
          blob.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject);
        }, "image/png");
      } catch (e) { reject(e); }
    });
  }

  // valida os mapas (usado em teste): 16 linhas de 16 chars, só chars conhecidos
  function selfCheck() {
    var ids = Object.keys(MAPS);
    for (var i = 0; i < ids.length; i++) {
      var map = MAPS[ids[i]];
      if (map.length !== 16) return "linhas: " + ids[i];
      for (var y = 0; y < 16; y++) {
        if (map[y].length !== 16) return "colunas: " + ids[i] + ":" + y;
        for (var x = 0; x < 16; x++) {
          var ch = map[y][x];
          if (ch !== "." && !PAL[ch]) return "char: " + ids[i] + ":" + y + ":" + x;
        }
      }
    }
    return "";
  }

  window.RC_icons = {
    list: Object.keys(MAPS).map(function (id) { return { id: id, name: NAMES[id] }; }),
    make: make,
    preview: preview,
    _selfCheck: selfCheck,
    _maps: MAPS
  };
})();
