/* ReativaConquistas — Mapa 2D do mundo (FREE universal, 100% local).
   Lê a pasta db/ (LevelDB Mojang) dentro do .mcworld via mcbe-leveldb-reader
   (MIT, baseado em Mojang/minecraft-creator-tools, funciona no browser) e
   desenha o mapa de chunks ocupados em canvas. Somente LEITURA: nada é
   alterado, nada sai do PC. Serve de base para o futuro reset de chunks (PRO).
   Formato das chaves Bedrock (little-endian):
     9 bytes:  cx(4) cz(4) tag(1)                        -> Overworld
     10 bytes: cx(4) cz(4) 0x2F sub(1)                   -> Overworld subchunk
     13 bytes: cx(4) cz(4) dim(4) tag(1)                 -> Nether/End
     14 bytes: cx(4) cz(4) dim(4) tag(1) sub(1)          -> Nether/End subchunk
   Chaves especiais (~local_player, player_*, etc.) são ASCII e ignoradas.
*/
(function () {
  "use strict";

  var KNOWN_TAGS = {};
  [43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 118].forEach(function (t) { KNOWN_TAGS[t] = 1; });

  var DIM_NAMES = { 0: "Overworld", 1: "Nether", 2: "End" };
  var DIM_COLORS = { 0: "#5EBB2B", 1: "#dc2626", 2: "#d9962B" };

  var state = {
    chunksByDim: null, boundsByDim: null, counts: null,
    activeDim: 0, cell: 6, spawnChunk: null, spawn: null, totalKeys: 0, fileName: "",
    mode: "pan", view: null // view = {cx, cy (blocos), zoom (px por bloco)}
  };
  window.RC_map = state;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function isMostlyPrintable(b) {
    var p = 0, i, c;
    for (i = 0; i < b.length; i++) {
      c = b[i];
      if ((c >= 32 && c <= 126) || c === 0) p++;
    }
    return p / b.length > 0.7;
  }

  function parseChunkKey(b) {
    if (!b) return null;
    var n = b.length;
    if (n !== 9 && n !== 10 && n !== 13 && n !== 14) return null;
    var dv;
    try { dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
    catch (e) { return null; }
    function i32(o) { return dv.getInt32(o, true); }
    var cx, cz, dim, tag, sub;
    if (n === 9) {
      tag = b[8]; // qualquer tag (43=Data3D, 47=subchunk, 63/65/119 de versões novas…)
      cx = i32(0); cz = i32(4); dim = 0; sub = null;
    } else if (n === 10) {
      if (b[8] !== 47) return null; // 0x2F subchunk overworld
      cx = i32(0); cz = i32(4); dim = 0; tag = 47; sub = b[9];
    } else if (n === 13) {
      tag = b[12]; // qualquer tag
      cx = i32(0); cz = i32(4); dim = i32(8);
      if (dim !== 0 && dim !== 1 && dim !== 2) return null;
      sub = null;
    } else {
      if (b[12] !== 47) return null;
      cx = i32(0); cz = i32(4); dim = i32(8);
      if (dim !== 0 && dim !== 1 && dim !== 2) return null;
      tag = 47; sub = b[13];
    }
    if (!isFinite(cx) || !isFinite(cz)) return null;
    if (cx < -100000 || cx > 100000 || cz < -100000 || cz > 100000) return null;
    if (isMostlyPrintable(b)) {
      // colisão rara com chave ASCII de mesmo tamanho (~local_player tem 13)
      var s = "";
      try { s = new TextDecoder("utf-8").decode(b.slice(0, 8)); } catch (e) {}
      if (/^[~a-zA-Z_]/.test(s)) return null;
    }
    return { cx: cx, cz: cz, dim: dim, tag: tag, sub: sub };
  }

  function showBox() { var el = $("mapPreview"); if (el) el.hidden = false; }
  function setStats(html) { var el = $("mapStats"); if (el) el.innerHTML = html; }

  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function loadReader() {
    // Leitor vendorizado local (vendor/leveldb-reader.js) via db-common.js — sem CDN.
    if (!window.RC_dbx) return Promise.reject(new Error("módulos incompletos (db-common.js). Recarregue a página."));
    return Promise.resolve(null);
  }

  /* ---------- câmera: centro em blocos + zoom (px por bloco) ---------- */
  function fitView() {
    var bd = state.boundsByDim && state.boundsByDim[state.activeDim];
    if (!bd) return;
    var cv = $("mapCanvas");
    var W = (cv && cv.clientWidth) || 520, H = (cv && cv.parentElement && cv.parentElement.clientHeight) || (W > 700 ? 480 : 420);
    H = Math.max(240, Math.min(480, H));
    var bw = (bd.maxCx - bd.minCx + 1) * 16, bh = (bd.maxCz - bd.minCz + 1) * 16;
    var z = Math.min(W / bw, H / bh) * 0.98;
    z = Math.max(0.05, Math.min(24, z));
    state.view = { cx: (bd.minCx + bd.maxCx + 1) * 8, cy: (bd.minCz + bd.maxCz + 1) * 8, zoom: z };
  }
  function clampView() {
    var v = state.view;
    if (!v) return;
    var bd = state.boundsByDim && state.boundsByDim[state.activeDim];
    v.zoom = Math.max(0.05, Math.min(32, v.zoom));
    if (bd) {
      var mx = (bd.minCx - 8) * 16, xx = (bd.maxCx + 9) * 16;
      var mz = (bd.minCz - 8) * 16, xz = (bd.maxCz + 9) * 16;
      if (v.cx < mx) v.cx = mx; if (v.cx > xx) v.cx = xx;
      if (v.cy < mz) v.cy = mz; if (v.cy > xz) v.cy = xz;
    }
  }
  // tela (px CSS, relativo ao canvas) -> chunk
  function screenToChunk(sx, sy) {
    var cv = $("mapCanvas");
    if (!cv || !state.view) return null;
    var r = cv.getBoundingClientRect();
    var W = r.width || 1, H = r.height || 1;
    var bx = state.view.cx + (sx - W / 2) / state.view.zoom;
    var bz = state.view.cy + (sy - H / 2) / state.view.zoom;
    return { cx: Math.floor(bx / 16), cz: Math.floor(bz / 16), dim: state.activeDim, bx: Math.floor(bx), bz: Math.floor(bz) };
  }
  state.screenToChunk = screenToChunk;

  function draw() {
    var cv = $("mapCanvas");
    if (!cv || !state.chunksByDim) return;
    var box = $("mapPreview");
    if (box && box.hidden) return;
    var W = cv.clientWidth || 520, H = (cv.parentElement && cv.parentElement.clientHeight) || (W > 700 ? 480 : 420);
    H = Math.max(240, Math.min(480, H));
    if (W < 50) return;
    var set = state.chunksByDim[state.activeDim];
    var bd = state.boundsByDim[state.activeDim];
    if (!bd) return;
    if (!state.view) fitView();
    clampView();
    var v = state.view, z = v.zoom;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = Math.round(W) + "px";
    cv.style.height = Math.round(H) + "px";
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // fundo estilo ChunkBase (escuro = vazio)
    ctx.fillStyle = "#1c2430";
    ctx.fillRect(0, 0, W, H);
    function X(bx) { return (bx - v.cx) * z + W / 2; }
    function Y(bz) { return (bz - v.cy) * z + H / 2; }
    var x0 = v.cx - (W / 2) / z, x1 = v.cx + (W / 2) / z;
    var z0 = v.cy - (H / 2) / z, z1 = v.cy + (H / 2) / z;
    // vista de blocos (mapa-terreno.js)
    var tl = null;
    try { tl = window.RC_terrainLayer; } catch (e) {}
    var hasTerrain = !!(tl && tl.dim === state.activeDim && tl.canvas && tl.canvas.width);
    if (hasTerrain) {
      var ox = bd.minCx * 16, oz = bd.minCz * 16;
      var sx0 = Math.max(0, x0 - ox), sy0 = Math.max(0, z0 - oz);
      var sx1 = Math.min(tl.canvas.width, x1 - ox), sy1 = Math.min(tl.canvas.height, z1 - oz);
      if (sx1 > sx0 && sy1 > sy0) {
        try { ctx.drawImage(tl.canvas, sx0, sy0, sx1 - sx0, sy1 - sy0, X(ox + sx0), Y(oz + sy0), (sx1 - sx0) * z, (sy1 - sy0) * z); } catch (e2) {}
      }
    } else if (set && set.size) {
      // fallback: retângulos de ocupação (só o visível)
      var color = DIM_COLORS[state.activeDim] || "#5EBB2B";
      ctx.fillStyle = color;
      var ax0 = Math.max(bd.minCx, Math.floor(x0 / 16)), ax1 = Math.min(bd.maxCx, Math.floor(x1 / 16));
      var az0 = Math.max(bd.minCz, Math.floor(z0 / 16)), az1 = Math.min(bd.maxCz, Math.floor(z1 / 16));
      for (var gx = ax0; gx <= ax1; gx++) {
        for (var gz = az0; gz <= az1; gz++) {
          if (set.has(gx + "," + gz)) ctx.fillRect(X(gx * 16), Y(gz * 16), 16 * z, 16 * z);
        }
      }
    }
    // grade de chunks (cara de ChunkBase)
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    var lx0 = Math.max(bd.minCx, Math.floor(x0 / 16)), lx1 = Math.min(bd.maxCx, Math.floor(x1 / 16));
    var lz0 = Math.max(bd.minCz, Math.floor(z0 / 16)), lz1 = Math.min(bd.maxCz, Math.floor(z1 / 16));
    for (var vx = lx0; vx <= lx1 + 1; vx++) {
      var px = Math.round(X(vx * 16)) + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, H);
    }
    for (var vz = lz0; vz <= lz1 + 1; vz++) {
      var py = Math.round(Y(vz * 16)) + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(W, py);
    }
    ctx.stroke();
    // retângulo da seleção em andamento (arrasto)
    try {
      var dr = window.RC_dragRect;
      if (dr && state.mode === "select") {
        ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 1.5;
        var rx = Math.min(dr.fx, dr.tx), rz = Math.min(dr.fz, dr.tz);
        var rw = Math.abs(dr.tx - dr.fx) + 1, rh = Math.abs(dr.tz - dr.fz) + 1;
        ctx.fillRect(X(rx * 16), Y(rz * 16), rw * 16 * z, rh * 16 * z);
        ctx.strokeRect(X(rx * 16), Y(rz * 16), rw * 16 * z, rh * 16 * z);
      }
    } catch (e3) {}
    // marca o spawn (posição exata em blocos)
    if (state.spawn && state.activeDim === 0) {
      var spx = X(state.spawn.x), spy = Y(state.spawn.z);
      if (spx > -40 && spy > -40 && spx < W + 40 && spy < H + 40) {
        ctx.strokeStyle = "#ff5252";
        ctx.fillStyle = "#ff5252";
        ctx.lineWidth = 2;
        var rr = Math.max(7, Math.min(16, 3 * z));
        ctx.beginPath(); ctx.arc(spx, spy, rr, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(spx - rr - 5, spy); ctx.lineTo(spx - rr + 3, spy);
        ctx.moveTo(spx + rr - 3, spy); ctx.lineTo(spx + rr + 5, spy);
        ctx.moveTo(spx, spy - rr - 5); ctx.lineTo(spx, spy - rr + 3);
        ctx.moveTo(spx, spy + rr - 3); ctx.lineTo(spx, spy + rr + 5);
        ctx.stroke();
        if (z > 1.2) {
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.fillText("SPAWN", spx + rr + 6, spy + 4);
        }
      }
    }
    // chunks modificados pelo reset (laranja) — conjunto window.RC_modified
    try {
      var mod = window.RC_modified;
      if (mod && mod.size) {
        ctx.fillStyle = "rgba(249, 115, 22, 0.5)";
        ctx.strokeStyle = "#fdba74";
        ctx.lineWidth = Math.max(1, Math.min(2, z / 4));
        mod.forEach(function (k) {
          var q = String(k).split(":");
          if (+q[0] !== state.activeDim) return;
          var r2 = (q[1] || "").split(",");
          var ccx = +r2[0], ccz = +r2[1];
          if (!isFinite(ccx) || !isFinite(ccz)) return;
          var qx = X(ccx * 16), qy = Y(ccz * 16), qs = 16 * z;
          if (qx > W || qy > H || qx + qs < 0 || qy + qs < 0) return;
          ctx.fillRect(qx, qy, qs, qs);
          ctx.strokeRect(qx, qy, qs, qs);
        });
      }
    } catch (e5) {}
    // onde o player está (verde "VOCÊ")
    if (state.playerPos && state.playerPos.dim === state.activeDim) {
      var ppx = X(state.playerPos.x), ppy = Y(state.playerPos.z);
      if (ppx > -20 && ppy > -20 && ppx < W + 20 && ppy < H + 20) {
        ctx.fillStyle = "#22c55e";
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        var pr = Math.max(5, Math.min(12, 2 * z));
        ctx.beginPath(); ctx.arc(ppx, ppy, pr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (z > 1) {
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.fillStyle = "#22c55e";
          ctx.fillText("VOCÊ", ppx + pr + 5, ppy + 4);
        }
      }
    }
    // seleção de chunks (reset VIP): conjunto window.RC_sel de "dim:cx,cz"
    try {
      var sel = window.RC_sel;
      if (sel && sel.size) {
        ctx.fillStyle = "rgba(239, 68, 68, 0.45)";
        ctx.strokeStyle = "#fca5a5";
        ctx.lineWidth = Math.max(1, Math.min(2, z / 4));
        sel.forEach(function (k) {
          var q = String(k).split(":");
          if (+q[0] !== state.activeDim) return;
          var r2 = (q[1] || "").split(",");
          var ccx = +r2[0], ccz = +r2[1];
          if (!isFinite(ccx) || !isFinite(ccz)) return;
          var qx = X(ccx * 16), qy = Y(ccz * 16), qs = 16 * z;
          if (qx > W || qy > H || qx + qs < 0 || qy + qs < 0) return;
          ctx.fillRect(qx, qy, qs, qs);
          ctx.strokeRect(qx, qy, qs, qs);
        });
      }
    } catch (e4) {}
    state._vw = W; state._vh = H;
  }

  function paintDims() {
    var wrap = $("mapDims");
    if (!wrap || !state.counts) return;
    var dims = Object.keys(state.counts).map(Number).sort();
    if (dims.length <= 1) { wrap.hidden = true; wrap.innerHTML = ""; return; }
    wrap.hidden = false;
    wrap.innerHTML = "";
    dims.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "map-dim" + (d === state.activeDim ? " on" : "");
      b.textContent = (DIM_NAMES[d] || ("Dim " + d)) + " (" + state.counts[d] + ")";
      b.addEventListener("click", function () { state.activeDim = d; state.view = null; paintDims(); paintModes(); paintStats(); draw(); });
      wrap.appendChild(b);
    });
  }

  function paintStats() {
    if (!state.counts) return;
    var dims = Object.keys(state.counts).map(Number).sort();
    var total = dims.reduce(function (a, d) { return a + state.counts[d]; }, 0);
    var bd = state.boundsByDim[state.activeDim];
    var w = bd ? (bd.maxCx - bd.minCx + 1) : 0;
    var h = bd ? (bd.maxCz - bd.minCz + 1) : 0;
    var parts = dims.map(function (d) { return (DIM_NAMES[d] || d) + ": <b>" + state.counts[d] + "</b>"; });
    setStats(
      "<b>" + total + " chunks</b> em " + esc(state.fileName) +
      " · " + parts.join(" · ") +
      (bd ? "<br>Visão: <b>" + (DIM_NAMES[state.activeDim] || state.activeDim) + "</b> " + w + "×" + h + " chunks (~" + (w * 16) + "×" + (h * 16) + " blocos)" : "") +
      (state.spawnChunk ? " · spawn no chunk <b>" + state.spawnChunk.cx + ", " + state.spawnChunk.cz + "</b> <span style='color:#b91c1c'>●</span>" : "") +
      "<br><span style='font-size:12px'>Arraste p/ mover e use roda/pinça p/ zoom. O mapa é somente visualização: nenhum chunk é apagado ou alterado.</span>"
    );
  }

  function resetState() {
    state.chunksByDim = null; state.boundsByDim = null; state.counts = null;
    state.activeDim = 0; state.spawnChunk = null; state.spawn = null; state.playerPos = null;
    state.totalKeys = 0; state.fileName = ""; state.view = null;
    try { window.RC_modified = new Set(); window.RC_terrainLayer = null; } catch (e) {}
  }

  var seq = 0;

  function renderMap(file) {
    var my = ++seq;
    var box = $("mapPreview");
    if (!box) return;
    resetState();
    if (!file || /\.dat$/i.test(file.name || "")) {
      box.hidden = false;
      setStats("Mapa 2D indisponível para <b>level.dat avulso</b> (o mapa mora na pasta <code>db/</code> do .mcworld). Converta o <b>.mcworld/.zip</b> para ver o mapa.");
      var cv0 = $("mapCanvas");
      if (cv0) { var c0 = cv0.getContext("2d"); c0.clearRect(0, 0, cv0.width, cv0.height); }
      var dm0 = $("mapDims"); if (dm0) { dm0.hidden = true; dm0.innerHTML = ""; }
      return;
    }
    state.fileName = file.name || "mundo";
    box.hidden = false;
    var dm = $("mapDims"); if (dm) { dm.hidden = true; dm.innerHTML = ""; }
    setStats('<span class="spin"></span> Lendo mapa 2D <b>no seu navegador</b>… (mundos grandes levam alguns segundos)');
    var p = Promise.resolve(null);
    // spawn p/ marcar no mapa (barato: só level.dat, já temos o leitor NBT)
    if (window.RC_local && window.RC_local.diagnoseAny) {
      p = file.arrayBuffer().then(function (ab) { return window.RC_local.diagnoseAny(ab, file.name); }).catch(function () { return null; });
    }
    p.then(function (rep) {
      if (my !== seq) return null;
      if (rep && rep.ok && rep.spawn && rep.spawn[0] !== null && rep.spawn[0] !== undefined) {
        var sx = +rep.spawn[0], sy = +rep.spawn[1], sz = +rep.spawn[2];
        if (isFinite(sx) && isFinite(sz)) {
          state.spawnChunk = { cx: Math.floor(sx / 16), cz: Math.floor(sz / 16) };
          state.spawn = { x: sx, y: isFinite(sy) ? sy : 64, z: sz };
        }
      }
      return loadReader();
    }).then(function () {
      if (my !== seq) return null;
      setStats('<span class="spin"></span> Abrindo banco de dados do mundo (db/)…');
      return window.RC_dbx.openWorld(file);
    }).then(function (data) {
      if (my !== seq || !data) return;
      state.totalKeys = data.db.keys.size;
      // marca onde o player está (ponto verde "VOCÊ")
      state.playerPos = null;
      try {
        if (window.RC_nbt2) {
          var pent = Array.from(data.db.keys.entries());
          for (var pi = 0; pi < pent.length; pi++) {
            if (pent[pi][0] !== "~local_player") continue;
            var pv = pent[pi][1];
            if (!pv || pv === false || !pv.value || !pv.value.length) break;
            var pproot = window.RC_nbt2.parse(pv.value).root;
            var ppos = window.RC_nbt2.get(pproot, "Pos");
            var pdim = window.RC_nbt2.get(pproot, "DimensionId");
            if (ppos && ppos.t === 9 && ppos.v.items && ppos.v.items.length >= 3) {
              state.playerPos = { x: +ppos.v.items[0].v, z: +ppos.v.items[2].v, dim: pdim ? (+pdim.v || 0) : 0 };
            }
            break;
          }
        }
      } catch (e) { state.playerPos = null; }
      var chunksByDim = { 0: new Set(), 1: new Set(), 2: new Set() };
      var boundsByDim = {};
      var entries = Array.from(data.db.keys.entries());
      var i = 0, n = entries.length;
      function step() {
        if (my !== seq) return Promise.resolve();
        var end = Math.min(n, i + 4000);
        for (; i < end; i++) {
          var kv = entries[i][1];
          if (!kv || kv === false) continue;
          var kb = null;
          try { kb = kv.keyBytes; } catch (e) { kb = null; }
          if (!kb) continue;
          var c = parseChunkKey(kb);
          if (c) {
            var k = c.cx + "," + c.cz;
            var s = chunksByDim[c.dim] || (chunksByDim[c.dim] = new Set());
            if (!s.has(k)) {
              s.add(k);
              var b = boundsByDim[c.dim] || (boundsByDim[c.dim] = { minCx: c.cx, maxCx: c.cx, minCz: c.cz, maxCz: c.cz });
              if (c.cx < b.minCx) b.minCx = c.cx;
              if (c.cx > b.maxCx) b.maxCx = c.cx;
              if (c.cz < b.minCz) b.minCz = c.cz;
              if (c.cz > b.maxCz) b.maxCz = c.cz;
            }
          }
          entries[i] = null; // libera ref local (o banco em cache é compartilhado)
        }
        if (i < n) {
          if (i % 20000 === 0) setStats('<span class="spin"></span> Mapeando chunks… <b>' + i + " / " + n + "</b> chaves");
          return tick().then(step);
        }
        return Promise.resolve();
      }
      return step().then(function () {
        if (my !== seq) return;
        var counts = {};
        Object.keys(chunksByDim).forEach(function (d) {
          if (chunksByDim[d].size) counts[d] = chunksByDim[d].size;
          else delete chunksByDim[d];
        });
        if (!Object.keys(counts).length) {
          setStats("Não achei chunks na pasta <code>db/</code> deste arquivo. Ele pode estar <b>corrompido</b> ou não ser um mundo Bedrock válido.");
          return;
        }
        state.chunksByDim = chunksByDim;
        state.boundsByDim = boundsByDim;
        state.counts = counts;
        state.activeDim = counts[0] ? 0 : +Object.keys(counts).sort()[0];
        state.view = null; // fitView() calcula no draw
        if (window.RC_sel) window.RC_sel.clear();
        try { if (window.RC_selChanged) window.RC_selChanged(); } catch (e) {}
        paintDims(); paintModes(); paintStats(); requestAnimationFrame(function () { draw(); });
      });
    }).catch(function (err) {
      if (my !== seq) return;
      var m = String((err && err.message) || err || "");
      if (/Cannot find LevelDB|CURRENT/i.test(m)) {
        setStats("Este arquivo <b>não tem a pasta db/</b> (mundo incompleto?). Mapa indisponível — a conversão de level.dat continua funcionando normalmente.");
      } else if (/leitor local|JSZip|módulos incompletos/i.test(m)) {
        setStats("Leitor local falhou: " + esc(m.slice(0, 160)) + " Recarregue a página — a conversão continua funcionando.");
      } else if (/memory|out of|allocation/i.test(m)) {
        setStats("Mundo <b>grande demais para a memória deste aparelho</b> no mapa 2D. Tente num PC ou feche outras abas e recarregue. A conversão continua funcionando.");
      } else {
        setStats("Não consegui desenhar o mapa 2D: " + esc(m.slice(0, 220)) + ". A conversão do mundo continua funcionando normalmente.");
      }
    });
  }

  function setMode(m) {
    state.mode = (m === "select") ? "select" : "pan";
    window.RC_mapMode = state.mode;
    var bp = $("mapModePan"), bs = $("mapModeSel");
    if (bp) bp.classList.toggle("on", state.mode === "pan");
    if (bs) bs.classList.toggle("on", state.mode === "select");
    var cv = $("mapCanvas");
    if (cv) cv.style.cursor = state.mode === "select" ? "crosshair" : "grab";
    paintHint();
    draw();
  }
  window.RC_mapSetMode = setMode;
  function paintHint() {
    var h = $("mapHint");
    if (!h) return;
    h.textContent = state.mode === "select"
      ? "Toque num chunk p/ alternar · arraste p/ área · arraste com 2 dedos move o mapa"
      : "Arraste p/ mover · roda/pinça = zoom · passe o mouse p/ ver coordenadas";
  }
  function paintModes() {
    var sb = $("mapSpawnBtn");
    if (sb) sb.hidden = !(state.spawn && state.activeDim === 0);
    paintHint();
  }
  function zoomAt(sx, sy, factor) {
    if (!state.view) return;
    var cv = $("mapCanvas");
    var r = cv ? cv.getBoundingClientRect() : { width: 520, height: 420 };
    var W = r.width || 520, H = r.height || 420;
    var old = state.view.zoom;
    var nw = Math.max(0.05, Math.min(32, old * factor));
    var k = nw / old;
    // bloco sob o cursor fica parado
    var bx = state.view.cx + (sx - W / 2) / old;
    var bz = state.view.cy + (sy - H / 2) / old;
    state.view.zoom = nw;
    state.view.cx = bx - (sx - W / 2) / nw;
    state.view.cy = bz - (sy - H / 2) / nw;
    clampView();
    draw();
  }
  function tip(html, x, y) {
    var t = $("mapTip");
    if (!t) return;
    if (!html) { t.hidden = true; return; }
    t.hidden = false;
    t.innerHTML = html;
    var wrap = $("mapWrap");
    var mw = wrap ? wrap.clientWidth : 500;
    t.style.left = Math.min(Math.max(4, x + 12), mw - 150) + "px";
    t.style.top = Math.max(4, y - 10) + "px";
  }

  var ptrs = {}, dragPan = null, dragSel = null, pinch0 = null;

  function bindCanvas() {
    var cv = $("mapCanvas");
    if (!cv || cv._rcBound) return;
    cv._rcBound = true;
    function pos(e) {
      var r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, W: r.width, H: r.height };
    }
    cv.addEventListener("pointerdown", function (e) {
      if (!state.chunksByDim) return;
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: state.view.cx, cy: state.view.cy, zoom: state.view.zoom };
        dragPan = null; dragSel = null;
        window.RC_dragRect = null;
        return;
      }
      if (state.mode === "select") {
        var p = pos(e), c = screenToChunk(p.x, p.y);
        if (c) dragSel = { fx: c.cx, fz: c.cz, tx: c.cx, tz: c.cz, moved: false };
      } else {
        dragPan = { x: e.clientX, y: e.clientY, cx: state.view.cx, cy: state.view.cy };
        cv.style.cursor = "grabbing";
      }
      e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!state.chunksByDim || !state.view) return;
      var p = pos(e);
      // inspetor (tooltip)
      var c = screenToChunk(p.x, p.y);
      if (c && !dragPan && !dragSel && !pinch0) {
        var inWorld = state.chunksByDim[state.activeDim] && state.chunksByDim[state.activeDim].has(c.cx + "," + c.cz);
        tip("<b>Chunk " + c.cx + ", " + c.cz + "</b><br>Bloco " + c.bx + ", " + c.bz + (inWorld ? " · <span style='color:#7dd3fc'>visitado</span>" : " · vazio"));
      }
      if (ptrs[e.pointerId]) {
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(ptrs);
        if (ids.length === 2 && pinch0) {
          var a = ptrs[ids[0]], b = ptrs[ids[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > 10 && pinch0.d > 10) {
            var r = cv.getBoundingClientRect();
            state.view.zoom = Math.max(0.05, Math.min(32, pinch0.zoom * d / pinch0.d));
            clampView();
            draw();
          }
          e.preventDefault();
          return;
        }
      }
      if (dragPan) {
        var dx = (e.clientX - dragPan.x) / state.view.zoom;
        var dy = (e.clientY - dragPan.y) / state.view.zoom;
        state.view.cx = dragPan.cx - dx;
        state.view.cy = dragPan.cy - dy;
        clampView();
        draw();
      } else if (dragSel && c) {
        if (c.cx !== dragSel.tx || c.cz !== dragSel.tz) {
          dragSel.tx = c.cx; dragSel.tz = c.cz; dragSel.moved = true;
          window.RC_dragRect = dragSel;
          draw();
        }
      }
    });
    function endPointer(e) {
      delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinch0 = null;
      if (dragPan) { dragPan = null; cv.style.cursor = state.mode === "select" ? "crosshair" : "grab"; }
      if (dragSel) {
        var d = dragSel; dragSel = null;
        window.RC_dragRect = null;
        applySelection(d);
      }
      tip(null);
    }
    cv.addEventListener("pointerup", endPointer);
    cv.addEventListener("pointercancel", endPointer);
    cv.addEventListener("pointerleave", function () { tip(null); });
    cv.addEventListener("wheel", function (e) {
      if (!state.chunksByDim) return;
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 0.85);
    }, { passive: false });
    cv.addEventListener("dblclick", function (e) {
      if (!state.chunksByDim || state.mode !== "pan") return;
      var r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, 2);
    });
  }

  function applySelection(d) {
    if (!window.RC_sel) return;
    var dim = state.activeDim, sel = window.RC_sel;
    var MAX = 4000;
    try { if (window.RC_MAX_CHUNKS) MAX = window.RC_MAX_CHUNKS; } catch (e) {}
    if (!d.moved) {
      var k = dim + ":" + d.fx + "," + d.fz;
      if (sel.has(k)) sel.delete(k);
      else {
        if (sel.size >= MAX) {
          try { window.RC_selMsg("Limite de <b>" + MAX + " chunks</b> por operação. Limpe e faça em partes."); } catch (e2) {}
          draw(); return;
        }
        sel.add(k);
      }
    } else {
      var x0 = Math.min(d.fx, d.tx), x1 = Math.max(d.fx, d.tx);
      var z0 = Math.min(d.fz, d.tz), z1 = Math.max(d.fz, d.tz);
      var area = (x1 - x0 + 1) * (z1 - z0 + 1);
      if (sel.size + area > MAX) {
        try { window.RC_selMsg("Esse retângulo passa do limite de <b>" + MAX + " chunks</b>. Selecione uma área menor."); } catch (e3) {}
        draw(); return;
      }
      var have = 0, tot = 0, x, z;
      for (x = x0; x <= x1; x++) for (z = z0; z <= z1; z++) { tot++; if (sel.has(dim + ":" + x + "," + z)) have++; }
      var add = have < tot / 2;
      for (x = x0; x <= x1; x++) for (z = z0; z <= z1; z++) {
        var kk = dim + ":" + x + "," + z;
        if (add) sel.add(kk); else sel.delete(kk);
      }
    }
    try { if (window.RC_selChanged) window.RC_selChanged(); } catch (e4) {}
    draw();
  }

  function bind() {
    var input = $("file"), drop = $("drop");
    if (input) input.addEventListener("change", function () {
      var f = (input.files && input.files[0]) || null;
      if (f) renderMap(f);
      else { var b = $("mapPreview"); if (b) b.hidden = true; seq++; }
    });
    if (drop) drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) renderMap(f);
    });
    bindCanvas();
    var bp = $("mapModePan"), bs = $("mapModeSel");
    if (bp) bp.addEventListener("click", function () { setMode("pan"); });
    if (bs) bs.addEventListener("click", function () { setMode("select"); });
    var zi = $("mapZoomIn"), zo = $("mapZoomOut");
    if (zi) zi.addEventListener("click", function () {
      var cv = $("mapCanvas"), r = cv ? cv.getBoundingClientRect() : { width: 260, height: 210 };
      zoomAt(r.width / 2, (r.height || 420) / 2, 1.4);
    });
    if (zo) zo.addEventListener("click", function () {
      var cv = $("mapCanvas"), r = cv ? cv.getBoundingClientRect() : { width: 260, height: 210 };
      zoomAt(r.width / 2, (r.height || 420) / 2, 0.7);
    });
    var sp = $("mapSpawnBtn");
    if (sp) sp.addEventListener("click", function () {
      if (!state.spawn || !state.view) return;
      state.view.cx = state.spawn.x; state.view.cy = state.spawn.z;
      state.view.zoom = Math.max(state.view.zoom, 4);
      clampView(); draw();
    });
    var rt = null;
    window.addEventListener("resize", function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () { if (state.chunksByDim) draw(); }, 200);
    });
    setMode("pan");

  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.RC_mapRender = renderMap;
  window.RC_mapDraw = draw;
  window.RC_mapState = state;
})();
