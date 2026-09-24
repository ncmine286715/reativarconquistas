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

  // Verificação estrutural somente-leitura. Confirma presença de arquivos e
  // consistência dos manifests; não tenta validar o conteúdo interno do LevelDB.
  async function inspectWorld(arrayBuffer, filename, diagnosis) {
    var report = { format: "reativaconquistas-integrity-v1", checked_at: new Date().toISOString(), file: String(filename || ""), checks: [], packs: { references: [], missing: [], duplicate_uuids: [] }, limitations: ["A presença de arquivos da pasta db/ não confirma que todos os registros LevelDB estejam íntegros."] };
    function check(id, status, message, details) { report.checks.push({ id: id, status: status, message: message, details: details || null }); }
    if (/\.dat$/i.test(filename || "")) {
      diagnosis = diagnosis || await diagnoseAny(arrayBuffer, filename);
      check("level_dat", diagnosis.ok ? "ok" : "error", diagnosis.ok ? "level.dat foi lido pelo parser NBT." : (diagnosis.error || "level.dat inválido."));
      check("world_archive", "unknown", "Arquivo .dat avulso: não contém a pasta db/ nem manifests de pacotes.");
      report.diagnosis = diagnosis;
      return report;
    }
    if (arrayBuffer && arrayBuffer.byteLength > 100 * 1024 * 1024) {
      check("archive_scan", "unknown", "A verificação estrutural completa foi pulada para evitar duplicar o uso de memória neste arquivo grande.", { size_bytes: arrayBuffer.byteLength, scan_limit_bytes: 100 * 1024 * 1024 });
      report.diagnosis = diagnosis || null;
      report.archive = { scan_skipped: true, reason: "size_limit" };
      return report;
    }
    if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
    var zip = await JSZip.loadAsync(arrayBuffer), files = [], lower = Object.create(null);
    zip.forEach(function (path, entry) {
      if (entry.dir) return;
      files.push(path);
      var key = path.toLowerCase(); lower[key] = (lower[key] || 0) + 1;
    });
    var levelName = null;
    files.some(function (path) { if (/(^|\/)level\.dat$/i.test(path)) { levelName = path; return true; } return false; });
    diagnosis = diagnosis || await diagnoseAny(arrayBuffer, filename);
    check("level_dat", levelName && diagnosis.ok ? "ok" : "error", levelName && diagnosis.ok ? "level.dat foi encontrado e lido pelo parser NBT." : (diagnosis.error || "level.dat ausente ou ilegível."), { path: levelName });
    var worldRoot = levelName ? levelName.slice(0, levelName.length - "level.dat".length) : "";
    var dbFiles = files.filter(function (path) { return path.toLowerCase().indexOf((worldRoot + "db/").toLowerCase()) === 0; });
    check("leveldb_folder", dbFiles.length ? "ok" : "error", dbFiles.length ? "A pasta db/ tem arquivos." : "A pasta db/ está ausente ou vazia.", { file_count: dbFiles.length, internal_leveldb_verified: false });
    var dupes = Object.keys(lower).filter(function (path) { return lower[path] > 1; });
    check("duplicate_paths", dupes.length ? "warning" : "unknown", dupes.length ? "Há caminhos duplicados no índice do arquivo." : "A leitura do ZIP normaliza os caminhos; a ausência de duplicatas não pode ser confirmada por esta verificação.", { paths: dupes.slice(0, 50), detection_limited: !dupes.length });
    var manifestByUuid = Object.create(null), manifestFiles = files.filter(function (path) { return /(^|\/)manifest\.json$/i.test(path) && /(^|\/)(behavior_packs|resource_packs)\//i.test(path); });
    for (var mi = 0; mi < manifestFiles.length; mi++) {
      var mp = manifestFiles[mi];
      try {
        var manifest = JSON.parse(await zip.file(mp).async("string")), uuid = String(manifest && manifest.header && manifest.header.uuid || "").toLowerCase();
        if (!uuid) { check("pack_manifest:" + mp, "warning", "Manifest sem UUID no cabeçalho.", { path: mp }); continue; }
        (manifestByUuid[uuid] || (manifestByUuid[uuid] = [])).push({ path: mp, version: manifest.header.version || null, name: manifest.header.name || "" });
      } catch (e) { check("pack_manifest:" + mp, "error", "Manifest de pacote ilegível.", { path: mp, error: String(e && e.message || e) }); }
    }
    report.packs.manifest_count = manifestFiles.length;
    report.packs.duplicate_uuids = Object.keys(manifestByUuid).filter(function (uuid) { return manifestByUuid[uuid].length > 1; });
    var packKinds = ["world_behavior_packs.json", "world_resource_packs.json"];
    for (var ki = 0; ki < packKinds.length; ki++) {
      var rel = packKinds[ki], packFilePath = (worldRoot + rel).toLowerCase(), actual = files.filter(function (path) { return path.toLowerCase() === packFilePath; })[0];
      if (!actual) continue;
      try {
        var refs = JSON.parse(await zip.file(actual).async("string"));
        if (!Array.isArray(refs)) throw new Error("O conteúdo não é uma lista.");
        refs.forEach(function (ref) {
          var id = String(ref && ref.pack_id || "").toLowerCase(), matches = manifestByUuid[id] || [], item = { type: rel.indexOf("behavior") >= 0 ? "behavior" : "resource", pack_id: id, version: ref && ref.version || null, manifest_count: matches.length };
          if (!matches.length) report.packs.missing.push(item);
          else if (item.version && !matches.some(function (m) { return JSON.stringify(m.version) === JSON.stringify(item.version); })) { item.version_mismatch = true; report.packs.missing.push(item); }
          report.packs.references.push(item);
        });
      } catch (e2) { check("pack_reference:" + rel, "warning", "Lista de pacotes ativos ilegível.", { path: actual, error: String(e2 && e2.message || e2) }); }
    }
    check("pack_references", report.packs.missing.length || report.packs.duplicate_uuids.length ? "warning" : "ok", report.packs.missing.length ? "Há pacotes ativos sem manifest/versão correspondente." : report.packs.duplicate_uuids.length ? "Há UUIDs de pacotes duplicados." : "As referências de pacotes ativos conferem com os manifests encontrados.", { references: report.packs.references, missing: report.packs.missing, duplicate_uuids: report.packs.duplicate_uuids });
    report.archive = { file_count: files.length, level_path: levelName, database_file_count: dbFiles.length };
    report.diagnosis = diagnosis;
    return report;
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
    var patched = NBT.patchBody(split.body, gameMode, difficulty, { rules: opts.rules || null, recoverHardcore: !!opts.recoverHardcore, reactivateAchievements: opts.reactivateAchievements !== false });
    var changes = patched.changes.slice();
    if (opts.worldName && NBT.patchLevelName) {
      var renamed = NBT.patchLevelName(patched.buf, opts.worldName);
      patched.buf = renamed.buf;
      renamed.changes.forEach(function (c) { changes.push(c); });
    }
    NBT.validateBody(patched.buf, opts.reactivateAchievements !== false);
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
    inspectWorld: inspectWorld,
    patchLevelDat: patchLevelDat,
    convertBatch: convertBatch,
    downloadBlob: downloadBlob
  };
})();
