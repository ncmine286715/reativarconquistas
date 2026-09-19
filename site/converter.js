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
                 t === TAG_BYTE_ARRAY || t === TAG_INT_ARRAY || t === TAG_LONG_ARRAY || t === TAG_STRING) {
          skipPayload(r, t);
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
  function patchBody(body, gameMode, difficulty) {
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
    return { buf: buf, changes: changes };
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

  async function convertMcworld(arrayBuffer, opts) {
    opts = opts || {};
    var gameMode = opts.gameMode || "survival";
    var strip = !!opts.strip;
    var iconBytes = opts.iconBytes || null; // Uint8Array
    var worldName = (opts.worldName || "").trim().slice(0, 60);

    if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
    var zip = await JSZip.loadAsync(arrayBuffer);
    var levelName = findLevelName(zip);
    if (!levelName) throw new Error("level.dat não encontrado no .mcworld");
    var levelRaw = new Uint8Array(await zip.file(levelName).async("uint8array"));

    // gzip?
    var wasGzip = (levelRaw.length >= 2 && levelRaw[0] === 0x1f && levelRaw[1] === 0x8b);
    var raw = levelRaw;
    if (wasGzip) raw = await gunzipAsync(levelRaw);

    var split = splitLevelDat(raw);
    split.meta.gzipped = wasGzip || split.meta.gzipped;

    var patched = patchBody(split.body, gameMode, (opts.difficulty >= 0 && opts.difficulty <= 3) ? opts.difficulty : null);
    validateBody(patched.buf);
    var packed = await packBody(patched.buf, split.meta);
    var changes = patched.changes.slice();

    var out = new JSZip();
    var jobs = [];
    var sawBehavior = false;
    zip.forEach(function (rel, entry) {
      if (entry.dir) return;
      var low = rel.toLowerCase();
      if (low === "world_behavior_packs.json" || low.endsWith("/world_behavior_packs.json")) sawBehavior = true;
      if (strip && (low === "world_behavior_packs.json" || low.endsWith("/world_behavior_packs.json"))) {
        changes.push("removido world_behavior_packs.json");
        return;
      }
      if (rel === levelName) {
        out.file(rel, packed);
        return;
      }
      if (worldName && rel.toLowerCase() === "levelname.txt") {
        out.file(rel, worldName);
        return;
      }
      jobs.push(entry.async("uint8array").then(function (data) { out.file(rel, data); }));
    });
    await Promise.all(jobs);
    if (strip && !sawBehavior) changes.push("sem behavior packs no mundo (nada a remover)");
    if (iconBytes) {
      out.file("pack_icon.png", iconBytes);
      changes.push("ícone substituído (pack_icon.png)");
    }
    if (worldName) {
      var hasLevelName = false;
      out.forEach(function (rel) { if (rel.toLowerCase() === "levelname.txt") hasLevelName = true; });
      if (!hasLevelName) out.file("levelname.txt", worldName);
      changes.push("nome alterado");
    }
    var blob = await out.generateAsync({ type: "blob", compression: "STORE" });
    return { blob: blob, changes: changes };
  }

  window.RC_convert = convertMcworld;
  // Internos p/ ferramentas-local.js (diagnóstico --check, level.dat direto, lote). Mesma implementação, sem duplicar.
  window.RC_nbt = { Reader: Reader, walkCollect: walkCollect, splitLevelDat: splitLevelDat, patchBody: patchBody, validateBody: validateBody, packBody: packBody, gunzipAsync: gunzipAsync, gzipAsync: gzipAsync, FLAGS: FLAGS, DIFF_NAMES: DIFF_NAMES };
})();
