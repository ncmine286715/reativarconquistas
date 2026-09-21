/* ReativaConquistas — base compartilhada do editor avançado (100% local).
   - usa o leitor LevelDB vendorizado (vendor/leveldb-reader.js, MIT/Mojang) — sem CDN
   - abre o mundo UMA vez e guarda em cache (chunks.js + player.js usam junto)
   - parse estrito de chave de chunk (qualquer tag; exclui chaves ASCII globais)
   - VIP (mesma chave do app.js), montagem e validação do .mcworld de saída
*/
(function () {
  "use strict";

  var cache = { file: null, data: null, seq: 0 };

  // Leitor LevelDB vendorizado local (sem CDN, funciona offline).
  function loadLib() {
    var m = window.RC_leveldb;
    if (!m || !m.openLevelDb) return Promise.reject(new Error("leitor local não carregou (vendor/leveldb-reader.js). Recarregue a página."));
    return Promise.resolve(m);
  }

  function normRel(rel) { return String(rel || "").replace(/\\/g, "/"); }
  function baseOf(rel) {
    var n = normRel(rel);
    var i = n.lastIndexOf("/");
    return i >= 0 ? n.slice(i + 1) : n;
  }
  function isDbFile(base) {
    return base.indexOf("MANIFEST") === 0 || /\.ldb$/i.test(base) || /\.log$/i.test(base);
  }
  function makeIFile(base, u8) {
    return {
      content: u8, name: base, storageRelativePath: base, fullPath: base,
      isContentLoaded: true,
      unload: function () { this.content = null; this.isContentLoaded = false; }
    };
  }

  // Extrai os arquivos da db/ de um .mcworld (via JSZip local) e abre com o leitor.
  // Tolera barras invertidas de zips criados no Windows.
  // NOTA: monta IFile[] e instancia LevelDb direto (openLevelDb da lib espera
  // objetos File com .arrayBuffer — aqui os bytes já estão em memória).
  function openFromBlob(blob) {
    return loadLib().then(function (lib) {
      if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
      if (!lib.LevelDb) throw new Error("leitor local incompleto. Recarregue a página.");
      return JSZip.loadAsync(blob).then(function (zip) {
        var rels = [];
        zip.forEach(function (rel) { rels.push(rel); });
        var curRel = null, i;
        for (i = 0; i < rels.length; i++) {
          if (baseOf(rels[i]) === "CURRENT") { curRel = rels[i]; break; }
        }
        if (!curRel) throw new Error("Cannot find LevelDB files!");
        var cn = normRel(curRel);
        var dbDir = cn.indexOf("/") >= 0 ? cn.slice(0, cn.lastIndexOf("/") + 1) : "";
        var jobs = [];
        for (i = 0; i < rels.length; i++) {
          (function (rel) {
            var n = normRel(rel);
            if (n.indexOf(dbDir) !== 0) return;
            var b = baseOf(n);
            if (!isDbFile(b)) return;
            jobs.push(zip.file(rel).async("uint8array").then(function (u8) {
              return makeIFile(b, new Uint8Array(u8));
            }));
          })(rels[i]);
        }
        if (!jobs.length) throw new Error("Cannot find LevelDB files!");
        return Promise.all(jobs).then(function (ifiles) {
          var ldb = [], log = [], man = [];
          ifiles.forEach(function (f) {
            if (f.name.indexOf("MANIFEST") === 0) man.push(f);
            else if (/\.ldb$/i.test(f.name)) ldb.push(f);
            else if (/\.log$/i.test(f.name)) log.push(f);
          });
          var db = new lib.LevelDb(ldb, log, man, "site", {});
          return db.init({ unloadFilesAfterParse: true }).then(function () { // The upstream byte getter pads shared prefixes beyond the user-key length.
            // Its binary string is clamped correctly; reconstruct the exact user key.
            db.keys.forEach(function(kv,key) {
              if (!kv) return;
              var exact = Uint8Array.from(key, function(c){ return c.charCodeAt(0); });
              Object.defineProperty(kv, "keyBytes", {value: exact, configurable: true});
            });
            return db; });
        });
      });
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Chave de chunk: 9/10B (overworld) ou 13/14B (com dimensão).
  // Aceita QUALQUER tag (43=Data3D, 44=Version, 47=subchunk, 49=block entity,
  // 63/65/119 de versões novas etc.) — o reset precisa pegar tudo.
  // Rejeita chaves ASCII globais ("Overworld", "BiomeData", "mobevents"...).
  function parseChunkKey(b) {
    if (!b) return null;
    var n = b.length;
    if (n !== 9 && n !== 10 && n !== 13 && n !== 14) return null;
    var i, ascii = 0;
    for (i = 0; i < n; i++) if (b[i] >= 32 && b[i] <= 126) ascii++;
    if (ascii === n) return null; // global ASCII ("Overworld" tem 9B!)
    var dv;
    try { dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
    catch (e) { return null; }
    function i32(o) { return dv.getInt32(o, true); }
    var cx, cz, dim, tag = -1, sub = -1;
    if (n === 9) { cx = i32(0); cz = i32(4); dim = 0; tag = b[8]; }
    else if (n === 10) {
      if (b[8] !== 47) return null;
      cx = i32(0); cz = i32(4); dim = 0; tag = 47; sub = dv.getInt8(9);
    } else if (n === 13) {
      cx = i32(0); cz = i32(4); dim = i32(8); tag = b[12];
      if (dim < 0 || dim > 2) return null;
    } else {
      if (b[12] !== 47) return null;
      cx = i32(0); cz = i32(4); dim = i32(8);
      if (dim < 0 || dim > 2) return null;
      tag = 47; sub = dv.getInt8(13);
    }
    if (!isFinite(cx) || !isFinite(cz)) return null;
    if (cx < -100000 || cx > 100000 || cz < -100000 || cz > 100000) return null;
    return { cx: cx, cz: cz, dim: dim, tag: tag, sub: sub };
  }

  // digp = 'digp' + cx(4) + cz(4) [+ dim(1)] — digest de atores do chunk.
  // Formato antigo tem 12B (sem dimensão, vale p/ Overworld); o novo tem 13B.
  function parseDigp(b) {
    if (!b || (b.length !== 12 && b.length !== 13)) return null;
    if (b[0] !== 100 || b[1] !== 105 || b[2] !== 103 || b[3] !== 112) return null;
    var dv;
    try { dv = new DataView(b.buffer, b.byteOffset, b.byteLength); }
    catch (e) { return null; }
    var cx = dv.getInt32(4, true), cz = dv.getInt32(8, true);
    var dim = b.length === 13 ? b[12] : 0;
    if (dim > 2) return null;
    if (cx < -100000 || cx > 100000 || cz < -100000 || cz > 100000) return null;
    return { cx: cx, cz: cz, dim: dim };
  }

  // Todas as codificações plausíveis de uma chave (proteção contra
  // divergência string×bytes em chaves com prefixo compartilhado):
  // deleta por todas; tombstone de chave inexistente é inofensivo.
  function keyVariants(kv) {
    var out = [], seen = {};
    function add(u8) {
      if (!u8 || !u8.length) return;
      var h = "";
      for (var i = 0; i < u8.length; i++) h += (u8[i] < 16 ? "0" : "") + u8[i].toString(16);
      if (!seen[h]) { seen[h] = 1; out.push(u8); }
    }
    try {
      var kb = kv.keyBytes;
      if (kb) add(kb.slice());
    } catch (e) {}
    try {
      var ks = kv.key;
      if (ks) {
        var u = new Uint8Array(ks.length);
        for (var j = 0; j < ks.length; j++) u[j] = ks.charCodeAt(j) & 255;
        add(u);
      }
    } catch (e2) {}
    return out;
  }

  // Abre o mundo e guarda em cache (chaves + números do MANIFEST + bytes do MANIFEST + zip).
  // A geração só muda quando o ARQUIVO muda — aberturas concorrentes do mesmo
  // arquivo (mapa + player) compartilham a geração e nunca se invalidam.
  function openWorld(file) {
    if (cache.file === file && cache.data) return Promise.resolve(cache.data);
    if (cache.file !== file) { cache.file = file; cache.data = null; ++cache.seq; }
    var my = cache.seq;
    if (typeof JSZip === "undefined") return Promise.reject(new Error("JSZip não carregou. Recarregue a página."));
    return JSZip.loadAsync(file).then(function (zip) {
      if (my !== cache.seq) throw new Error("trocou de arquivo");
      // CURRENT (tolera barras invertidas)
      var curRel = null, rels = [];
      zip.forEach(function (rel) { rels.push(rel); });
      var i;
      for (i = 0; i < rels.length; i++) {
        if (baseOf(rels[i]) === "CURRENT") { curRel = rels[i]; break; }
      }
      if (!curRel) throw new Error("Cannot find LevelDB files!");
      return zip.file(curRel).async("string").then(function (curTxt) {
        var manBase = String(curTxt || "").trim().split("\n")[0];
        if (!manBase) throw new Error("Cannot find LevelDB files!");
        var want = baseOf("db/" + manBase);
        var manRel = null;
        for (var j = 0; j < rels.length; j++) {
          if (baseOf(rels[j]) === want) { manRel = rels[j]; break; }
        }
        if (!manRel) {
          for (var k = 0; k < rels.length; k++) {
            if (/MANIFEST-/.test(baseOf(rels[k]))) { manRel = rels[k]; break; }
          }
        }
        if (!manRel) throw new Error("Cannot find LevelDB files!");
        return Promise.all([zip.file(manRel).async("uint8array"), Promise.all(rels.filter(function(rel){return /\.log$/i.test(rel);}).map(function(rel){return zip.file(rel).async("uint8array");}))]).then(function (parts) {
          var manBytes = parts[0], walMax = 0;
          parts[1].forEach(function(bytes) {
            for (var off = 0; off + 7 <= bytes.length;) {
              var remain = 32768 - off % 32768;
              if (remain < 7) { off += remain; continue; }
              var len = bytes[off+4] | bytes[off+5] << 8, kind = bytes[off+6];
              if (off + 7 + len > bytes.length) break;
              if ((kind === 1 || kind === 2) && len >= 12) {
                var view = new DataView(bytes.buffer, bytes.byteOffset + off + 7, len);
                var start = Number(view.getBigUint64(0,true)), count = view.getUint32(8,true);
                if (count) walMax = Math.max(walMax, start + count - 1);
              }
              off += 7 + len;
            }
          });
          if (my !== cache.seq) throw new Error("trocou de arquivo");
          return openFromBlob(file).then(function (db) {
            if (my !== cache.seq) throw new Error("trocou de arquivo");
            var maxFile = 0;
            rels.forEach(function(rel){ var m = /^(\d+)\.(?:log|ldb)$/.exec(baseOf(rel)); if(m)maxFile = Math.max(maxFile,+m[1]); });
            var data = {
              lib: window.RC_leveldb, db: db, zip: zip,
              manifestName: manRel, manifestBytes: new Uint8Array(manBytes),
              nextFile: Math.max(db.nextFileNumber, maxFile + 1), lastSeq: Math.max(db.lastSequence, walMax), logNumber: db.logNumber || 0,
              file: file
            };
            cache.file = file; cache.data = data;
            return data;
          });
        });
      });
    });
  }
  function dropCache() { cache.seq++; cache.file = null; cache.data = null; }
  function peekCache(file) { return (cache.file === file && cache.data) ? cache.data : null; }

  /* ---------- limites freemium (tudo local, por dia) ---------- */
  var LIMITS = { freeResetChunks: 8, freeResetDaily: 1, freePlayerDaily: 2 };
  function dayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function quotaLeft(key, daily) {
    try {
      var r = JSON.parse(localStorage.getItem(key) || "null");
      if (r && r.day === dayStr()) return Math.max(0, daily - (+r.count || 0));
    } catch (e) {}
    return daily;
  }
  function quotaUse(key) {
    try {
      var r = JSON.parse(localStorage.getItem(key) || "null");
      var c = (r && r.day === dayStr()) ? (+r.count || 0) : 0;
      localStorage.setItem(key, JSON.stringify({ day: dayStr(), count: c + 1 }));
    } catch (e) {}
  }
  function freeResetLeft() { return quotaLeft("rc_free_reset", LIMITS.freeResetDaily); }
  function useFreeReset() { quotaUse("rc_free_reset"); }
  function freePlayerLeft() { return quotaLeft("rc_free_player", LIMITS.freePlayerDaily); }
  function useFreePlayer() { quotaUse("rc_free_player"); }

  /* ---------- VIP (mesma chave do app.js) ---------- */
  function vipOk() {
    try {
      var r = window.RC_entitlementState || {};
      return !!(r.ready && ((+r.until || 0) > Date.now() || (+r.world_credits || 0) > 0));
    } catch (e) { return false; }
  }
  function vipNeed(msg) {
    if (vipOk()) return true;
    var kw = "";
    try { if (window.RC_pay && window.RC_pay.kiwifyUrl) kw = window.RC_pay.kiwifyUrl() || ""; } catch (e) {}
    var html = esc(msg) + " ";
    html += kw ? '<a href="' + kw + '"><b>Liberar agora</b></a> · <a href="#planos">Ver planos</a>'
      : '<a href="#planos"><b>Ver planos VIP</b></a>';
    try {
      // Upgrade links are explicit; do not open a disabled payment provider.
    } catch (e) {}
    return { html: html };
  }

  /* ---------- monta o .mcworld de saída ---------- */
  function assemble(data, newManifestBytes, logName, logBytes) {
    var jobs = [];
    var out = new JSZip();
    data.zip.forEach(function (rel, entry) {
      if (entry.dir) return;
      if (rel === data.manifestName) { out.file(rel, newManifestBytes); return; }
      jobs.push(entry.async("uint8array").then(function (u8) { out.file(rel, u8); }));
    });
    return Promise.all(jobs).then(function () {
      out.file(logName, logBytes);
      return out.generateAsync({ type: "blob", compression: "STORE" });
    });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  window.RC_dbx = {
    loadLib: loadLib, openWorld: openWorld, openFromBlob: openFromBlob, dropCache: dropCache, peekCache: peekCache,
    parseChunkKey: parseChunkKey, parseDigp: parseDigp, keyVariants: keyVariants,
    limits: LIMITS, freeResetLeft: freeResetLeft, useFreeReset: useFreeReset,
    freePlayerLeft: freePlayerLeft, useFreePlayer: useFreePlayer,
    vipOk: vipOk, vipNeed: vipNeed,
    assemble: assemble, downloadBlob: downloadBlob, esc: esc
  };
})();
