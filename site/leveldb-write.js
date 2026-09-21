/* ReativaConquistas — escrita LevelDB Bedrock (100% local).
   Estratégia (a mesma do próprio LevelDB, sem reescrever SSTs):
   1) anexa um NOVO arquivo db/NNNNNN.log com um WriteBatch
      (puts + deletes com sequence contínua);
   2) anexa um VersionEdit ao MANIFEST atual (logNumber, nextFileNumber,
      lastSequence) — o CURRENT continua apontando para ele;
   3) todo o resto do .zip é copiado byte-idêntico.
   O jogo rejoga o .log na abertura: deletes somem, puts valem.
   NUNCA sobrescreve o original: gera um arquivo novo para download.
   Toda saída passa por validação round-trip (releitura) antes de baixar.
*/
(function () {
  "use strict";

  var BLOCK = 32768;

  /* ---------- varint (base-128 LE, igual protobuf/LevelDB) ---------- */
  function encVarint(x) {
    x = Math.trunc(x);
    if (x < 0) throw new Error("varint negativo");
    var out = [];
    do {
      var b = x % 128;
      x = Math.floor(x / 128);
      if (x > 0) b |= 128;
      out.push(b);
    } while (x > 0);
    return new Uint8Array(out);
  }

  function fixed32(x) {
    var b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, x >>> 0, true);
    return b;
  }
  function fixed64(x) {
    var b = new Uint8Array(8), dv = new DataView(b.buffer);
    var bi = (typeof x === "bigint") ? x : BigInt(Math.trunc(x));
    dv.setBigUint64(0, bi, true);
    return b;
  }

  /* ---------- CRC32C (Castagnoli) + máscara LevelDB ---------- */
  var CRC_T = null;
  function crcTable() {
    if (CRC_T) return CRC_T;
    CRC_T = new Uint32Array(256);
    var P = 0x82F63B78;
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (P ^ (c >>> 1)) : (c >>> 1);
      CRC_T[n] = c >>> 0;
    }
    return CRC_T;
  }
  function crc32c(bytes) {
    var T = crcTable(), c = 0xFFFFFFFF, i;
    for (i = 0; i < bytes.length; i++) c = (T[(c ^ bytes[i]) & 255] ^ (c >>> 8)) >>> 0;
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function maskedCrc(typeByte, payload) {
    var T = crcTable(), c = 0xFFFFFFFF, i;
    c = (T[(c ^ typeByte) & 255] ^ (c >>> 8)) >>> 0;
    for (i = 0; i < payload.length; i++) c = (T[(c ^ payload[i]) & 255] ^ (c >>> 8)) >>> 0;
    c = (c ^ 0xFFFFFFFF) >>> 0;
    var m = (((c >>> 15) | (c << 17)) + 0xA282EAD8) >>> 0;
    return fixed32(m);
  }

  /* ---------- framing de log (blocos 32K, tipos 1=FULL 2=FIRST 3=MID 4=LAST) ---------- */
  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var o = new Uint8Array(n), p = 0;
    for (i = 0; i < parts.length; i++) { o.set(parts[i], p); p += parts[i].length; }
    return o;
  }
  // Escreve UM payload completo respeitando o framing. startOff = offset atual no bloco.
  function framePayload(payload, startOff) {
    var out = [], off = startOff, pos = 0;
    var first = true;
    while (pos < payload.length || first) {
      var remain = BLOCK - off;
      if (remain <= 6) { // trailer: preenche de zeros
        out.push(new Uint8Array(remain)); off = 0; remain = BLOCK;
      }
      var avail = remain - 7;
      var take = Math.min(avail, payload.length - pos);
      var last = (pos + take >= payload.length);
      var type = first ? (last ? 1 : 2) : (last ? 4 : 3);
      var chunk = payload.subarray(pos, pos + take);
      var head = new Uint8Array(7);
      head.set(maskedCrc(type, chunk), 0);
      head[4] = take & 255; head[5] = (take >>> 8) & 255; head[6] = type;
      out.push(head, chunk);
      pos += take; off += 7 + take; first = false;
      if (off === BLOCK) off = 0;
    }
    return { bytes: concat(out), endOff: off };
  }

  /* ---------- WriteBatch: seq64 + count32 + entradas ---------- */
  // ops: [{t:'put',k:u8,v:u8} | {t:'del',k:u8}]
  function buildBatch(ops, startSeq) {
    var parts = [fixed64(startSeq), fixed32(ops.length)], i;
    for (i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t === "put") {
        var h = new Uint8Array(1); h[0] = 1;
        parts.push(h, encVarint(op.k.length), op.k, encVarint(op.v.length), op.v);
      } else {
        var d = new Uint8Array(1); d[0] = 0;
        parts.push(d, encVarint(op.k.length), op.k);
      }
    }
    return concat(parts);
  }

  /* ---------- VersionEdit (só os campos que mudam) ---------- */
  function buildVersionEdit(f) {
    var parts = [];
    function tagV(tag, val) { parts.push(encVarint(tag), encVarint(val)); }
    if (f.logNumber !== undefined) tagV(2, f.logNumber);
    if (f.nextFileNumber !== undefined) tagV(3, f.nextFileNumber);
    if (f.lastSequence !== undefined) tagV(4, f.lastSequence);
    if (f.prevLogNumber !== undefined) tagV(9, f.prevLogNumber);
    return concat(parts);
  }

  function pad6(n) {
    var s = String(n);
    while (s.length < 6) s = "0" + s;
    return s;
  }

  /* ---------- API principal ---------- */
  // args: {manifestBytes, manifestName, nextFile, lastSeq, logNumber, ops}
  // retorna {logName, logBytes, newManifestBytes}
  function buildDbUpdate(args) {
    if (!args.ops || !args.ops.length) throw new Error("nada para gravar");
    if (!isFinite(args.nextFile) || !isFinite(args.lastSeq)) throw new Error("MANIFEST ilegível (mundo incompleto?)");
    if (!args.manifestBytes || !args.manifestBytes.length) throw new Error("MANIFEST vazio");
    if (!Number.isSafeInteger(args.lastSeq) || args.lastSeq < 0 || !Number.isSafeInteger(args.lastSeq + args.ops.length)) throw new Error("Sequência LevelDB inválida");
    var newLogNum = Math.trunc(args.nextFile);
    var batch = buildBatch(args.ops, args.lastSeq + 1);
    var logFramed = framePayload(batch, 0);
    var edit = buildVersionEdit({
      logNumber: args.logNumber || newLogNum,
      prevLogNumber: 0,
      nextFileNumber: newLogNum + 1,
      lastSequence: args.lastSeq + args.ops.length
    });
    var startOff = args.manifestBytes.length % BLOCK;
    var manFramed = framePayload(edit, startOff);
    var nm = concat([args.manifestBytes, manFramed.bytes]);
    return {
      logName: args.manifestName.replace(/[^/\\]+$/, "") + pad6(newLogNum) + ".log",
      logBytes: logFramed.bytes,
      newManifestBytes: nm,
      newManifestName: args.manifestName,
      newLastSeq: args.lastSeq + args.ops.length,
      ops: args.ops.length
    };
  }

  window.RC_ldbw = {
    buildDbUpdate: buildDbUpdate,
    buildBatch: buildBatch,
    framePayload: framePayload,
    crc32c: crc32c,
    encVarint: encVarint,
    BLOCK: BLOCK
  };
})();
