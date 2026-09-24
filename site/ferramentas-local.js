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
    // Addons ativos bloqueiam conquistas mesmo com flags limpas — detecta aqui
    // para o diagnóstico avisar (pastas + ativos em world_behavior_packs.json).
    var packFolders = [];
    try {
      zip.forEach(function (rel) {
        var m = /^behavior_packs\/([^\/]+)/i.exec(rel);
        if (m && packFolders.indexOf(m[1]) < 0) packFolders.push(m[1]);
      });
    } catch (e) {}
    var packActive = 0;
    try {
      var wbp = zip.file("world_behavior_packs.json");
      if (wbp) {
        var arr = JSON.parse(await wbp.async("string"));
        if (arr && arr.length) packActive = arr.length;
      }
    } catch (e) {}
    var raw = u8(await zip.file(levelName).async("uint8array"));
    var wasGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    if (wasGzip) raw = await NBT.gunzipAsync(raw);
    return { raw: raw, levelName: levelName, wasGzip: wasGzip, packs: { folders: packFolders, active: packActive } };
  }

  function summarizeHits(hits) {
    var NBT = needNbt();
    var flags = {};
    NBT.FLAGS.concat(NBT.HARDCORE_FLAGS || [], NBT.HARDCORE_RECOVERY_FLAGS || []).forEach(function (name) {
      var list = hits[name] || [];
      var vals = list.map(function (h) { return h.tag === 1 ? h.val : ("tag" + h.tag); });
      flags[name] = vals;
    });
    var locked = {};
    (NBT.LOCK_FLAGS || []).forEach(function (name) {
      var list = hits[name] || [];
      locked[name] = list.map(function (h) { return h.tag === 1 ? h.val : ("tag" + h.tag); });
    });
    var gt = (hits.GameType || []).map(function (h) { return h.tag === 3 ? h.val : ("tag" + h.tag); });
    var df = (hits.Difficulty || []).map(function (h) { return h.tag === 3 ? h.val : ("tag" + h.tag); });
    var seed = (hits.RandomSeed || []).filter(function (h) { return h.tag === 4; }).map(function (h) { return String(h.val); });
    if (!seed.length) seed = (hits.LevelSeed || []).filter(function (h) { return h.tag === 4; }).map(function (h) { return String(h.val); });
    var nm = (hits.LevelName || []).filter(function (h) { return h.tag === 8; }).map(function (h) { return h.val; });
    var hardcore = (hits.IsHardcore || []).filter(function (h) { return h.tag === 1; }).map(function (h) { return h.val !== 0; });
    var spawn = ["SpawnX", "SpawnY", "SpawnZ"].map(function (n) {
      var l = (hits[n] || []).filter(function (h) { return h.tag === 3; });
      return l.length ? l[0].val : null;
    });
    var gamerules = {};
    (NBT.RULES || []).forEach(function (name) {
      var l = (hits[name] || []).filter(function (h) { return h.tag === 1; });
      gamerules[name] = l.length ? l[0].val : null;
    });
    var would = [];
    NBT.FLAGS.concat(NBT.HARDCORE_FLAGS || [], NBT.HARDCORE_RECOVERY_FLAGS || []).forEach(function (name) {
      (hits[name] || []).forEach(function (h) {
        if (h.tag === 1 && h.val !== 0) would.push("byte " + h.path + " (" + name + ") = " + h.val + " -> 0");
      });
    });
    (hits.GameType || []).forEach(function (h) {
      if (h.tag === 3 && h.val !== 0) would.push("int " + h.path + " (GameType) = " + h.val + " -> 0");
    });
    return { flags: flags, locked: locked, hardcore: hardcore.length ? hardcore[0] : null, hardcoreDetected: hardcore.length > 0, gameType: gt, difficulty: df, seed: seed, levelName: nm, spawn: spawn, gamerules: gamerules, wouldChange: would };
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
      behaviorPacks: got.packs || { folders: [], active: 0 },
      header: !!split.meta.header,
      flags: s.flags,
      locked: s.locked,
      hardcore: s.hardcore,
      hardcoreDetected: s.hardcoreDetected,
      gameType: s.gameType,
      difficulty: s.difficulty,
      seed: s.seed,
      worldName: s.levelName,
      spawn: s.spawn,
      gamerules: s.gamerules,
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
        behaviorPacks: { folders: [], active: 0 },
        header: !!split.meta.header,
        flags: s.flags, locked: s.locked, gameType: s.gameType, difficulty: s.difficulty,
        hardcore: s.hardcore, hardcoreDetected: s.hardcoreDetected,
        seed: s.seed, worldName: s.levelName, spawn: s.spawn, gamerules: s.gamerules,
        wouldChange: s.wouldChange, alreadyClean: s.wouldChange.length === 0
      };
    }
    return diagnoseMcworld(arrayBuffer);
  }

  // ---------- level.dat direto (patch_level_dat_file) ----------
  // opts: { rules, worldName } — level.dat avulso não tem .zip p/ foto,
  // mas nome e regras ficam dentro do NBT e aplicam.
  async function patchLevelDat(arrayBuffer, gameMode, difficulty, opts) {
    var NBT = needNbt();
    gameMode = gameMode || "survival";
    opts = opts || {};
    if (gameMode !== "keep" && opts.paidEntitlement !== true) {
      throw new Error("PAID_GAME_MODE|Alterar o modo de jogo exige um plano pago.");
    }
    var raw = u8(arrayBuffer);
    var wasGzip = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
    if (wasGzip) raw = await NBT.gunzipAsync(raw);
    var split = NBT.splitLevelDat(raw);
    split.meta.gzipped = wasGzip || split.meta.gzipped;
    var patched = NBT.patchBody(split.body, gameMode, difficulty, { rules: opts.rules || null, recoverHardcore: !!opts.recoverHardcore });
    var changes = patched.changes.slice();
    if (opts.worldName && NBT.patchLevelName) {
      var renamed = NBT.patchLevelName(patched.buf, opts.worldName);
      patched.buf = renamed.buf;
      renamed.changes.forEach(function (c) { changes.push(c); });
    }
    NBT.validateBody(patched.buf);
    var packed = await NBT.packBody(patched.buf, split.meta);
    var blob = new Blob([packed], { type: "application/octet-stream" });
    return { blob: blob, changes: changes };
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
        res = await patchLevelDat(ab, opts.gameMode || "survival", opts.difficulty, opts);
      } else {
        res = await window.RC_convert(ab, opts);
      }
      results.push({ file: f, outName: isDat ? f.name.replace(/\.dat$/i, "") + "-conquistas.dat" : baseName(f.name), blob: res.blob, changes: res.changes, warnings: res.warnings || [] });
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
