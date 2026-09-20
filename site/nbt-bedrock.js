/* ReativaConquistas — NBT little-endian (Bedrock) com parse + encode.
   Usado para ler e reescrever o `~local_player` (inventário, armadura,
   ender chest) e a Pos dos atores (reset de chunks). 100% local.
   Cada nó guarda offset+len (__o/__l) para permitir splice cirúrgico:
   bytes não tocados continuam byte-idênticos no arquivo final.
*/
(function () {
  "use strict";

  var T_END = 0, T_BYTE = 1, T_SHORT = 2, T_INT = 3, T_LONG = 4;
  var T_FLOAT = 5, T_DOUBLE = 6, T_BYTEARRAY = 7, T_STRING = 8;
  var T_LIST = 9, T_COMPOUND = 10, T_INTARRAY = 11, T_LONGARRAY = 12;

  function Reader(buf) {
    this.b = buf;
    this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.p = 0;
  }
  Reader.prototype.need = function (n) {
    if (this.p + n > this.b.length) throw new Error("NBT truncado em " + this.p + "/" + this.b.length);
  };
  Reader.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  Reader.prototype.i16 = function () { this.need(2); var x = this.v.getInt16(this.p, true); this.p += 2; return x; };
  Reader.prototype.u16 = function () { this.need(2); var x = this.v.getUint16(this.p, true); this.p += 2; return x; };
  Reader.prototype.i32 = function () { this.need(4); var x = this.v.getInt32(this.p, true); this.p += 4; return x; };
  Reader.prototype.i64 = function () { this.need(8); var x = this.v.getBigInt64(this.p, true); this.p += 8; return x; };
  Reader.prototype.f32 = function () { this.need(4); var x = this.v.getFloat32(this.p, true); this.p += 4; return x; };
  Reader.prototype.f64 = function () { this.need(8); var x = this.v.getFloat64(this.p, true); this.p += 8; return x; };
  Reader.prototype.raw = function (n) { this.need(n); var s = this.b.subarray(this.p, this.p + n); this.p += n; return s; };
  Reader.prototype.str = function () {
    var n = this.u16(), b = this.raw(n);
    try { return new TextDecoder("utf-8").decode(b); } catch (e) { return ""; }
  };

  // Nó: {t, n, v, o, l}  t=tipo, n=nome, v=valor, o=offset inicial, l=comprimento total
  function readTag(r, named) {
    var start = r.p, t = r.u8(), name = "";
    if (t === T_END) return { t: T_END, n: "", v: null, o: start, l: 1 };
    if (named) name = r.str();
    var v = readPayload(r, t);
    return { t: t, n: name, v: v, o: start, l: r.p - start };
  }
  function readPayload(r, t) {
    var i, n;
    if (t === T_BYTE) return r.u8();
    if (t === T_SHORT) return r.i16();
    if (t === T_INT) return r.i32();
    if (t === T_LONG) return r.i64();
    if (t === T_FLOAT) return r.f32();
    if (t === T_DOUBLE) return r.f64();
    if (t === T_STRING) return r.str();
    if (t === T_BYTEARRAY) { n = r.i32(); if (n < 0) throw new Error("bytearray len"); return r.raw(n); }
    if (t === T_INTARRAY) {
      n = r.i32(); if (n < 0 || n > 10000000) throw new Error("intarray len");
      var a = new Array(n); for (i = 0; i < n; i++) a[i] = r.i32(); return a;
    }
    if (t === T_LONGARRAY) {
      n = r.i32(); if (n < 0 || n > 10000000) throw new Error("longarray len");
      var q = new Array(n); for (i = 0; i < n; i++) q[i] = r.i64(); return q;
    }
    if (t === T_LIST) {
      var e = r.u8(); n = r.i32(); if (n < 0 || n > 10000000) throw new Error("list len");
      var items = [];
      for (i = 0; i < n; i++) {
        if (e === T_COMPOUND) items.push({ t: T_COMPOUND, n: "", v: readCompoundBody(r), o: -1, l: -1 });
        else items.push({ t: e, n: "", v: readPayload(r, e), o: -1, l: -1 });
      }
      return { e: e, items: items };
    }
    if (t === T_COMPOUND) return readCompoundBody(r);
    throw new Error("tag NBT desconhecida: " + t);
  }
  function readCompoundBody(r) {
    var start = r.p, order = [], map = {};
    for (;;) {
      var t0 = r.u8();
      if (t0 === T_END) break;
      var s0 = r.p;
      var nm = r.str();
      var vv = readPayload(r, t0);
      var node = { t: t0, n: nm, v: vv, o: s0 - 1, l: r.p - (s0 - 1) };
      order.push(nm); map[nm] = node;
    }
    return { order: order, map: map, o: start, l: (r.p - start) };
  }

  function parse(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var r = new Reader(u8);
    var root = readTag(r, true);
    if (root.t !== T_COMPOUND) throw new Error("raiz NBT não é Compound");
    return { root: root, end: r.p, total: u8.length };
  }
  // Parse de UM compound a partir de um offset (paletas de subchunk).
  function parseAt(buf, off) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var r = new Reader(u8);
    r.p = off;
    var root = readTag(r, true);
    if (root.t !== T_COMPOUND) throw new Error("paleta não é Compound em " + off);
    return { root: root, end: r.p };
  }
  function compoundGet(root, name) {
    if (!root || root.t !== T_COMPOUND || !root.v || !root.v.map) return null;
    return root.v.map[name] || null;
  }

  /* ---------- encode canônico little-endian ---------- */
  function Writer() { this.parts = []; this.len = 0; }
  Writer.prototype.push = function (u8) { this.parts.push(u8); this.len += u8.length; };
  Writer.prototype.u8 = function (x) { this.push(new Uint8Array([x & 255])); };
  Writer.prototype.u16 = function (x) { var b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, x, true); this.push(b); };
  Writer.prototype.i16 = function (x) { var b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, x, true); this.push(b); };
  Writer.prototype.i32 = function (x) { var b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, x, true); this.push(b); };
  Writer.prototype.i64 = function (x) {
    var b = new Uint8Array(8); var bi = (typeof x === "bigint") ? x : BigInt(Math.trunc(x));
    new DataView(b.buffer).setBigInt64(0, bi, true); this.push(b);
  };
  Writer.prototype.f32 = function (x) { var b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); this.push(b); };
  Writer.prototype.f64 = function (x) { var b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); this.push(b); };
  Writer.prototype.raw = function (u8) { this.push(u8); };
  Writer.prototype.str = function (s) {
    var e = new TextEncoder().encode(String(s));
    this.u16(e.length); this.push(e);
  };
  Writer.prototype.out = function () {
    var o = new Uint8Array(this.len), p = 0, i;
    for (i = 0; i < this.parts.length; i++) { o.set(this.parts[i], p); p += this.parts[i].length; }
    return o;
  };

  function encStr(w, s) { w.str(s); }
  function encPayload(w, t, v) {
    var i;
    if (t === T_BYTE) w.u8(v);
    else if (t === T_SHORT) w.i16(v);
    else if (t === T_INT) w.i32(v);
    else if (t === T_LONG) w.i64(v);
    else if (t === T_FLOAT) w.f32(v);
    else if (t === T_DOUBLE) w.f64(v);
    else if (t === T_STRING) encStr(w, v);
    else if (t === T_BYTEARRAY) { w.i32(v.length); w.raw(v); }
    else if (t === T_INTARRAY) { w.i32(v.length); for (i = 0; i < v.length; i++) w.i32(v[i]); }
    else if (t === T_LONGARRAY) { w.i32(v.length); for (i = 0; i < v.length; i++) w.i64(v[i]); }
    else if (t === T_LIST) {
      w.u8(v.e); w.i32(v.items.length);
      for (i = 0; i < v.items.length; i++) {
        var it = v.items[i];
        if (v.e === T_COMPOUND) encCompoundBody(w, it.v || it);
        else encPayload(w, v.e, it.v !== undefined ? it.v : it);
      }
    }
    else if (t === T_COMPOUND) encCompoundBody(w, v);
    else throw new Error("encode: tag " + t);
  }
  function encCompoundBody(w, c) {
    var i, nm;
    for (i = 0; i < c.order.length; i++) {
      nm = c.order[i];
      var node = c.map[nm];
      w.u8(node.t); encStr(w, nm); encPayload(w, node.t, node.v);
    }
    w.u8(T_END);
  }
  function encode(root) {
    var w = new Writer();
    w.u8(root.t); encStr(w, root.n); encPayload(w, root.t, root.v);
    return w.out();
  }

  /* ---------- construtores ---------- */
  function N(t, n, v) { return { t: t, n: n, v: v, o: -1, l: -1 }; }
  function compound(orderMap) {
    var order = [], map = {}, k;
    for (k in orderMap) { if (Object.prototype.hasOwnProperty.call(orderMap, k)) { order.push(k); map[k] = orderMap[k]; } }
    return { order: order, map: map, o: -1, l: -1 };
  }
  function listOf(elemType, items) { return { e: elemType, items: items }; }

  /* ---------- splice: troca os bytes de um nó-alvo ---------- */
  function splice(original, targetNode, newBytes) {
    if (targetNode.o < 0 || targetNode.l < 0) throw new Error("splice: nó sem offset (foi criado agora, use replaceList)");
    var out = new Uint8Array(original.length - targetNode.l + newBytes.length);
    out.set(original.subarray(0, targetNode.o), 0);
    out.set(newBytes, targetNode.o);
    out.set(original.subarray(targetNode.o + targetNode.l), targetNode.o + newBytes.length);
    return out;
  }
  // Codifica UM nó nomeado (tag+nulo+payload) para splice
  function encodeNamed(node) {
    var w = new Writer();
    w.u8(node.t); encStr(w, node.n); encPayload(w, node.t, node.v);
    return w.out();
  }

  window.RC_nbt2 = {
    T_END: T_END, T_BYTE: T_BYTE, T_SHORT: T_SHORT, T_INT: T_INT, T_LONG: T_LONG,
    T_FLOAT: T_FLOAT, T_DOUBLE: T_DOUBLE, T_BYTEARRAY: T_BYTEARRAY, T_STRING: T_STRING,
    T_LIST: T_LIST, T_COMPOUND: T_COMPOUND, T_INTARRAY: T_INTARRAY, T_LONGARRAY: T_LONGARRAY,
    parse: parse, parseAt: parseAt, encode: encode, encodeNamed: encodeNamed,
    get: compoundGet, N: N, compound: compound, listOf: listOf, splice: splice
  };
})();
