/* ReativaConquistas — ferramentas 100% locais (port das funções úteis do .py)
   Sem Python, sem servidor. Requer converter.js (window.RC_convert + RC_nbt)
   e JSZip (vendor local ou CDN) carregados antes deste arquivo.

   Equivale a:
   - --check (dry-run): diagnoseMcworld()/diagnoseAny() — relata sem alterar nada
   - patch_level_dat_file: patchLevelDat() — level.dat direto -> level.dat corrigido
   - collect_inputs/handle_path (lote): convertBatch() — vários .mcworld de uma vez
*/
(function () {
  "use strict";

  function needNbt() {
    if (typeof window.RC_nbt === "undefined") throw new Error("converter.js não carregou.");
    return window.RC_nbt;
  }

  function u8(buf) {
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  }

  // ---------- --check: diagnóstico somente-leitura ----------
  async function readLevelRawFromZip(arrayBuffer) {
    if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
    var NBT = needNbt();
    var zip = await JSZip.loadAsync(arrayBuffer);
    var levelName = null;
    zip.forEach(function (rel) {
      var low = rel.toLowerCase();
      if ((low === "level.dat" || low.endsWith("/level.dat")) && !levelName) levelName = rel;
    });
    if (!levelName) throw new Error("level.dat não encontrado no .mcworld");
    var raw = u8(await zip.file(levelName).async("uint8array"));
    var wasGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    if (wasGzip) raw = await NBT.gunzipAsync(raw);
    return { raw: raw, levelName: levelName, wasGzip: wasGzip };
  }

  function summarizeHits(hits) {
    var NBT = needNbt();
    var flags = {};
    NBT.FLAGS.forEach(function (name) {
      var list = hits[name] || [];
      var vals = list.map(function (h) { return h.tag === 1 ? h.val : ("tag" + h.tag); });
      flags[name] = vals;
    });
    var gt = (hits.GameType || []).map(function (h) { return h.tag === 3 ? h.val : ("tag" + h.tag); });
    var would = [];
    NBT.FLAGS.forEach(function (name) {
      (hits[name] || []).forEach(function (h) {
        if (h.tag === 1 && h.val !== 0) would.push("byte " + h.path + " (" + name + ") = " + h.val + " -> 0");
      });
    });
    (hits.GameType || []).forEach(function (h) {
      if (h.tag === 3 && h.val !== 0) would.push("int " + h.path + " (GameType) = " + h.val + " -> 0");
    });
    return { flags: flags, gameType: gt, wouldChange: would };
  }

  // Dry-run do --check: NÃO altera nada, só relata o que mudaria.
  async function diagnoseMcworld(arrayBuffer) {
    var NBT = needNbt();
    var got = await readLevelRawFromZip(arrayBuffer);
    var split;
    try {
      split = NBT.splitLevelDat(got.raw);
    } catch (e) {
      return { ok: false, error: e && e.message, levelName: got.levelName };
    }
    var hits = {};
    NBT.walkCollect(split.body, hits);
    var s = summarizeHits(hits);
    return {
      ok: true,
      levelName: got.levelName,
      wasGzip: got.wasGzip,
      header: !!split.meta.header,
      flags: s.flags,
      gameType: s.gameType,
      wouldChange: s.wouldChange,
      alreadyClean: s.wouldChange.length === 0
    };
  }

  // Diagnóstico de qualquer entrada (.mcworld/.zip ou level.dat direto).
  async function diagnoseAny(arrayBuffer, filename) {
    var NBT = needNbt();
    if (/\.dat$/i.test(filename || "")) {
      var raw = u8(arrayBuffer);
      var wasGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
      if (wasGzip) raw = await NBT.gunzipAsync(raw);
      var split;
      try {
        split = NBT.splitLevelDat(raw);
      } catch (e) {
        return { ok: false, error: e && e.message };
      }
      var hits = {};
      NBT.walkCollect(split.body, hits);
      var s = summarizeHits(hits);
      return {
        ok: true, levelName: filename, wasGzip: wasGzip,
        header: !!split.meta.header,
        flags: s.flags, gameType: s.gameType,
        wouldChange: s.wouldChange, alreadyClean: s.wouldChange.length === 0
      };
    }
    return diagnoseMcworld(arrayBuffer);
  }

  // ---------- level.dat direto (patch_level_dat_file) ----------
  async function patchLevelDat(arrayBuffer, gameMode) {
    var NBT = needNbt();
    gameMode = gameMode || "survival";
    var raw = u8(arrayBuffer);
    var wasGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    if (wasGzip) raw = await NBT.gunzipAsync(raw);
    var split = NBT.splitLevelDat(raw);
    split.meta.gzipped = wasGzip || split.meta.gzipped;
    var patched = NBT.patchBody(split.body, gameMode);
    NBT.validateBody(patched.buf);
    var packed = await NBT.packBody(patched.buf, split.meta);
    var blob = new Blob([packed], { type: "application/octet-stream" });
    return { blob: blob, changes: patched.changes };
  }

  // ---------- lote (collect_inputs/handle_path, modo premium) ----------
  function baseName(name) {
    return String(name || "mundo.mcworld").replace(/\.(mcworld|zip|dat)$/i, "") + "-conquistas.mcworld";
  }

  async function convertBatch(files, opts, onProgress) {
    if (typeof window.RC_convert === "undefined") throw new Error("converter.js não carregou.");
    opts = opts || {};
    var results = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (onProgress) onProgress(i, files.length, f.name);
      var ab = await f.arrayBuffer();
      var isDat = /\.dat$/i.test(f.name);
      var res;
      if (isDat) {
        res = await patchLevelDat(ab, opts.gameMode || "survival");
      } else {
        res = await window.RC_convert(ab, opts);
      }
      results.push({ file: f, outName: isDat ? f.name.replace(/\.dat$/i, "") + "-conquistas.dat" : baseName(f.name), blob: res.blob, changes: res.changes });
      // cede o event loop entre arquivos grandes
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    if (onProgress) onProgress(files.length, files.length, "");
    return results;
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  window.RC_local = {
    diagnoseMcworld: diagnoseMcworld,
    diagnoseAny: diagnoseAny,
    patchLevelDat: patchLevelDat,
    convertBatch: convertBatch,
    downloadBlob: downloadBlob
  };
})();
