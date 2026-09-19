/* ReativaConquistas — licenças Kiwify, validação 100% local (sem servidor)
   Formato: RC-XXXX-XXXX-XXXX (12 chars base32, sem I,L,O,0,1 confusos)
   1º char = tipo: A=avulsa 1 uso | M=30 dias | V=vitalício
   7 chars aleatórios + 4 chars checksum = SHA256(tipo+random+SEGREDO)
   Geração real fica no gerar_codigos.py (segredo SÓ com você).
   Aqui o segredo é público (site estático) — pirataria pontual existe,
   volume compensa. Se crescer, migramos p/ validador Worker grátis.
*/
(function () {
  "use strict";
  var ALPH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  // TROQUE este segredo por um seu (30+ chars aleatórios) e use o MESMO no gerar_codigos.py
  var SECRET = "troque-isso-por-um-segredo-seu-8f3ka9";

  function clean(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  async function shaHex(str) {
    var data = new TextEncoder().encode(str);
    var digest = await crypto.subtle.digest("SHA-256", data);
    var bytes = new Uint8Array(digest);
    var hex = "";
    for (var i = 0; i < bytes.length; i++) hex += ("0" + bytes[i].toString(16)).slice(-2);
    return hex;
  }

  function checksumChars(type, rand, secret) {
    // síncrono não dá (SHA é assíncrono) — versão async abaixo
    return null;
  }

  async function checkChars(type, rand) {
    var hex = await shaHex(type + rand + SECRET);
    var out = "";
    // usa 4 bytes do hash -> 4 chars do alfabeto.
    // ALPH tem 31 chars: índice 31 dobra p/ 0 (se fosse ALPH[31] daria
    // "undefined" e ~12% dos códigos válidos seriam rejeitados).
    for (var i = 0; i < 4; i++) {
      var b = parseInt(hex.substr(i * 2, 2), 16);
      out += ALPH[(b % 32) % ALPH.length];
    }
    return out;
  }

  async function validateCode(raw) {
    var c = clean(raw);
    if (c.length === 14 && c.slice(0, 2) === "RC") c = c.slice(2);
    if (c.length !== 12) return { valid: false, reason: "Código deve ter 12 caracteres." };
    var type = c[0];
    if (type !== "A" && type !== "M" && type !== "V") return { valid: false, reason: "Tipo inválido." };
    var rand = c.slice(0, 8);
    var chk = c.slice(8, 12);
    for (var i = 0; i < rand.length; i++) {
      if (ALPH.indexOf(rand[i]) < 0 && "AVM".indexOf(rand[i]) < 0) {
        // 1º char pode ser A/M/V (fora do ALPH o "A" está, M/V estão? M sim, V sim)
      }
    }
    var expect = await checkChars(type, rand);
    if (expect !== chk) return { valid: false, reason: "Código inválido." };
    return { valid: true, type: type };
  }

  function typeInfo(type) {
    if (type === "A") return { label: "Avulsa (1 conversão)", days: 0 };
    if (type === "M") return { label: "Premium 30 dias", days: 30 };
    return { label: "Vitalício", days: 36500 };
  }

  // ---- armazenamento local ----
  var KEY = "rc_license_v1";
  function getLicense() {
    try {
      var l = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!l || !l.code) return null;
      if (l.type === "M" && Date.now() > l.expiresAt) {
        localStorage.removeItem(KEY);
        return null;
      }
      return l;
    } catch (e) { return null; }
  }
  async function activateCode(raw) {
    var v = await validateCode(raw);
    if (!v.valid) return v;
    var info = typeInfo(v.type);
    var now = Date.now();
    var lic = { code: clean(raw), type: v.type, activatedAt: now, usesLeft: v.type === "A" ? 1 : null,
      expiresAt: v.type === "M" ? now + 30 * 86400 * 1000 : (v.type === "V" ? now + 36500 * 86400 * 1000 : 0) };
    try { localStorage.setItem(KEY, JSON.stringify(lic)); } catch (e) {}
    return { valid: true, type: v.type, license: lic, label: info.label };
  }
  function consumeSingleUse() {
    var l = getLicense();
    if (!l) return;
    if (l.type === "A") {
      localStorage.removeItem(KEY);
    }
  }
  function isPremium() {
    var l = getLicense();
    return !!(l && (l.type === "M" || l.type === "V"));
  }

  window.RC_codes = { validateCode: validateCode, activateCode: activateCode, getLicense: getLicense, isPremium: isPremium, consumeSingleUse: consumeSingleUse, typeInfo: typeInfo };
})();
