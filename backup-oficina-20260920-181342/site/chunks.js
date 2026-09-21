/* ReativaConquistas — Reset de chunks (VIP, 100% local).
   1) seleciona chunks no mapa 2D (clique alterna, arrastar = retângulo);
   2) ANÁLISE GRÁTIS: saúde de cada chunk (versão, finalização, fantasmas,
      formato antigo), tipo de mundo (Infinito/Plano/Antigo), vínculos
      (vilas/portais/ticking) e aviso de lote grande no celular;
   3) RESET: deleta TODAS as chaves dos chunks (todas as tags + digp +
      atores da área) + vilas com centro na seleção, via .log novo.
      O jogo regenera do seed ao visitar a área (ver passos no status).
   level.dat, player, placares e mapas NUNCA são tocados. Sai arquivo novo.
*/
(function () {
  "use strict";

  var MAX_CHUNKS = 4000;
  window.RC_sel = new Set();
  window.RC_MAX_CHUNKS = MAX_CHUNKS;
  var curFile = null, analysis = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.RC_dbx ? window.RC_dbx.esc(s) : String(s); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function trackFile(f) { curFile = f; window.RC_file = f; window.RC_sel.clear(); analysis = null; paintSelUI(); }
  function selCount() { return window.RC_sel.size; }

  function status(html) {
    var el = $("chunkStatus");
    if (!el) return;
    if (!html) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false; el.innerHTML = html;
  }

  function paintSelUI() {
    var c = $("selCount");
    if (c) {
      var n = selCount(), free = 8;
      try { if (window.RC_dbx && window.RC_dbx.limits) free = window.RC_dbx.limits.freeResetChunks; } catch (e) {}
      c.innerHTML = n ? ("<b>" + n + " pintado(s)</b>" + (n > free && !window.RC_dbx.vipOk() ? " · grátis até <b>" + free + "</b>" : "")) : "nada pintado ainda";
    }
    var an = $("analyzeBtn"), rs = $("resetBtn");
    if (an) an.disabled = !selCount();
    if (rs) rs.disabled = !selCount();
    try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e) {}
    // highlight chunks no mapa
    try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e) {}
  }
  // chamado pelo mapa quando a seleção muda (análise automática, sem botão)
  var analyzeTimer = null;
  window.RC_selChanged = function () {
    analysis = null;
    var ar = $("analysisBox"); if (ar) { ar.hidden = true; ar.innerHTML = ""; }
    paintSelUI();
    if (analyzeTimer) clearTimeout(analyzeTimer);
    if (window.RC_sel.size && curFile) {
      analyzeTimer = setTimeout(function () { try { analyze(); } catch (e) {} }, 900);
    }
  };
  window.RC_selMsg = status;

  var TAG_LBL = { 43: "bioma/altura", 44: "versão", 45: "bioma/altura", 46: "bioma antigo", 47: "terreno (subchunk)", 48: "terreno antigo", 49: "blocos especiais (baú, fornalha, placa…)", 50: "criaturas (formato antigo)", 51: "atualizações pendentes", 52: "dados extras antigos", 53: "bioma extra", 54: "estado final", 55: "conversão", 56: "blocos de borda", 57: "spawners de estrutura", 58: "ticks aleatórios", 59: "checksums", 60: "seed de geração", 63: "hash de metadados", 64: "mistura de terreno", 65: "versão do digest", 118: "versão antiga", 119: "volumes" };

  // ---------- saúde do chunk (análise de corrupção) ----------
  function valU8(v) {
    try {
      if (!v || !v.length) return null;
      return v[0];
    } catch (e) { return null; }
  }
  function valI32(v) {
    try {
      if (!v || v.length < 4) return valU8(v);
      var dv = new DataView(v.buffer, v.byteOffset, Math.min(4, v.byteLength));
      return dv.getInt32(0, true);
    } catch (e) { return valU8(v); }
  }
  function asciiPrefix(b, s) {
    if (!b || b.length < s.length) return false;
    for (var i = 0; i < s.length; i++) if (b[i] !== s.charCodeAt(i)) return false;
    return true;
  }
  function keyStr(kv) {
    try { if (kv.key) return kv.key; } catch (e) {}
    try {
      var b = kv.keyBytes;
      if (b) return new TextDecoder().decode(b.subarray(0, Math.min(b.length, 120)));
    } catch (e2) {}
    return "";
  }
  // X/Z (blocos) dentro de um NBT de vila/POI. Procura no root, em 1 nível
  // de compounds e em listas de compounds. Falha = null (mantém a chave).
  function intXZ(node) {
    try {
      var g = window.RC_nbt2.get;
      var nx = g(node, "X"), nz = g(node, "Z");
      if (nx && nz && nx.t === 3 && nz.t === 3 && isFinite(nx.v) && isFinite(nz.v)) return { x: nx.v, z: nz.v };
    } catch (e) {}
    return null;
  }
  function findXZ(root) {
    var d = intXZ(root);
    if (d) return d;
    try {
      if (!root || root.t !== 10 || !root.v || !root.v.map) return null;
      var map = root.v.map, keys = root.v.order || Object.keys(map), i, j;
      for (i = 0; i < keys.length; i++) {
        var ch = map[keys[i]];
        if (!ch) continue;
        if (ch.t === 10) { d = intXZ(ch); if (d) return d; }
        else if (ch.t === 9 && ch.v && ch.v.e === 10 && ch.v.items) {
          for (j = 0; j < Math.min(ch.v.items.length, 50); j++) {
            var it = ch.v.items[j];
            var nd = (it && it.t === 10) ? it : { t: 10, v: (it && it.v) || null };
            d = intXZ(nd);
            if (d) return d;
          }
        }
      }
    } catch (e) {}
    return null;
  }
  function villageXZ(kv) {
    try {
      if (!window.RC_nbt2 || !kv || !kv.value || !kv.value.length) return null;
      return findXZ(window.RC_nbt2.parse(kv.value).root);
    } catch (e) { return null; }
  }
  var VIL_RE = /^village_(.+)_(info|players|poi|dwellers|raid)$/;
  function villageGroup(kv) {
    var m = VIL_RE.exec(keyStr(kv));
    return m ? ("vil:" + m[1]) : ("key:" + keyStr(kv));
  }
  function groupHitsSelection(list, sel) {
    for (var i = 0; i < list.length; i++) {
      var xz = villageXZ(list[i]);
      if (xz && sel.has("0:" + Math.floor(xz.x / 16) + "," + Math.floor(xz.z / 16))) return true;
    }
    return false;
  }
  // Tipo de mundo via level.dat (Generator: 0=Antigo 1=Infinito 2=Plano).
  function readWorldType(zip) {
    try {
      if (!zip || !window.RC_nbt) return Promise.resolve(null);
      var rel = null;
      zip.forEach(function (r, e) {
        if (!rel && e && !e.dir && /(^|\/)level\.dat$/i.test(r)) rel = r;
      });
      if (!rel) return Promise.resolve(null);
      return zip.file(rel).async("uint8array").then(function (u8) {
        var NBT = window.RC_nbt;
        function fin(b) {
          try {
            var sp = NBT.splitLevelDat(b), hits = {};
            NBT.walkCollect(sp.body, hits);
            var g = (hits.Generator || []).filter(function (h) { return h.tag === 3; });
            if (!g.length) return null;
            var v = g[0].val;
            return { gen: v, label: v === 2 ? "Plano" : v === 0 ? "Antigo (256×256)" : v === 1 ? "Infinito" : "tipo " + v };
          } catch (e) { return null; }
        }
        if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) return NBT.gunzipAsync(u8).then(fin);
        return fin(u8);
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function analyze() {
    if (!curFile) { status("Escolha o <b>.mcworld</b> primeiro (passo 1)."); return; }
    if (!selCount()) return;
    if (!window.RC_dbx || !window.RC_nbt2 || !window.RC_ldbw) { status("Módulos ainda carregando. Aguarde 5s e tente de novo."); return; }
    status('<span class="spin"></span> Analisando a seleção <b>sem alterar nada</b>…');
    var box = $("analysisBox");
    if (box) { box.hidden = true; box.innerHTML = ""; }
    window.RC_dbx.openWorld(curFile).then(function (data) {
      var sel = window.RC_sel;
      var per = {}, actorsRef = {}, digpKeys = [];
      var villageKeys = [], portalCount = 0, tickCount = 0;
      var i = 0, entries = Array.from(data.db.keys.entries());
      var n = entries.length;
      function step() {
        var end = Math.min(n, i + 6000);
        for (; i < end; i++) {
          var kv = entries[i][1];
          if (!kv || kv === false) continue;
          var b = null;
          try { b = kv.keyBytes; } catch (e) { continue; }
          if (!b) continue;
          var c = window.RC_dbx.parseChunkKey(b);
          if (c) {
            var k = c.dim + ":" + c.cx + "," + c.cz;
            if (sel.has(k)) {
              var st = per[k] || (per[k] = { n: 0, subs: {}, be: 0, tags: {} });
              st.n++;
              st.tags[c.tag] = (st.tags[c.tag] || 0) + 1;
              var vv = null;
              try { vv = kv.value; } catch (e0) {}
              if (c.tag === 44 && st.v44 === undefined) st.v44 = valU8(vv);
              else if (c.tag === 118 && st.v118 === undefined) st.v118 = valU8(vv);
              else if (c.tag === 54 && st.fin === undefined) st.fin = valI32(vv);
              else if (c.tag === 43) st.has43 = 1;
              else if (c.tag === 45) st.has45 = 1;
              else if (c.tag === 51) st.pend = 1;
              else if (c.tag === 46 || c.tag === 48 || c.tag === 50 || c.tag === 52) st.legacy = 1;
              if (c.tag === 47 && c.sub >= 0) {
                st.subs[c.sub] = 1;
                if (st.subMin === undefined || c.sub < st.subMin) st.subMin = c.sub;
                if (st.subMax === undefined || c.sub > st.subMax) st.subMax = c.sub;
              }
              if (c.tag === 49) st.be++;
            }
            continue;
          }
          var d = window.RC_dbx.parseDigp(b);
          if (d) {
            var k2 = d.dim + ":" + d.cx + "," + d.cz;
            if (sel.has(k2)) {
              digpKeys.push({ key: b.slice(), dim: d.dim, cx: d.cx, cz: d.cz, val: kv.value ? kv.value.slice() : new Uint8Array(0) });
              var v = kv.value || new Uint8Array(0);
              for (var o = 0; o + 8 <= v.length; o += 8) {
                actorsRef[Array.from(v.subarray(o, o + 8)).join(",")] = 1;
              }
            }
            continue;
          }
          // vínculos globais (não são chunk, mas prendem a área)
          if (asciiPrefix(b, "village_")) { villageKeys.push(kv); continue; }
          if (b.length === 7 && asciiPrefix(b, "portals")) { portalCount++; continue; }
          if (asciiPrefix(b, "tickingarea_")) { tickCount++; continue; }
        }
        if (i < n) {
          if (i % 30000 === 0) status('<span class="spin"></span> Analisando… <b>' + i + " / " + n + "</b> chaves");
          return tick().then(step);
        }
        return Promise.resolve();
      }
      return step().then(function () {
        // varredura de atores por posição (só Overworld: atores não guardam dimensão)
        var dim0 = false;
        sel.forEach(function (k) { if (k.indexOf("0:") === 0) dim0 = true; });
        var sweep = { inSel: 0, skipped: 0, ids: {} };
        var jobs = [];
        if (dim0) {
          for (var j = 0; j < entries.length; j++) {
            (function (kv) {
              if (!kv || kv === false) return;
              var b = null;
              try { b = kv.keyBytes; } catch (e) { return; }
              if (!b || b.length < 12 || b[0] !== 97) return; // 'a' de actorprefix
              var s = "";
              try { s = new TextDecoder().decode(b.subarray(0, 11)); } catch (e) { return; }
              if (s !== "actorprefix") return;
              jobs.push(kv);
            })(entries[j][1]);
          }
        }
        var ji = 0;
        function sweepStep() {
          var end = Math.min(jobs.length, ji + 200);
          for (; ji < end; ji++) {
            var kv2 = jobs[ji];
            var val = kv2.value;
            if (!val || !val.length) { sweep.skipped++; continue; }
            try {
              var pr = window.RC_nbt2.parse(val);
              var pos = window.RC_nbt2.get(pr.root, "Pos");
              if (!pos || pos.t !== 9 || !pos.v.items || pos.v.items.length < 3) { sweep.skipped++; continue; }
              var px = +pos.v.items[0].v, pz = +pos.v.items[2].v;
              var ccx = Math.floor(px / 16), ccz = Math.floor(pz / 16);
              if (sel.has("0:" + ccx + "," + ccz)) {
                sweep.inSel++;
                var kb = kv2.keyBytes;
                sweep.ids[Array.from(kb.subarray(kb.length - 8)).join(",")] = 1;
              }
            } catch (e) { sweep.skipped++; }
          }
          if (ji < jobs.length) return tick().then(sweepStep);
          return Promise.resolve();
        }
        return sweepStep().then(function () {
          return { per: per, digpKeys: digpKeys, actorsRef: actorsRef, sweep: sweep, villageKeys: villageKeys, portalCount: portalCount, tickCount: tickCount, _zip: data.zip };
        });
      });
    }).then(function (res) {
      if (!res) return;
      analysis = res;
      return readWorldType(res._zip).then(function (wt) {
        printReport(res, wt || null);
      });
    }).catch(function (err) {
      status("Não deu para analisar: " + esc(String((err && err.message) || err).slice(0, 220)));
    });
  }

  // ---------- veredito de saúde por chunk ----------
  // Heurísticas de corrupção ( обновление de versão costuma deixar):
  // fantasma (metadados sem terreno), não finalizado, formato antigo,
  // sem altura/bioma, versão abaixo do padrão do mundo, sub fora da faixa.
  function healthOf(st, modeV) {
    var why = [];
    var nSubs = Object.keys(st.subs).length;
    if (st.n > 0 && !nSubs) why.push("sem terreno (fantasma)");
    if (st.fin !== undefined && st.fin !== null && st.fin !== 2) why.push("não finalizado");
    if (st.legacy) why.push("formato antigo");
    if (nSubs && !st.has43 && !st.has45) why.push("sem altura/bioma");
    if (st.v44 !== undefined && st.v44 !== null && modeV !== null && st.v44 < modeV) why.push("versão antiga (v" + st.v44 + ")");
    if ((st.v44 === undefined || st.v44 === null) && !st.legacy && nSubs) why.push("sem versão");
    if ((st.subMin !== undefined && st.subMin < -4) || (st.subMax !== undefined && st.subMax > 19)) why.push("faixa de altura estranha");
    return why;
  }

  function printReport(res, wt) {
    var chunks = Object.keys(res.per);
    var withBE = chunks.filter(function (k) { return res.per[k].be; });
    var beTotal = withBE.reduce(function (a, k) { return a + res.per[k].be; }, 0);
    var keyTotal = chunks.reduce(function (a, k) { return a + res.per[k].n; }, 0);
    var empty = selCount() - chunks.length;
    // versão majoritária do mundo (padrão de comparação)
    var freq = {}, vMin = null, vMax = null;
    chunks.forEach(function (k) {
      var v = res.per[k].v44;
      if (v === undefined || v === null) return;
      freq[v] = (freq[v] || 0) + 1;
      if (vMin === null || v < vMin) vMin = v;
      if (vMax === null || v > vMax) vMax = v;
    });
    var modeV = null, modeN = 0;
    Object.keys(freq).forEach(function (v) { if (freq[v] > modeN) { modeN = freq[v]; modeV = +v; } });
    // veredito
    var ok = [], bad = [];
    chunks.forEach(function (k) {
      var st = res.per[k], why = healthOf(st, modeV);
      if (!Object.keys(st.subs).length && !why.length) return; // sem dados úteis
      if (why.length) bad.push({ k: k, why: why });
      else if (Object.keys(st.subs).length) ok.push(k);
    });
    var stale = chunks.filter(function (k) {
      var v = res.per[k].v44;
      return v !== undefined && v !== null && modeV !== null && v < modeV;
    }).length;
    // vilas na área (serão limpas junto no reset)
    var groups = {};
    (res.villageKeys || []).forEach(function (kv) {
      var g = villageGroup(kv);
      (groups[g] = groups[g] || []).push(kv);
    });
    var gNames = Object.keys(groups), vilIn = 0;
    gNames.forEach(function (g) { if (groupHitsSelection(groups[g], window.RC_sel)) vilIn++; });
    // spawn?
    var spawnHit = null;
    try {
      var sc = window.RC_mapState && window.RC_mapState.spawnChunk;
      if (sc && window.RC_sel.has("0:" + sc.cx + "," + sc.cz)) spawnHit = sc;
    } catch (e) {}
    var dimLbl = {};
    window.RC_sel.forEach(function (k) { var d = k.split(":")[0]; dimLbl[d] = (dimLbl[d] || 0) + 1; });
    var dimsTxt = Object.keys(dimLbl).map(function (d) {
      return (d === "0" ? "Overworld" : d === "1" ? "Nether" : "End") + ": <b>" + dimLbl[d] + "</b>";
    }).join(" · ");
    var xs = [], zs = [];
    window.RC_sel.forEach(function (k) { var p = k.split(":")[1].split(","); xs.push(+p[0]); zs.push(+p[1]); });
    var bx = [Math.min.apply(null, xs) * 16, Math.max.apply(null, xs) * 16 + 15];
    var bz = [Math.min.apply(null, zs) * 16, Math.max.apply(null, zs) * 16 + 15];
    var h = "<b>" + selCount() + " chunk(s)</b> (" + dimsTxt + ") · X " + bx[0] + "…" + bx[1] + ", Z " + bz[0] + "…" + bz[1];
    // saúde
    h += "<br>Saúde: <b>" + ok.length + " ok</b> · <b style='color:#c2410c'>" + bad.length + " suspeito(s)</b>" + (empty > 0 ? (" · " + empty + " vazio(s)") : "");
    if (bad.length) {
      var shown = bad.slice(0, 30).map(function (e) {
        var c = e.k.split(":")[1];
        return c + " (" + e.why.join(", ") + ")";
      }).join(" · ");
      h += "<br><span style='font-size:12px'>Suspeitos: " + esc(shown) + (bad.length > 30 ? " · +" + (bad.length - 30) : "") + "</span>";
    }
    if (modeV !== null) h += "<br>Versão dos chunks: maioria <b>v" + modeV + "</b> (" + vMin + "–" + vMax + ")" + (stale ? (" · <b>" + stale + "</b> desatualizado(s) — update pode ter corrompido") : " · todas iguais ✓");
    else h += "<br>Versão dos chunks: <b>sem marcador</b> (muito antigos — corrompem fácil no update)";
    // tipo de mundo
    if (wt) {
      if (wt.gen === 1) h += "<br>Mundo: <b>Infinito</b> ✓ (regen sai do seed)";
      else if (wt.gen === 2) h += "<br>Mundo: <b>Plano</b> ⚠ — regen gera terreno <b>plano</b>, sem montanhas/cavernas";
      else if (wt.gen === 0) h += "<br>Mundo: <b>Antigo</b> ⚠ — só 256×256; fora disso <b>não regenera</b>";
      else h += "<br>Mundo: <b>" + esc(wt.label) + "</b>";
    }
    h += "<br>Apaga: <b>" + (keyTotal + res.digpKeys.length) + "</b> registros em " + chunks.length + " chunk(s)";
    if (empty > 0) h += " · <b>" + empty + "</b> sem dados (nada a fazer)";
    h += "<br>Blocos especiais: <b>" + beTotal + "</b> em " + withBE.length + " chunk(s)";
    h += " · Criaturas: <b>" + Object.keys(res.actorsRef).length + "</b>" + (res.sweep.inSel ? (" + <b>" + res.sweep.inSel + "</b> por posição") : "");
    var vinc = [];
    if (vilIn) vinc.push("<b>" + vilIn + "</b> vila(s) na área (limpas junto)");
    if (res.portalCount) vinc.push(res.portalCount + " portal(is) no mundo — confira se há na área");
    if (res.tickCount) vinc.push(res.tickCount + " ticking area(s) — ajuste no jogo se for na área");
    if (vinc.length) h += "<br>Vínculos: " + vinc.join(" · ");
    var n = selCount();
    if (n > 128) h += "<br><b>Lote grande (" + n + "):</b> no celular gere em partes de ~128 — área gigante pode ficar descarregada parecendo vazia. Visite aos poucos.";
    if (spawnHit) h += "<br><b style='color:#b91c1c'>Inclui o SPAWN (" + spawnHit.cx + ", " + spawnHit.cz + "). Base pode estar aí!</b>";
    else h += "<br>Spawn: <b>fora</b> ✓ · fora da seleção, <b>nada muda</b>";
    var bx2 = $("analysisBox");
    if (bx2) { bx2.hidden = false; bx2.innerHTML = h; }
    status(null);
    paintSelUI();
  }

  /* ---------- núcleo reutilizável (botão único) ---------- */
  function hexOf(u8) {
    var h = "";
    for (var q = 0; q < u8.length; q++) h += (u8[q] < 16 ? "0" : "") + u8[q].toString(16);
    return h;
  }
  function preflightChunks() {
    if (!curFile) return "Escolha o <b>.mcworld</b> primeiro (passo 1).";
    if (!selCount()) return null; // nada marcado = pula sem erro
    if (!window.RC_dbx || !window.RC_nbt2 || !window.RC_ldbw) return "Módulos ainda carregando. Aguarde e toque de novo.";
    if (!analysis) return "Analisando a seleção, aguarde 2s e toque de novo.";
    var vip = window.RC_dbx.vipOk();
    var freeN = window.RC_dbx.limits.freeResetChunks;
    if (!vip) {
      if (selCount() > freeN) return window.RC_dbx.vipNeed("Grátis: até " + freeN + " chunks por dia (" + selCount() + " selecionados). O VIP é ilimitado.").html;
      if (window.RC_dbx.freeResetLeft() <= 0) return window.RC_dbx.vipNeed("Você já usou seu reset grátis de hoje. O VIP reseta sem limite, todo dia.").html;
    }
    var ack = $("resetAck");
    if (ack && !ack.checked) return "Marque <b>“Backup feito”</b> no reset.";
    if (selCount() > MAX_CHUNKS) return "Acima do limite (" + MAX_CHUNKS + "). Divida em partes.";
    return null;
  }
  // coleta ops de delete p/ a seleção (chunks + digp + atores + vilas)
  function collectChunkOps(data, sel) {
    var ops = [], targetHex = {}, vilKeys = [], vilDel = 0;
    function delAll(kv) {
      var vs = window.RC_dbx.keyVariants(kv);
      for (var q = 0; q < vs.length; q++) {
        ops.push({ t: "del", k: vs[q] });
        targetHex[hexOf(vs[q])] = 1;
      }
    }
    var entries = Array.from(data.db.keys.entries());
    var i = 0, n = entries.length;
    function step() {
      var end = Math.min(n, i + 8000);
      for (; i < end; i++) {
        var kv = entries[i][1];
        if (!kv || kv === false) continue;
        var b = null;
        try { b = kv.keyBytes; } catch (e) { continue; }
        if (!b) continue;
        var c = window.RC_dbx.parseChunkKey(b);
        if (c && sel.has(c.dim + ":" + c.cx + "," + c.cz)) { delAll(kv); continue; }
        var dg = window.RC_dbx.parseDigp(b);
        if (dg && sel.has(dg.dim + ":" + dg.cx + "," + dg.cz)) { delAll(kv); continue; }
        if (asciiPrefix(b, "village_")) { vilKeys.push(kv); continue; }
      }
      if (i < n) return tick().then(step);
      return null;
    }
    return step().then(function () {
      var wantActors = {};
      ((analysis && analysis.digpKeys) || []).forEach(function (dg) {
        var v = dg.val || new Uint8Array(0);
        for (var o = 0; o + 8 <= v.length; o += 8) wantActors[Array.from(v.subarray(o, o + 8)).join(",")] = 1;
      });
      Object.keys((analysis && analysis.sweep.ids) || {}).forEach(function (id) { wantActors[id] = 1; });
      var ids = Object.keys(wantActors);
      if (ids.length) {
        for (var j = 0; j < entries.length; j++) {
          var kv = entries[j][1];
          if (!kv || kv === false) continue;
          var b = null;
          try { b = kv.keyBytes; } catch (e) { continue; }
          if (!b || b.length < 19 || b[0] !== 97) continue;
          var tail = Array.from(b.subarray(b.length - 8)).join(",");
          var hit = wantActors[tail] ? tail : null;
          if (!hit) {
            try {
              var ks = kv.key;
              if (ks && ks.length >= 8) {
                var t2 = [];
                for (var q2 = ks.length - 8; q2 < ks.length; q2++) t2.push(ks.charCodeAt(q2) & 255);
                var tail2 = t2.join(",");
                if (wantActors[tail2]) hit = tail2;
              }
            } catch (e2) {}
          }
          if (hit) { delAll(kv); delete wantActors[tail]; try { delete wantActors[t2]; } catch (e3) {} }
        }
      }
      var vilGroups = {};
      vilKeys.forEach(function (kv) {
        var g = villageGroup(kv);
        (vilGroups[g] = vilGroups[g] || []).push(kv);
      });
      Object.keys(vilGroups).forEach(function (g) {
        if (groupHitsSelection(vilGroups[g], sel)) {
          vilGroups[g].forEach(function (kv) { delAll(kv); vilDel++; });
        }
      });
      return { ops: ops, vilDel: vilDel, targetHex: targetHex };
    });
  }
  // aplica o reset em cima de um blob (pós-conversor) — sem baixar.
  // Usa openWorld (retorna {db, zip, manifest...}); openFromBlob retorna
  // só o LevelDb e quebrava com "reading 'keys'".
  function applyToBlobChunks(blob) {
    var sel = new Set(window.RC_sel), data;
    return window.RC_dbx.openWorld(blob).then(function (d) {
      data = d;
      return collectChunkOps(data, sel);
    }).then(function (col) {
      if (!col.ops.length) throw new Error("Nada a apagar (seleção sem dados).");
      var upd = window.RC_ldbw.buildDbUpdate({
        manifestBytes: data.manifestBytes, manifestName: data.manifestName,
        nextFile: data.nextFile, lastSeq: data.lastSeq, logNumber: data.logNumber, ops: col.ops
      });
      return window.RC_dbx.assemble(data, upd.newManifestBytes, upd.logName, upd.logBytes).then(function (b2) {
        return { blob: b2, col: col };
      });
    }).then(function (r) {
      return r.blob.arrayBuffer().then(function (ab) {
        return window.RC_dbx.openFromBlob(new Blob([ab])).then(function (db2) {
          var left = 0;
          for (var kv of db2.keys.values()) {
            if (!kv || kv === false) continue;
            var vs = window.RC_dbx.keyVariants(kv);
            for (var q = 0; q < vs.length; q++) {
              if (r.col.targetHex[hexOf(vs[q])]) { left++; break; }
            }
          }
          if (left) throw new Error("validação falhou (" + left + " chaves restaram).");
          return { blob: r.blob, delCount: r.col.ops.length, vilDel: r.col.vilDel, nChunks: sel.size };
        });
      });
    });
  }
  window.RC_reset = {
    preflight: preflightChunks, applyToBlob: applyToBlobChunks,
    selCount: selCount, useFree: function () { try { window.RC_dbx.useFreeReset(); } catch (e) {} }
  };

  function doReset() {
    if (!curFile) { status("Escolha o <b>.mcworld</b> primeiro (passo 1)."); return; }
    if (!selCount()) return;
    if (!window.RC_dbx || !window.RC_nbt2 || !window.RC_ldbw) { status("Módulos ainda carregando. Aguarde 5s e tente de novo."); return; }
    if (!analysis) { status("Rode <b>Analisar seleção</b> primeiro — é grátis e mostra o que será apagado."); return; }
    var vip = window.RC_dbx.vipOk();
    var freeN = window.RC_dbx.limits.freeResetChunks;
    if (!vip) {
      if (selCount() > freeN) {
        var need = window.RC_dbx.vipNeed("Grátis: até " + freeN + " chunks por dia (" + selCount() + " selecionados). O VIP é ilimitado.");
        status(need.html);
        try { document.getElementById("planos").scrollIntoView({ behavior: "smooth" }); } catch (e) {}
        return;
      }
      if (window.RC_dbx.freeResetLeft() <= 0) {
        var need2 = window.RC_dbx.vipNeed("Você já usou seu reset grátis de hoje. O VIP reseta sem limite, todo dia.");
        status(need2.html);
        try { document.getElementById("planos").scrollIntoView({ behavior: "smooth" }); } catch (e2) {}
        return;
      }
    }
    var ack = $("resetAck");
    if (ack && !ack.checked) { status("Marque <b>“Fiz backup e entendo que é irreversível”</b> para continuar."); return; }
    if (selCount() > MAX_CHUNKS) { status("Acima do limite de segurança (" + MAX_CHUNKS + "). Divida em partes."); return; }
    // confirmação em 2 toques: o 1º mostra o resumo do estrago, o 2º executa
    var btn = $("resetBtn");
    var selKey = Array.from(window.RC_sel).sort().join("|");
    var now = Date.now();
    if (!btn || !btn.dataset.armed || btn.dataset.armed !== selKey || now - (+btn.dataset.armedAt || 0) > 10000) {
      if (btn) {
        btn.dataset.armed = selKey;
        btn.dataset.armedAt = String(now);
        btn.innerHTML = "⚠️ Toque de novo para CONFIRMAR (" + selCount() + " chunks!)";
        setTimeout(function () {
          if (btn.dataset.armed === selKey && Date.now() - (+btn.dataset.armedAt || 0) > 10000) {
            delete btn.dataset.armed;
            btn.innerHTML = "Apagar e regenerar";
          }
        }, 10500);
      }
      var dims = {};
      window.RC_sel.forEach(function (k) { var d = k.split(":")[0]; dims[d] = (dims[d] || 0) + 1; });
      var dtxt = Object.keys(dims).map(function (d) { return (d === "0" ? "Overworld" : d === "1" ? "Nether" : "End") + " " + dims[d]; }).join(" · ");
      status("⚠️ <b>Último aviso:</b> <b>" + selCount() + " chunk(s)</b> (" + dtxt + ") serão <b>apagados e regenerados do seed</b>. Construções aí dentro somem para sempre. " + (analysis ? "Confira a análise acima. " : "Rode <b>Analisar</b> para ver o que há dentro. ") + "Para confirmar, toque <b>de novo</b> em <b>Apagar e regenerar</b>.");
      return;
    }
    delete btn.dataset.armed;
    btn.innerHTML = "Apagar e regenerar";
    status('<span class="spin"></span> Gerando mundo novo <b>no seu navegador</b>… (original intacto)');
    if (btn) btn.disabled = true;
    var data, ops, delCount = 0, sel = new Set(window.RC_sel), targetHex = {};
    var vilKeys = [], vilDel = 0;
    function hexOf(u8) {
      var h = "";
      for (var q = 0; q < u8.length; q++) h += (u8[q] < 16 ? "0" : "") + u8[q].toString(16);
      return h;
    }
    function delAll(kv) {
      var vs = window.RC_dbx.keyVariants(kv);
      for (var q = 0; q < vs.length; q++) {
        ops.push({ t: "del", k: vs[q] });
        targetHex[hexOf(vs[q])] = 1;
      }
    }
    window.RC_dbx.openWorld(curFile).then(function (d) {
      data = d;
      ops = [];
      var entries = Array.from(d.db.keys.entries());
      var i = 0, n = entries.length;
      function step() {
        var end = Math.min(n, i + 8000);
        for (; i < end; i++) {
          var kv = entries[i][1];
          if (!kv || kv === false) continue;
          var b = null;
          try { b = kv.keyBytes; } catch (e) { continue; }
          if (!b) continue;
          var c = window.RC_dbx.parseChunkKey(b);
          if (c && sel.has(c.dim + ":" + c.cx + "," + c.cz)) { delAll(kv); continue; }
          var dg = window.RC_dbx.parseDigp(b);
          if (dg && sel.has(dg.dim + ":" + dg.cx + "," + dg.cz)) { delAll(kv); continue; }
          if (asciiPrefix(b, "village_")) { vilKeys.push(kv); continue; }
        }
        if (i < n) {
          if (i % 40000 === 0) status('<span class="spin"></span> Coletando chaves… <b>' + i + " / " + n + "</b>");
          return tick().then(step);
        }
        return null;
      }
      return step();
    }).then(function () {
      // atores via digest + varredura (ids de 8 bytes no fim da chave)
      var wantActors = {};
      (analysis.digpKeys || []).forEach(function (dg) {
        var v = dg.val || new Uint8Array(0);
        for (var o = 0; o + 8 <= v.length; o += 8) wantActors[Array.from(v.subarray(o, o + 8)).join(",")] = 1;
      });
      Object.keys(analysis.sweep.ids || {}).forEach(function (id) { wantActors[id] = 1; });
      var ids = Object.keys(wantActors);
      if (ids.length) {
        var entries = Array.from(data.db.keys.entries());
        for (var i = 0; i < entries.length; i++) {
          var kv = entries[i][1];
          if (!kv || kv === false) continue;
          var b = null;
          try { b = kv.keyBytes; } catch (e) { continue; }
          if (!b || b.length < 19 || b[0] !== 97) continue;
          var tail = Array.from(b.subarray(b.length - 8)).join(",");
          var hit = wantActors[tail] ? tail : null;
          if (!hit) {
            try {
              var ks = kv.key;
              if (ks && ks.length >= 8) {
                var t2 = [];
                for (var q2 = ks.length - 8; q2 < ks.length; q2++) t2.push(ks.charCodeAt(q2) & 255);
                var tail2 = t2.join(",");
                if (wantActors[tail2]) hit = tail2;
              }
            } catch (e2) {}
          }
          if (hit) { delAll(kv); delete wantActors[tail]; try { delete wantActors[t2]; } catch (e3) {} }
        }
      }
      // atores referenciados fora da seleção NÃO são apagados (regra de segurança)
      // vilas com centro na seleção: limpam junto (senão reancoram no vazio)
      var vilGroups = {};
      vilKeys.forEach(function (kv) {
        var g = villageGroup(kv);
        (vilGroups[g] = vilGroups[g] || []).push(kv);
      });
      Object.keys(vilGroups).forEach(function (g) {
        if (groupHitsSelection(vilGroups[g], sel)) {
          vilGroups[g].forEach(function (kv) { delAll(kv); vilDel++; });
        }
      });
      delCount = ops.length;
      if (!delCount) throw new Error("Nada a apagar (seleção sem dados).");
      var upd = window.RC_ldbw.buildDbUpdate({
        manifestBytes: data.manifestBytes, manifestName: data.manifestName,
        nextFile: data.nextFile, lastSeq: data.lastSeq, logNumber: data.logNumber, ops: ops
      });
      return window.RC_dbx.assemble(data, upd.newManifestBytes, upd.logName, upd.logBytes).then(function (blob) {
        return { blob: blob, upd: upd };
      });
    }).then(function (r) {
      status('<span class="spin"></span> Validando o arquivo novo (releitura de segurança)…');
      return r.blob.arrayBuffer().then(function (ab) {
        return window.RC_dbx.openFromBlob(new Blob([ab])).then(function (db2) {
            // 1) nenhuma chave da seleção pode restar (qualquer codificação)
            var left = 0;
            for (var kv of db2.keys.values()) {
              if (!kv || kv === false) continue;
              var vs = window.RC_dbx.keyVariants(kv);
              for (var q = 0; q < vs.length; q++) {
                if (targetHex[hexOf(vs[q])]) { left++; break; }
              }
            }
            if (left) throw new Error("validação falhou (" + left + " chaves restaram). Nada foi baixado.");
            // 2) player e level.dat intactos
            var hasPlayer = false;
            for (var k of db2.keys.keys()) { if (k === "~local_player" || k.indexOf("player_") === 0) { hasPlayer = true; break; } }
            var live1 = 0, live2 = 0;
            data.db.keys.forEach(function (v) { if (v) live1++; });
            db2.keys.forEach(function (v) { if (v) live2++; });
            if (live2 >= live1) throw new Error("validação falhou (contagem). Nada foi baixado.");
            return { left: left, hasPlayer: hasPlayer, live1: live1, live2: live2 };
        }).then(function (chk) {
          var base = String(curFile.name || "mundo.mcworld").replace(/\.(mcworld|zip)$/i, "");
          window.RC_dbx.downloadBlob(r.blob, base + "-reset-chunks.mcworld");
          window.RC_dbx.dropCache();
          try { window.RC_modified = new Set(sel); } catch (e) {}
          window.RC_sel.clear(); analysis = null;
          var ar = $("analysisBox"); if (ar) { ar.hidden = true; ar.innerHTML = ""; }
          var ack2 = $("resetAck"); if (ack2) ack2.checked = false;
          var wasVip = window.RC_dbx.vipOk();
          if (!wasVip) window.RC_dbx.useFreeReset();
          var tail = wasVip ? "" : "<br>Reset grátis usado hoje. " + (window.RC_dbx.freeResetLeft() > 0 ? "" : "Amanhã libera outro — ou <a href='#planos'><b>VIP é ilimitado</b></a>.");
          status("Pronto! Download iniciado: <b>" + esc(base) + "-reset-chunks.mcworld</b> — <b>" + delCount + "</b> registros apagados em <b>" + sel.size + "</b> chunk(s)" + (vilDel ? (" + <b>" + vilDel + "</b> de vila") : "") + ". " +
            "Chaves: " + chk.live1 + " → " + chk.live2 + " · player " + (chk.hasPlayer ? "intacto ✓" : "ausente (como no original)") + ". " +
            "<br><b>Para regenerar sem vazio:</b> 1) importe o arquivo novo; 2) abra o <b>mundo novo</b> (mesmo nome — confira); 3) vá até a área e <b>aguarde gerar</b>; 4) se ficar descarregado, <b>feche e reabra</b> o mundo. No celular, regenere em <b>lotes pequenos</b>. Mapas antigos mostram a área velha — explore para atualizar. " +
            "<b>Guarde o original.</b>" + tail);
          paintSelUI();
        });
      });
    }).catch(function (err) {
      status("Não deu certo: " + esc(String((err && err.message) || err).slice(0, 260)) + " <b>Nada foi baixado; seu original está intacto.</b>");
    }).then(function () {
      var b2 = $("resetBtn");
      if (b2) b2.disabled = !selCount();
    });
  }

  function bind() {
    var input = $("file"), drop = $("drop");
    if (input) input.addEventListener("change", function () {
      var f = (input.files && input.files[0]) || null;
      if (f && !/\.dat$/i.test(f.name || "")) trackFile(f);
      else { curFile = null; window.RC_sel.clear(); analysis = null; paintSelUI(); var ar = $("analysisBox"); if (ar) { ar.hidden = true; } }
    });
    if (drop) drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && !/\.dat$/i.test(f.name || "")) setTimeout(function () { trackFile(f); }, 50);
    });
    var sm = $("selModeBtn");
    if (sm) sm.addEventListener("click", function () {
      if (!curFile) { status("Escolha o <b>.mcworld</b> primeiro (passo 1) para ver o mapa."); return; }
      if (!window.RC_mapState || !window.RC_mapState.chunksByDim) { status("Aguarde o <b>mapa 2D</b> carregar primeiro."); return; }
      try { if (window.RC_mapSetMode) window.RC_mapSetMode("select"); } catch (e) {}
      try {
        var mp = $("mapPreview");
        if (mp) mp.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e2) {}
      status("Pincel ativado: <b>toque ou arraste</b> no mapa. A análise roda sozinha.");
    });
    var cl = $("selClearBtn");
    if (cl) cl.addEventListener("click", function () {
      window.RC_sel.clear(); analysis = null;
      var ar = $("analysisBox"); if (ar) { ar.hidden = true; ar.innerHTML = ""; }
      status(null); paintSelUI();
    });
    var an = $("analyzeBtn");
    if (an) an.addEventListener("click", analyze);
    var rs = $("resetBtn");
    if (rs) rs.addEventListener("click", doReset);
    // NEW: map analyze button
    var mapAn = $("mapAnalyzeBtn");
    if (mapAn) mapAn.addEventListener("click", function () {
      if (!curFile) { status("Escolha o <b>.mcworld</b> primeiro (passo 1) para ver o mapa."); return; }
      if (!window.RC_mapState || !window.RC_mapState.chunksByDim) { status("Aguarde o <b>mapa 2D</b> carregar primeiro."); return; }
      analyze();
    });
    // NEW: map reset chunks button
    var mapRs = $("mapResetSelBtn");
    if (mapRs) mapRs.addEventListener("click", function () {
      if (!curFile) { status("Escolha o <b>.mcworld</b> primeiro (passo 1)."); return; }
      if (!selCount()) { status("Nenhum chunk selecionado."); return; }
      // auto-select all visible chunks in the current view
      var dim = window.RC_mapState.activeDim;
      if (!dim) { status("Selecione uma dimensão no mapa primeiro."); return; }
      var bd = window.RC_mapState.boundsByDim && window.RC_mapState.boundsByDim[dim];
      if (!bd) { status("Não é possível determinar os bounds."); return; }
      var cv = $("mapCanvas");
      var W = cv ? cv.clientWidth : 520;
      var H = W > 700 ? 480 : 420;
      var view = window.RC_mapState.view;
      if (!view) return;
      var z = view.zoom;
      var x0 = Math.max(bd.minCx, Math.floor(-W / 2 / z / 16));
      var x1 = Math.min(bd.maxCx, Math.ceil(W / 2 / z / 16));
      var z0 = Math.max(bd.minCz, Math.floor(-H / 2 / z / 16));
      var z1 = Math.min(bd.maxCz, Math.ceil(H / 2 / z / 16));
      var added = 0;
      for (var gx = x0; gx <= x1; gx++) {
        for (var gz = z0; gz <= z1; gz++) {
          var k = dim + ":" + gx + "," + gz;
          if (!window.RC_sel.has(k)) {
            window.RC_sel.add(k);
            added++;
          }
        }
      }
      if (added > 0) {
        status("<b>" + added + "</b> chunk(s) selecionados no viewport. Clique em <b>Apagar e regenerar</b> para resetar.");
        paintSelUI();
      } else {
        status("Chunks já estavam selecionados.");
      }
    });
    function readCoords() {
      var x = $("coordX") ? +$("coordX").value : NaN;
      var z = $("coordZ") ? +$("coordZ").value : NaN;
      if (!isFinite(x) || !isFinite(z)) { status("Digite <b>X e Z</b> (números do F3) para usar as coordenadas."); return null; }
      if (x < -30000000 || x > 30000000 || z < -30000000 || z > 30000000) { status("Coordenada fora do mundo (limite ±30.000.000)."); return null; }
      return { x: Math.trunc(x), z: Math.trunc(z) };
    }
    var cg = $("coordGo");
    if (cg) cg.addEventListener("click", function () {
      var c = readCoords();
      if (!c || !window.RC_mapState || !window.RC_mapState.view) { if (!c); else status("Abra o mapa primeiro (envie o .mcworld no passo 1)."); return; }
      try { if (window.RC_mapSetMode) window.RC_mapSetMode("pan"); } catch (e) {}
      window.RC_mapState.view.cx = c.x;
      window.RC_mapState.view.cy = c.z;
      window.RC_mapState.view.zoom = Math.max(window.RC_mapState.view.zoom, 4);
      try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e2) {}
      try { document.getElementById("mapPreview").scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e3) {}
      status("Mapa centralizado em <b>" + c.x + ", " + c.z + "</b> (chunk " + Math.floor(c.x / 16) + ", " + Math.floor(c.z / 16) + ").");
    });
    var cs = $("coordSel");
    if (cs) cs.addEventListener("click", function () {
      var c = readCoords();
      if (!c) return;
      var dim = (window.RC_mapState && window.RC_mapState.activeDim) || 0;
      var k = dim + ":" + Math.floor(c.x / 16) + "," + Math.floor(c.z / 16);
      if (!window.RC_sel.has(k) && selCount() >= MAX_CHUNKS) { status("Limite de <b>" + MAX_CHUNKS + " chunks</b>. Limpe e faça em partes."); return; }
      if (window.RC_sel.has(k)) window.RC_sel.delete(k);
      else window.RC_sel.add(k);
      try { if (window.RC_selChanged) window.RC_selChanged(); } catch (e) {}
      status("Chunk <b>" + Math.floor(c.x / 16) + ", " + Math.floor(c.z / 16) + "</b> alternado. Rode <b>Analisar</b> para ver o que há dentro.");
    });
    var cp = $("coordSpawn");
    if (cp) cp.addEventListener("click", function () {
      var sc = window.RC_mapState && window.RC_mapState.spawnChunk;
      if (!sc) { status("Spawn desconhecido (envie o .mcworld e aguarde o mapa)."); return; }
      var added = 0;
      for (var dx = -2; dx <= 2; dx++) {
        for (var dz = -2; dz <= 2; dz++) {
          var k = "0:" + (sc.cx + dx) + "," + (sc.cz + dz);
          if (!window.RC_sel.has(k)) {
            if (selCount() >= MAX_CHUNKS) { status("Limite de <b>" + MAX_CHUNKS + " chunks</b> atingido no meio da área."); try { if (window.RC_selChanged) window.RC_selChanged(); } catch (e) {}
              return; }
            window.RC_sel.add(k); added++;
          }
        }
      }
      try { if (window.RC_selChanged) window.RC_selChanged(); } catch (e2) {}
      try {
        window.RC_mapState.view.cx = sc.cx * 16 + 8;
        window.RC_mapState.view.cy = sc.cz * 16 + 8;
        if (window.RC_mapDraw) window.RC_mapDraw();
        document.getElementById("mapPreview").scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (e3) {}
      status("<b>" + added + " chunks</b> marcados ao redor do spawn. <b>Confira se sua base está aí</b> antes de apagar — rode <b>Analisar</b>.");
    });
    // dimensão do mapa mudou → seleção de outra dimensão continua guardada
    document.addEventListener("click", function (e) {
      if (e.target && e.target.classList && e.target.classList.contains("map-dim")) {
        setTimeout(paintSelUI, 100);
      }
    });
    paintSelUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
