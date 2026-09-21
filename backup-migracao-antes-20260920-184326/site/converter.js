/* ReativaConquistas — conversor 100% local (sem servidor)
   Porta de reativar_conquistas.py: abre .mcworld (zip), acha level.dat,
   zera cheatsEnabled/commandsEnabled/hasBeenLoadedInCreative (byte->0),
   ajusta GameType (0 survival / 1 creative), valida e devolve novo zip.
   NBT little-endian (Bedrock). Arquivo nunca sai do PC.
*/
(function () {
  "use strict";

  var TAG_END = 0, TAG_BYTE = 1, TAG_SHORT = 2, TAG_INT = 3, TAG_LONG = 4;
  var TAG_FLOAT = 5, TAG_DOUBLE = 6, TAG_BYTE_ARRAY = 7, TAG_STRING = 8;
  var TAG_LIST = 9, TAG_COMPOUND = 10, TAG_INT_ARRAY = 11, TAG_LONG_ARRAY = 12;
  var FLAGS = ["commandsEnabled", "cheatsEnabled", "hasBeenLoadedInCreative"];
  var HARDCORE_FLAGS = ["hardcore", "isHardcore", "hardcoreEnabled", "hasHardcore"];
  // Leitura informativa p/ diagnóstico (o site não altera travas de pack).
  var LOCK_FLAGS = ["hasLockedBehaviorPack", "hasLockedResourcePack"];
  // Gamerules (TAG_Byte na raiz) que o site permite ligar/desligar.
  var RULES = ["keepinventory", "showcoordinates", "dodaylightcycle", "doweathercycle"];

  function Reader(buf) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.buf = buf;
    this.p = 0;
  }
  Reader.prototype.need = function (n) {
    if (this.p + n > this.buf.length) throw new Error("NBT truncado em offset " + this.p);
  };
  Reader.prototype.byte = function () { this.need(1); return this.buf[this.p++]; };
  Reader.prototype.uint16 = function () { this.need(2); var v = this.view.getUint16(this.p, true); this.p += 2; return v; };
  Reader.prototype.int32 = function () { this.need(4); var v = this.view.getInt32(this.p, true); this.p += 4; return v; };
  Reader.prototype.int16 = function () { this.need(2); var v = this.view.getInt16(this.p, true); this.p += 2; return v; };
  Reader.prototype.float32 = function () { this.need(4); var v = this.view.getFloat32(this.p, true); this.p += 4; return v; };
  Reader.prototype.float64 = function () { this.need(8); var v = this.view.getFloat64(this.p, true); this.p += 8; return v; };
  Reader.prototype.long64 = function () { this.need(8); this.p += 8; return 0; }; // valor não importa p/ skip
  Reader.prototype.longVal = function () {
    this.need(8);
    var v = this.view.getBigInt64(this.p, true);
    this.p += 8;
    return v;
  };
  Reader.prototype.bytes = function (n) { this.need(n); var s = this.buf.subarray(this.p, this.p + n); this.p += n; return s; };
  Reader.prototype.string = function () {
    var n = this.uint16();
    var b = this.bytes(n);
    try { return new TextDecoder("utf-8").decode(b); } catch (e) { return ""; }
  };

  function skipCompoundBody(r) {
    for (;;) {
      var t = r.byte();
      if (t === TAG_END) return;
      r.string();
      skipPayload(r, t);
    }
  }
  function skipPayload(r, tag) {
    var n, elem, i;
    if (tag === TAG_BYTE) r.bytes(1);
    else if (tag === TAG_SHORT) r.bytes(2);
    else if (tag === TAG_INT || tag === TAG_FLOAT) r.bytes(4);
    else if (tag === TAG_LONG || tag === TAG_DOUBLE) r.bytes(8);
    else if (tag === TAG_BYTE_ARRAY) r.bytes(r.int32());
    else if (tag === TAG_INT_ARRAY) r.bytes(4 * r.int32());
    else if (tag === TAG_LONG_ARRAY) r.bytes(8 * r.int32());
    else if (tag === TAG_STRING) r.bytes(r.uint16());
    else if (tag === TAG_LIST) {
      elem = r.byte(); n = r.int32();
      for (i = 0; i < n; i++) {
        if (elem === TAG_COMPOUND) skipCompoundBody(r);
        else skipPayload(r, elem);
      }
    } else if (tag === TAG_COMPOUND) skipCompoundBody(r);
    else throw new Error("tag NBT desconhecida: " + tag);
  }

  function walkCollect(body, hits) {
    var r = new Reader(body);
    function recurse(path) {
      for (;;) {
        var t = r.byte();
        if (t === TAG_END) return;
        var name = r.string();
        var off = r.p;
        if (t === TAG_BYTE) {
          var v = r.byte();
          (hits[name] = hits[name] || []).push({ path: path, off: off, val: v, tag: t });
        } else if (t === TAG_INT) {
          var vi = r.int32();
          (hits[name] = hits[name] || []).push({ path: path, off: off, val: vi, tag: t });
        } else if (t === TAG_LONG) {
          var vl = r.longVal();
          (hits[name] = hits[name] || []).push({ path: path, off: off, val: vl.toString(), tag: t });
        } else if (t === TAG_SHORT || t === TAG_FLOAT || t === TAG_DOUBLE ||
                 t === TAG_BYTE_ARRAY || t === TAG_INT_ARRAY || t === TAG_LONG_ARRAY) {
          skipPayload(r, t);
        } else if (t === TAG_STRING) {
          var vs = r.string();
          (hits[name] = hits[name] || []).push({ path: path, off: off, val: vs, tag: t });
        } else if (t === TAG_LIST) {
          var elem = r.byte(), n = r.int32(), i;
          for (i = 0; i < n; i++) {
            if (elem === TAG_COMPOUND) recurse(path + "/" + name + "[" + i + "]");
            else skipPayload(r, elem);
          }
        } else if (t === TAG_COMPOUND) {
          recurse(path + "/" + name);
        } else throw new Error("tag NBT desconhecida: " + t);
      }
    }
    if (r.byte() !== TAG_COMPOUND) throw new Error("raiz do NBT não é TAG_Compound");
    r.string();
    recurse("/");
  }

  // gzip via stream (assíncrono de verdade)
  function gunzipAsync(u8) {
    var ds = new DecompressionStream("gzip");
    var src = new Blob([u8]).stream().pipeThrough(ds);
    var reader = src.getReader();
    var chunks = [];
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) {
          var total = chunks.reduce(function (a, c) { return a + c.length; }, 0);
          var out = new Uint8Array(total), o = 0;
          chunks.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        chunks.push(new Uint8Array(res.value));
        return pump();
      });
    }
    return pump();
  }

  function gzipAsync(u8) {
    var cs = new CompressionStream("gzip");
    var src = new Blob([u8]).stream().pipeThrough(cs);
    var reader = src.getReader();
    var chunks = [];
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) {
          var total = chunks.reduce(function (a, c) { return a + c.length; }, 0);
          var out = new Uint8Array(total), o = 0;
          chunks.forEach(function (c) { out.set(c, o); o += c.length; });
          return out;
        }
        chunks.push(new Uint8Array(res.value));
        return pump();
      });
    }
    return pump();
  }

  function splitLevelDat(raw) {
    // tenta: gzip -> header 8B -> NBT puro (robusto, melhor que o .py)
    var gzipped = false;
    function parseBody(body, meta) {
      return { body: body, meta: meta };
    }
    // raw já é Uint8Array (chamador resolve gzip antes se precisar)
    if (raw.length >= 12) {
      var dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      var ln = dv.getInt32(4, true);
      if (ln > 0 && ln <= raw.length - 8) {
        var maybe = raw.subarray(8, 8 + ln);
        if (maybe.length > 0 && maybe[0] === TAG_COMPOUND) {
          try {
            var hits = {};
            walkCollect(maybe, hits); // se parsear, é header de verdade
            return parseBody(maybe, { version: dv.getInt32(0, true), header: true, gzipped: gzipped });
          } catch (e) { /* cai p/ NBT puro */ }
        }
      }
    }
    if (raw.length > 0 && raw[0] === TAG_COMPOUND) {
      return parseBody(raw, { version: 10, header: false, gzipped: gzipped });
    }
    throw new Error("level.dat inválido (não é NBT Bedrock).");
  }

  var DIFF_NAMES = ["Pacífico", "Fácil", "Normal", "Difícil"];
  function patchBody(body, gameMode, difficulty, extra) {
    extra = extra || {};
    var rules = extra.rules || null;
    var recoverHardcore = !!extra.recoverHardcore;
    var hits = {};
    walkCollect(body, hits);
    var buf = new Uint8Array(body); // cópia
    var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    var changes = [];
    FLAGS.forEach(function (name) {
      (hits[name] || []).forEach(function (h) {
        if (h.tag !== TAG_BYTE || h.val === 0) return;
        buf[h.off] = 0;
        changes.push("byte " + h.path + " (" + name + ") = " + h.val + " -> 0");
      });
    });
    if (recoverHardcore) {
      HARDCORE_FLAGS.forEach(function (name) {
        (hits[name] || []).forEach(function (h) {
          if (h.tag === TAG_BYTE && h.val !== 0) { buf[h.off] = 0; changes.push("byte " + h.path + " (" + name + ") = " + h.val + " -> 0"); }
          else if (h.tag === TAG_INT && h.val !== 0) { dv.setInt32(h.off, 0, true); changes.push("int " + h.path + " (" + name + ") = " + h.val + " -> 0"); }
        });
      });
      (hits.GameType || []).forEach(function (h) {
        if (h.tag === TAG_INT && h.val !== 0) { dv.setInt32(h.off, 0, true); changes.push("int " + h.path + " (GameType) = " + h.val + " -> 0"); }
      });
    }
    if (gameMode !== "keep") {
      var want = gameMode === "creative" ? 1 : (gameMode === "adventure" ? 2 : 0);
      (hits["GameType"] || []).forEach(function (h) {
        if (h.tag !== TAG_INT) return;
        if (h.val !== want) {
          dv.setInt32(h.off, want, true);
          changes.push("int " + h.path + " (GameType) = " + h.val + " -> " + want);
        }
      });
    }
    if (typeof difficulty === "number" && difficulty >= 0 && difficulty <= 3) {
      (hits["Difficulty"] || []).forEach(function (h) {
        if (h.tag !== TAG_INT) return;
        if (h.val !== difficulty) {
          dv.setInt32(h.off, difficulty, true);
          changes.push("int " + h.path + " (Difficulty) = " + h.val + " -> " + difficulty);
        }
      });
    }
    if (rules) {
      RULES.forEach(function (name) {
        var want = rules[name];
        if (want !== 0 && want !== 1) return; // null/undefined = manter
        (hits[name] || []).forEach(function (h) {
          if (h.tag !== TAG_BYTE) return;
          if (h.val !== want) {
            buf[h.off] = want;
            changes.push("byte " + h.path + " (" + name + ") = " + h.val + " -> " + want);
          }
        });
      });
    }
    return { buf: buf, changes: changes };
  }

  // Renomeia o mundo de verdade: altera a TAG_String "LevelName" na raiz
  // do NBT. Como o nome novo pode ter outro tamanho em bytes, o corpo é
  // reconstruído (splice) em vez de patch in-place. levelname.txt sozinho
  // NÃO muda o nome na lista de mundos — por isso o rename "não funcionava".
  function patchLevelName(body, newName) {
    var want = String(newName || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!want) return { buf: body, changes: [], oldName: null };
    if (body.length < 3 || body[0] !== TAG_COMPOUND) throw new Error("level.dat inválido (não é NBT Bedrock).");
    var dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    var p = 1;
    var rootLen = dv.getUint16(p, true); p += 2 + rootLen;
    var strPos = -1, strLen = -1, oldName = null;
    for (;;) {
      if (p >= body.length) throw new Error("LevelName não encontrado no level.dat.");
      var t = body[p]; p += 1;
      if (t === TAG_END) break;
      if (p + 2 > body.length) throw new Error("level.dat inválido (não é NBT Bedrock).");
      var nLen = dv.getUint16(p, true); p += 2;
      var nm = "";
      try { nm = new TextDecoder("utf-8").decode(body.subarray(p, p + nLen)); } catch (e) { nm = ""; }
      p += nLen;
      if (t === TAG_STRING && nm === "LevelName") {
        strPos = p; // offset do u16 de tamanho da string
        strLen = dv.getUint16(p, true);
        try { oldName = new TextDecoder("utf-8").decode(body.subarray(p + 2, p + 2 + strLen)); } catch (e) { oldName = ""; }
        break;
      }
      // pula o payload desta tag (só nível raiz; listas/compounds via skip)
      var r = Object.create(Reader.prototype);
      r.buf = body; r.view = dv; r.p = p;
      skipPayload(r, t);
      p = r.p;
    }
    if (strPos < 0) return { buf: body, changes: [], oldName: null };
    var enc = new TextEncoder().encode(want);
    if (enc.length > 512) enc = enc.subarray(0, 512);
    var out = new Uint8Array(body.length - (2 + strLen) + (2 + enc.length));
    out.set(body.subarray(0, strPos), 0);
    var odv = new DataView(out.buffer);
    odv.setUint16(strPos, enc.length, true);
    out.set(enc, strPos + 2);
    out.set(body.subarray(strPos + 2 + strLen), strPos + 2 + enc.length);
    return { buf: out, changes: ["nome alterado (LevelName): " + oldName + " -> " + want], oldName: oldName };
  }

  function isJpeg(u8) {
    return u8 && u8.length > 3 && u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF;
  }

  function baseNameOf(rel) {
    var i = Math.max(rel.lastIndexOf("/"), rel.lastIndexOf("\\"));
    return (i >= 0 ? rel.slice(i + 1) : rel).toLowerCase();
  }

  function validateBody(body) {
    var r = new Reader(body);
    if (r.byte() !== TAG_COMPOUND) throw new Error("root não é Compound");
    r.string();
    skipPayload(r, TAG_COMPOUND);
    if (r.p !== body.length) throw new Error("bytes sobrando no NBT: " + (body.length - r.p));
    var hits = {};
    walkCollect(body, hits);
    FLAGS.forEach(function (name) {
      (hits[name] || []).forEach(function (h) {
        if (h.tag === TAG_BYTE && h.val !== 0) throw new Error(name + " ainda = " + h.val);
      });
    });
    return true;
  }

  function packBody(buf, meta) {
    var out = buf;
    if (meta.header) {
      var full = new Uint8Array(8 + buf.length);
      var dv = new DataView(full.buffer);
      dv.setInt32(0, meta.version, true);
      dv.setInt32(4, buf.length, true);
      full.set(buf, 8);
      out = full;
    }
    if (meta.gzipped) return gzipAsync(out);
    return Promise.resolve(out);
  }

  function findLevelName(zip) {
    var found = null;
    zip.forEach(function (rel) {
      if (rel.toLowerCase() === "level.dat" || rel.toLowerCase().endsWith("/level.dat")) {
        if (!found) found = rel;
      }
    });
    return found;
  }

  // Addons: pacotes de comportamento PERSONALIZADOS (fora do Marketplace)
  // bloqueiam conquistas no jogo, mesmo com o level.dat 100% limpo.
  // (A Mojang só mantém conquistas com add-ons do Marketplace.)
  // Detecta pastas behavior_packs/ e conta os ativos em world_behavior_packs.json.
  async function scanBehaviorPacks(zip) {
    var folders = [];
    try {
      zip.forEach(function (rel) {
        var m = /^behavior_packs\/([^\/]+)/i.exec(rel);
        if (m && folders.indexOf(m[1]) < 0) folders.push(m[1]);
      });
    } catch (e) {}
    var active = 0;
    try {
      var f = zip.file("world_behavior_packs.json");
      if (f) {
        var arr = JSON.parse(String(await f.async("string") || "").replace(/^\uFEFF/, ""));
        if (arr && arr.length) active = arr.length;
      }
    } catch (e) {}
    return { folders: folders, active: active };
  }

  async function convertMcworld(arrayBuffer, opts) {
    opts = opts || {};
    var gameMode = opts.gameMode || "survival";
    var iconBytes = opts.iconBytes || null; // Uint8Array em JPEG (world_icon.jpeg)
    var worldName = (opts.worldName || "").replace(/\s+/g, " ").trim().slice(0, 60);
    var difficultyOpt = (opts.difficulty >= 0 && opts.difficulty <= 3) ? opts.difficulty : null;
    var rulesOpt = opts.rules || null;

    if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
    var zip = await JSZip.loadAsync(arrayBuffer);
    var levelName = findLevelName(zip);
    if (!levelName) throw new Error("level.dat não encontrado no .mcworld");
    var packInfo = await scanBehaviorPacks(zip);
    var stripPacks = !!opts.stripBehaviorPacks;
    var warnings = [];
    var packCount = packInfo.active || packInfo.folders.length;
    if (stripPacks && (typeof opts.stripPackLimit === "number") && packCount > opts.stripPackLimit) {
      throw new Error("PACK_LIMIT|" + packCount + "|" + opts.stripPackLimit);
    }
    if (!stripPacks && packCount > 0) {
      warnings.push("addons: este mundo tem " + packCount + " pacote(s) de comportamento" +
        (packInfo.folders.length ? " (" + packInfo.folders.slice(0, 4).join(", ") + (packInfo.folders.length > 4 ? ", …" : "") + ")" : "") +
        " — pacotes personalizados BLOQUEIAM conquistas no jogo mesmo com o level.dat limpo. Remova no jogo (Editar mundo > Pacotes de comportamento) ou marque 'Remover addons' aqui e converta de novo.");
    }
    var levelRaw = new Uint8Array(await zip.file(levelName).async("uint8array"));

    // gzip?
    var wasGzip = (levelRaw.length >= 2 && levelRaw[0] === 0x1f && levelRaw[1] === 0x8b);
    var raw = levelRaw;
    if (wasGzip) raw = await gunzipAsync(levelRaw);

    var split = splitLevelDat(raw);
    split.meta.gzipped = wasGzip || split.meta.gzipped;

    var patched = patchBody(split.body, gameMode, difficultyOpt, { rules: rulesOpt, recoverHardcore: !!opts.recoverHardcore });
    var changes = patched.changes.slice();

    // Nome de verdade: dentro do level.dat (LevelName) + levelname.txt espelho.
    var renamed = patchLevelName(patched.buf, worldName);
    patched.buf = renamed.buf;
    renamed.changes.forEach(function (c) { changes.push(c); });
    validateBody(patched.buf);
    var packed = await packBody(patched.buf, split.meta);

    // Ícone do MUNDO Bedrock = world_icon.jpeg em JPEG na raiz.
    // (pack_icon.png é de packs de recursos/comportamento — o jogo ignora
    // na lista de mundos, por isso a "foto" nunca aparecia.)
    if (iconBytes && !isJpeg(iconBytes)) {
      throw new Error("Ícone inválido: o mundo usa world_icon.jpeg (JPEG). Converta a imagem e tente de novo.");
    }

    // Update limpo de addon: pastas antigas com o MESMO pack_id saem antes
    // de copiar (senão o jogo acha 2 pastas do mesmo addon e o novo não entra).
    var dropFolders = [];
    var incomingPacks = opts.addPacks || [];
    if (incomingPacks.length) {
      var incomingIds = {};
      incomingPacks.forEach(function (pk) { incomingIds[String(pk.pack.pack_id)] = 1; });
      var manJobs = [];
      zip.forEach(function (rel, entry) {
        if (entry.dir) return;
        var lowm = rel.toLowerCase();
        if ((lowm.indexOf("behavior_packs/") === 0 || lowm.indexOf("resource_packs/") === 0) && baseNameOf(rel).toLowerCase() === "manifest.json") {
          manJobs.push(entry.async("string").then(function (txt) {
            try {
              var m = JSON.parse(String(txt || "").replace(/^\uFEFF/, ""));
              var id = m.header && (m.header.pack_id || m.header.uuid);
              if (id && incomingIds[String(id)]) return rel.slice(0, rel.length - 13);
            } catch (e) {}
            return null;
          }));
        }
      });
      dropFolders = (await Promise.all(manJobs)).filter(Boolean);
      dropFolders.forEach(function (d) { changes.push("addon antigo atualizado (" + d.replace(/\/$/, "") + ")"); });
    }

    var out = new JSZip();
    var jobs = [];
    zip.forEach(function (rel, entry) {
      if (entry.dir) return;
      var base = baseNameOf(rel);
      var low = rel.toLowerCase();
      // Remoção de addons: tira os pacotes de comportamento e os vínculos
      // do mundo (resource_packs ficam — visuais não bloqueiam conquistas).
      if (stripPacks && (low === "world_behavior_packs.json" || low === "world_behavior_pack_history.json" || low.indexOf("behavior_packs/") === 0)) {
        return;
      }
      // update limpo: pula arquivos das pastas antigas do mesmo addon
      if (dropFolders.length) {
        for (var dfi = 0; dfi < dropFolders.length; dfi++) {
          if (rel.indexOf(dropFolders[dfi]) === 0) return;
        }
      }
      // Troca de foto: remove ícones antigos p/ não duplicar nem pesar o .mcworld.
      if (iconBytes && (base === "world_icon.jpeg" || base === "world_icon.jpg" || base === "world_icon.png" || base === "pack_icon.png")) {
        return;
      }
      if (rel === levelName) {
        out.file(rel, packed);
        return;
      }
      if (worldName && base === "levelname.txt") {
        out.file(rel, worldName);
        return;
      }
      jobs.push(entry.async("uint8array").then(function (data) { out.file(rel, data); }));
    });
    await Promise.all(jobs);
    if (stripPacks && packCount > 0) {
      changes.push("addons removidos (pacotes de comportamento: " + packCount + ") — conquistas desbloqueadas dos packs");
    }
    // Instalar addons: copia os arquivos p/ behavior_packs|resource_packs e
    // registra em world_behavior_packs.json|world_resource_packs.json.
    // addPacks: [{folder, kind:'behavior'|'resource', files:{rel:u8}, pack:{pack_id, version, name}}]
    var addPacks = opts.addPacks || [];
    if (addPacks.length) {
      var regNames = { behavior: "world_behavior_packs.json", resource: "world_resource_packs.json" };
      var regs = { behavior: null, resource: null };
      // carrega registros existentes do MUNDO (se houver)
      var kinds = ["behavior", "resource"];
      for (var ki = 0; ki < kinds.length; ki++) {
        var rn = regNames[kinds[ki]];
        var found = null;
        zip.forEach(function (rel, entry) {
          if (!entry.dir && !found && rel.toLowerCase() === rn) found = rel;
        });
        regs[kinds[ki]] = [];
        if (found) {
          try {
            var txt = await zip.file(found).async("string");
            var arr = JSON.parse(String(txt || "").replace(/^\uFEFF/, ""));
            if (Array.isArray(arr)) regs[kinds[ki]] = arr;
          } catch (e) {}
        }
      }
      for (var pi = 0; pi < addPacks.length; pi++) {
        var pk = addPacks[pi];
        var pre = pk.kind === "resource" ? "resource_packs/" : "behavior_packs/";
        var fns = Object.keys(pk.files);
        for (var fi = 0; fi < fns.length; fi++) {
          out.file(pre + pk.folder + "/" + fns[fi], pk.files[fns[fi]]);
        }
        var reg = regs[pk.kind] || (regs[pk.kind] = []);
        var at = -1, di;
        for (di = 0; di < reg.length; di++) {
          if (reg[di] && reg[di].pack_id === pk.pack.pack_id) { at = di; break; }
        }
        // a versão registrada TEM que ser igual à da pasta (senão o jogo ignora)
        var entry2 = { pack_id: pk.pack.pack_id, version: pk.pack.version };
        if (at >= 0) reg[at] = entry2;
        else reg.push(entry2);
        changes.push("addon instalado (" + (pk.kind === "resource" ? "recursos" : "comportamento") + ": " + pk.pack.name + ")");
      }
      out.file(regNames.behavior, JSON.stringify(regs.behavior || [], null, 1));
      out.file(regNames.resource, JSON.stringify(regs.resource || [], null, 1));
    }
    if (iconBytes) {
      out.file("world_icon.jpeg", iconBytes);
      changes.push("foto do mundo atualizada (world_icon.jpeg)");
    }
    if (worldName) {
      var hasLevelName = false;
      out.forEach(function (rel) { if (baseNameOf(rel) === "levelname.txt") hasLevelName = true; });
      if (!hasLevelName) out.file("levelname.txt", worldName);
      if (!renamed.oldName && !renamed.changes.length) changes.push("nome em levelname.txt (LevelName não estava na raiz)");
    }
    var blob = await out.generateAsync({ type: "blob", compression: "STORE" });
    return { blob: blob, changes: changes, warnings: warnings, packInfo: packInfo };
  }

  window.RC_convert = convertMcworld;
  // Internos p/ ferramentas-local.js (diagnóstico --check, level.dat direto, lote). Mesma implementação, sem duplicar.
  window.RC_nbt = { Reader: Reader, walkCollect: walkCollect, splitLevelDat: splitLevelDat, patchBody: patchBody, patchLevelName: patchLevelName, validateBody: validateBody, packBody: packBody, gunzipAsync: gunzipAsync, gzipAsync: gzipAsync, FLAGS: FLAGS, HARDCORE_FLAGS: HARDCORE_FLAGS, LOCK_FLAGS: LOCK_FLAGS, RULES: RULES, DIFF_NAMES: DIFF_NAMES, isJpeg: isJpeg };
})();
