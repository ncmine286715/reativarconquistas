/* ReativaConquistas — gerador de códigos 100% local (port de gerar_codigos.py)
   Roda no navegador, sem Python. Uso: página gerar-codigos.html (só no seu PC).
   Formato: RC-XXXX-XXXX-XXXX | A=avulsa 1 uso | M=30 dias | V=vitalício
   Algoritmo idêntico ao .py: rand7 via CSPRNG + checksum SHA256(tipo+rand+SEGREDO).
   ATENÇÃO: use o MESMO segredo em site/codes.js (var SECRET). Guarde este
   arquivo/página só para você — não publique o segredo.
*/
(function () {
  "use strict";

  var ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  // MESMO valor de site/codes.js — troque nos dois lugares antes de vender.
  var DEFAULT_SECRET = "troque-isso-por-um-segredo-seu-8f3ka9";

  function clean(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  async function shaHex(str) {
    var data = new TextEncoder().encode(str);
    var digest = await crypto.subtle.digest("SHA-256", data);
    var bytes = new Uint8Array(digest);
    var hex = "";
    for (var i = 0; i < bytes.length; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
    return hex;
  }

  async function checksum4(type, rand, secret) {
    var hex = await shaHex(type + rand + secret);
    var out = "";
    // ALPH tem 31 chars: índice 31 dobra p/ 0 (mesma regra do gerar_codigos.py
    // e do validador codes.js — os três precisam ser idênticos).
    for (var i = 0; i < 4; i++) {
      out += ALPH[(parseInt(hex.substr(i * 2, 2), 16) % 32) % ALPH.length];
    }
    return out;
  }

  var RAND_LIM = Math.floor(256 / ALPH.length) * ALPH.length; // 248
  function rand31() {
    // Sorteio sem viés sobre os 31 chars (rejeita bytes >= 248).
    var b = new Uint8Array(1);
    do { crypto.getRandomValues(b); } while (b[0] >= RAND_LIM);
    return ALPH[b[0] % ALPH.length];
  }

  function rand7() {
    var s = "";
    for (var i = 0; i < 7; i++) s += rand31();
    return s;
  }

  function fmt(raw12) {
    return "RC-" + raw12.slice(0, 4) + "-" + raw12.slice(4, 8) + "-" + raw12.slice(8, 12);
  }

  async function generateOne(type, secret) {
    type = String(type || "").toUpperCase();
    if (type !== "A" && type !== "M" && type !== "V") throw new Error("Tipo inválido (use A, M ou V).");
    secret = secret || DEFAULT_SECRET;
    var rand = type + rand7(); // 8 chars, 1º = tipo (igual ao .py)
    var chk = await checksum4(type, rand, secret);
    return fmt(rand + chk);
  }

  async function generateBatch(type, qty, secret, onProgress) {
    qty = Math.floor(+qty || 0);
    if (!(qty >= 1 && qty <= 5000)) throw new Error("Quantidade deve ser 1–5000.");
    var out = [];
    for (var i = 0; i < qty; i++) {
      out.push(await generateOne(type, secret));
      if (onProgress) onProgress(i + 1, qty);
      // cede o event loop para a página não travar em lotes grandes
      if (i % 50 === 49) await new Promise(function (r) { setTimeout(r, 0); });
    }
    return out;
  }

  function downloadTxt(codes, type) {
    var blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "codigos_" + type + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  window.RC_gen = {
    ALPH: ALPH,
    DEFAULT_SECRET: DEFAULT_SECRET,
    clean: clean,
    generateOne: generateOne,
    generateBatch: generateBatch,
    downloadTxt: downloadTxt
  };
})();
