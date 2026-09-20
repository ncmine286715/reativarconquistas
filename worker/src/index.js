/* ReativaConquistas — Worker Cloudflare (API: Depix + AbacatePay + contas).
   NENHUM segredo neste arquivo: tudo via `wrangler secret put` (nunca no git/site).
   Planos: "vip24h" (Passe 24h = 590 centavos, 1 dia) e "vip30" (VIP 30 dias = 1990 centavos).
   Fluxo Depix (ativo): site/pagamento.js -> POST /api/depix/create -> api.depixapp.com
   -> payment_url -> volta em sucesso.html?checkout_id=chk_... -> GET /api/depix/status
   -> webhook POST /api/depix/webhook (HMAC X-DePix-Signature com DEPIX_WEBHOOK_SECRET).
   Endpoints (chamados por site/pagamento.js e site/auth.js):
      POST /api/auth/register {email,name,password} -> {token,email,name}
      POST /api/auth/login    {email,password} -> {token,email,name}
      GET  /api/auth/me      (Bearer) -> {email,name,premium_until_ms}
      POST /api/auth/logout  (Bearer) -> {ok:true}
      POST /api/depix/create   {email, name, plan?, payer_tax_number} -> {url, id, plan}
                               (plan "vip24h"|"vip30", padrão "vip30")
      GET  /api/depix/status?id=chk_... -> {status, paid, email, plan?, premium_until_ms?}
      POST /api/depix/webhook   (chamado pelo Depix App; verifica HMAC)
      POST /api/depix/simulate {id} (TESTE local: sk_test_ marca como pago)
      POST /api/abacate/create   {email, name, plan?} -> {url, id, plan} (reserva)
      GET  /api/abacate/status?id=BILLING_ID -> {status, paid, email, plan?, premium_until_ms?}
      POST /api/abacate/webhook[?secret=...]   (chamado pelo AbacatePay)
      GET  /api/premium?email=X -> {premium_until_ms}
      GET  /api/config -> flags públicas
      POST /api/kiwify/webhook[?secret=...] (reserva — backup em site/backup-kiwify-*)
    Secrets (via API: nunca neste arquivo nem no git):
      DEPIX_API_KEY (sk_test_ p/ teste, sk_live_ p/ produção),
      DEPIX_WEBHOOK_SECRET (whsec_... do painel Depix > My Business),
      ABACATEPAY_API_KEY, WEBHOOK_SECRET, KIWIFY_SECRET
    Vars (wrangler.toml): ABACATEPAY_PRODUCT_ID, ABACATEPAY_PRODUCT_ID_24H,
      KIWIFY_PID_24H, KIWIFY_PID_30D, PUBLIC_BASE_URL, ALLOWED_ORIGINS,
      DEPIX_TEST_MODE ("1" = teste).
    KV: PREMIUM_KV (contas, sessões, pendentes, premium).
*/

const PAID = new Set(["PAID", "COMPLETED", "APPROVED", "ACTIVE", "PAYMENT_CONFIRMED", "CONFIRMED"]);

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
  });
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const ok = allowed.includes("*") || (origin && (allowed.includes(origin) ||
    allowed.some((a) => a.startsWith("*.") && origin.endsWith(a.slice(1))) || local));
  // file:// manda Origin "null": permitido para criar checkout (sem custo e com
  // rate-limit; a liberação do Premium sempre reconfere no AbacatePay).
  const o = origin || "null";
  if (ok || o === "null") {
    return {
      "Access-Control-Allow-Origin": o === "null" ? "*" : o,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }
  return {};
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim().toLowerCase().slice(0, 120));
const validPw = (p) => typeof p === "string" && p.length >= 8 && p.length <= 128;
const premKey = (email) => "prem:" + email.trim().toLowerCase();
const premUidKey = (uid) => "premuid:" + String(uid || "").trim().slice(0, 160);
const pendKey = (id) => "pend:" + id;
const acctKey = (email) => "acct:" + email.trim().toLowerCase();
const sessKey = (t) => "sess:" + t;
const grantKey = (id) => "grant:" + String(id || "").trim().slice(0, 180);
const SESS_TTL = 30 * 86400;

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
async function hashPw(pw, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return { salt: b64(salt), hash: b64(new Uint8Array(bits)) };
}
function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function sessionEmail(req, env) {
  const h = req.headers.get("Authorization") || "";
  const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!t || t.length > 128) return "";
  const s = await env.PREMIUM_KV.get(sessKey(t), "json").catch(() => null);
  if (!s || s.exp < Date.now()) return "";
  return s.email || "";
}

// Valida o ID token do Firebase no servidor. O navegador nunca escolhe qual
// conta receberá o VIP: UID/e-mail vêm da sessão Google verificada.
async function firebaseUser(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const apiKey = String(env.FIREBASE_WEB_API_KEY || "").trim();
  if (!token || token.length > 4096 || !apiKey) return null;
  try {
    const resp = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const u = data && data.users && data.users[0];
    if (!u || !u.localId || !validEmail(u.email)) return null;
    return {
      uid: String(u.localId).slice(0, 160),
      email: String(u.email).trim().toLowerCase(),
      name: String(u.displayName || "").slice(0, 80),
    };
  } catch (e) {
    return null;
  }
}
async function rlTake(env, key, limit, ttl) {
  const n = parseInt((await env.PREMIUM_KV.get(key).catch(() => null)) || "0", 10);
  if (n >= limit) return false;
  await env.PREMIUM_KV.put(key, String(n + 1), { expirationTtl: ttl }).catch(() => {});
  return true;
}
async function premiumUntil(env, email) {
  const rec = await env.PREMIUM_KV.get(premKey(email), "json").catch(() => null);
  return rec && rec.until > Date.now() ? rec.until : 0;
}
async function premiumUntilAccount(env, uid, email) {
  const byUid = uid ? await env.PREMIUM_KV.get(premUidKey(uid), "json").catch(() => null) : null;
  const byEmail = email ? await env.PREMIUM_KV.get(premKey(email), "json").catch(() => null) : null;
  const until = Math.max((byUid && +byUid.until) || 0, (byEmail && +byEmail.until) || 0);
  // Migração transparente: VIP antigo por e-mail passa a acompanhar a conta Google.
  if (uid && until > Date.now() && (!byUid || +byUid.until < until)) {
    await env.PREMIUM_KV.put(premUidKey(uid), JSON.stringify({ until, email, migrated_at: Date.now() })).catch(() => {});
  }
  return until > Date.now() ? until : 0;
}

async function abacateCreate(env, email, name, origin, plan) {
  plan = plan === "vip24h" ? "vip24h" : "vip30";
  const pid = plan === "vip24h" ? env.ABACATEPAY_PRODUCT_ID_24H : env.ABACATEPAY_PRODUCT_ID;
  if (!pid) {
    throw new Error(plan === "vip24h"
      ? "Passe 24h não configurado no servidor (ABACATEPAY_PRODUCT_ID_24H)."
      : "Produto não configurado no servidor (ABACATEPAY_PRODUCT_ID).");
  }
  const base = (origin || String(env.PUBLIC_BASE_URL || "")).replace(/\/+$/, "");
  const body = {
    items: [{ id: pid, quantity: 1 }],
    returnUrl: base + "/",
    completionUrl: base + "/sucesso.html",
    metadata: { email, name, plan },
    methods: ["PIX", "CARD"],
  };
  const resp = await fetch("https://api.abacatepay.com/v2/checkouts/create", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.ABACATEPAY_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await resp.text();
  let data;
  try { data = JSON.parse(txt); } catch { throw new Error("AbacatePay respondeu algo inválido."); }
  if (!resp.ok) {
    const detail = String((data && (data.error || data.message)) || txt).slice(0, 300);
    if (/version mismatch/i.test(detail)) {
      throw new Error("Chave/produto incompatíveis: confira ABACATEPAY_PRODUCT_ID no Worker.");
    }
    throw new Error("AbacatePay recusou (" + resp.status + "): " + detail);
  }
  const d = data.data || data;
  if (!d.url) throw new Error("AbacatePay não retornou URL de pagamento.");
  return { url: d.url, id: d.id, plan };
}

async function abacateStatus(env, id) {
  const urls = [
    "https://api.abacatepay.com/v2/checkouts/get?id=" + encodeURIComponent(id),
    "https://api.abacatepay.com/v1/billing/get?id=" + encodeURIComponent(id),
  ];
  let last = null;
  for (const u of urls) {
    try {
      const resp = await fetch(u, { headers: { Authorization: "Bearer " + env.ABACATEPAY_API_KEY } });
      if (!resp.ok) { last = new Error("HTTP " + resp.status); continue; }
      const data = await resp.json();
      const b = data.data || data;
      const status = String(b.status || "").toUpperCase();
      const meta = b.metadata || {};
      const cust = b.customer || {};
      const email = String(meta.email || cust.email || "").toLowerCase();
      return { status: status || "UNKNOWN", paid: PAID.has(status) || /PAID/.test(status), email };
    } catch (e) { last = e; }
  }
  throw new Error("Não consegui consultar a cobrança agora (" + (last && last.message) + ").");
}

/* ---------- Depix: preços em centavos p/ teste e produção ---------- */
function normalizeDepixPlan(plan) {
  return plan === "vip24h" || plan === "vip7" || plan === "vip30" ? plan : "vip30";
}
function depixAmount(plan) {
  plan = normalizeDepixPlan(plan);
  if (plan === "vip24h") return 590;
  if (plan === "vip7") return 990;
  return 1990;
}
function depixPlanDays(plan) {
  plan = normalizeDepixPlan(plan);
  if (plan === "vip24h") return 1;
  if (plan === "vip7") return 7;
  return 30;
}
function depixPlanLabel(plan) {
  plan = normalizeDepixPlan(plan);
  if (plan === "vip24h") return "Passe 24h";
  if (plan === "vip7") return "VIP 7 dias";
  return "VIP 30 dias";
}
function cleanDoc(s) {
  return String(s || "").replace(/\D/g, "").slice(0, 14);
}
function validDocServer(s) {
  var d = cleanDoc(s);
  if (d.length === 11 && !/^(\d)\1{10}$/.test(d)) return true; // CPF: formato (a receita valida no QR)
  if (d.length === 14 && !/^(\d)\1{13}$/.test(d)) return true; // CNPJ: formato
  return false;
}
// Verifica HMAC do webhook Depix: header "t=...,v1=..." sobre "timestamp.rawBody".
async function verifyDepixSignature(rawBody, header, secret) {
  if (!secret || !header) return false;
  var t = "", v1 = "";
  String(header).split(",").forEach(function (p) {
    var kv = String(p).trim().split("=");
    if (kv[0] === "t") t = kv[1] || "";
    if (kv[0] === "v1") v1 = (kv[1] || "").toLowerCase();
  });
  if (!t || !v1 || !/^[0-9]+$/.test(t)) return false;
  if (Math.abs(Date.now() / 1000 - (+t)) > 600) return false; // tolerância 10 min
  try {
    var key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + rawBody));
    var hex = [...new Uint8Array(sig)].map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return hex === v1;
  } catch (e) { return false; }
}
async function depixCreate(env, email, name, uid, plan, doc, req) {
  if (!env.DEPIX_API_KEY) throw new Error("Depix não configurado no servidor (DEPIX_API_KEY). Rode: wrangler secret put DEPIX_API_KEY");
  plan = normalizeDepixPlan(plan);
  var amount = depixAmount(plan);
  var origin = "";
  try { origin = new URL(req.url).origin; } catch (e) {}
  var siteBase = "";
  try {
    var o = req.headers.get("Origin") || "";
    siteBase = o.startsWith("http") ? o : String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  } catch (e2) {}
  if (!siteBase) siteBase = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  var body = {
    amount: amount,
    payer_tax_number: cleanDoc(doc),
    description: "ReativaConquistas — " + depixPlanLabel(plan),
    expires_in: 1200,
    callback_url: origin + "/api/depix/webhook",
    redirect_url: siteBase + "/sucesso.html",
    metadata: { firebase_uid: uid || "", email: email, name: name || "", plan: plan }
  };
  var resp = await fetch("https://api.depixapp.com/api/checkouts", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.DEPIX_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  var txt = await resp.text();
  var data = {};
  try { data = txt ? JSON.parse(txt) : {}; } catch (e) { throw new Error("Depix respondeu algo inválido."); }
  if (!resp.ok) {
    var msg = String((data.response && data.response.errorMessage) || (data.error && data.error.message) || txt).slice(0, 300);
    throw new Error("Depix recusou (" + resp.status + "): " + msg);
  }
  if (!data.id || !data.payment_url) throw new Error("Depix não retornou link de pagamento.");
  return { url: data.payment_url, id: data.id, plan: plan };
}
async function depixStatus(env, id) {
  if (!env.DEPIX_API_KEY) throw new Error("Depix não configurado no servidor (DEPIX_API_KEY).");
  var resp = await fetch("https://api.depixapp.com/api/checkouts/" + encodeURIComponent(id), {
    headers: { Authorization: "Bearer " + env.DEPIX_API_KEY }
  });
  if (!resp.ok) throw new Error("Não consegui consultar o Pix agora (HTTP " + resp.status + ").");
  var data = await resp.json();
  var c = data.checkout || data;
  var status = String(c.status || "").toLowerCase();
  var paid = status === "completed" || status === "approved";
  var meta = c.metadata || {};
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch (e) { meta = {}; } }
  return {
    status: status || "unknown",
    paid: paid,
    uid: String(meta.firebase_uid || "").slice(0, 160),
    email: String(meta.email || "").toLowerCase(),
    plan: normalizeDepixPlan(meta.plan)
  };
}

async function grantPremium(env, email, billingId, days, uid = "") {
  days = [1, 7, 30].includes(+days) ? +days : 30;
  email = email.trim().toLowerCase();
  uid = String(uid || "").trim().slice(0, 160);
  billingId = String(billingId || "").trim().slice(0, 180);
  const now = Date.now();

  // Polling e webhooks podem repetir a MESMA confirmação. Não some o plano
  // novamente quando o ID da cobrança/pedido já foi processado.
  if (billingId) {
    const previous = await env.PREMIUM_KV.get(grantKey(billingId), "json").catch(() => null);
    if (previous && +previous.until > 0 &&
        ((!uid && previous.email === email) || (uid && previous.uid === uid))) return +previous.until;
  }

  const curEmail = await env.PREMIUM_KV.get(premKey(email), "json").catch(() => null);
  const curUid = uid ? await env.PREMIUM_KV.get(premUidKey(uid), "json").catch(() => null) : null;
  const baseUntil = Math.max(now, (curEmail && +curEmail.until) || 0, (curUid && +curUid.until) || 0);
  const until = baseUntil + days * 86400000;

  const record = { until, email, uid, billing_id: billingId, granted_at: now };
  await env.PREMIUM_KV.put(premKey(email), JSON.stringify(record));
  if (uid) await env.PREMIUM_KV.put(premUidKey(uid), JSON.stringify(record));

  if (billingId) {
    await env.PREMIUM_KV.put(
      grantKey(billingId),
      JSON.stringify({ email, uid, until, days, granted_at: now }),
      { expirationTtl: 400 * 86400 }
    ).catch(() => {});
  }
  return until;
}

// Dias de VIP a partir do plano guardado no pendente (padrão: 30).
function planDays(pend) {
  if (pend && pend.plan === "vip24h") return 1;
  if (pend && pend.plan === "vip7") return 7;
  return 30;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // O mesmo Worker tambem pode servir o frontend quando o dominio aponta
    // diretamente para ele. Rotas /api/* continuam sendo tratadas abaixo.
    if (!url.pathname.startsWith("/api/") && env.ASSETS) {
      return env.ASSETS.fetch(req);
    }

    try {
      // ---------- flags públicas ----------
      if (url.pathname === "/api/config" && req.method === "GET") {
        return json({ abacate_configured: !!env.ABACATEPAY_API_KEY, product_configured: !!env.ABACATEPAY_PRODUCT_ID, product24h_configured: !!env.ABACATEPAY_PRODUCT_ID_24H, premium_days: 30, accounts: true, firebase_auth: !!env.FIREBASE_WEB_API_KEY, depix_configured: !!env.DEPIX_API_KEY, depix_test_mode: String(env.DEPIX_TEST_MODE || "") === "1" || String(env.DEPIX_API_KEY || "").startsWith("sk_test_"), pass24h_cents: 590, vip7_cents: 990, premium30_cents: 1990 }, 200, cors);
      }

      // ---------- Depix: criar checkout Pix ----------
      if (url.pathname === "/api/depix/create" && req.method === "POST") {
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const plan = normalizeDepixPlan(body.plan);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com sua conta Google para continuar." }, 401, cors);
        const email = fb.email;
        const name = fb.name;
        const uid = fb.uid;
        const doc = cleanDoc(body.payer_tax_number || body.doc || body.cpf);
        if (!validDocServer(doc)) return json({ error: "Informe um CPF/CNPJ válido p/ gerar o Pix." }, 400, cors);
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-depix:" + ip, 10, 3600))) return json({ error: "Muitas tentativas. Aguarde 1 hora." }, 429, cors);
        try {
          const r = await depixCreate(env, email, name, uid, plan, doc, req);
          await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({ uid, email, at: Date.now(), plan, via: "depix" }), { expirationTtl: 86400 }).catch(() => {});
          return json(r, 200, cors);
        } catch (e) {
          return json({ error: String((e && e.message) || e) }, 502, cors);
        }
      }

      // ---------- Depix: status (volta do checkout / polling) ----------
      if (url.pathname === "/api/depix/status" && req.method === "GET") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!id) return json({ error: "Parâmetro 'id' obrigatório." }, 400, cors);
        try {
          const info = await depixStatus(env, id);
          const out = { status: info.status, paid: info.paid, email: info.email, plan: info.plan };
          let email = info.email;
          let uid = info.uid || "";
          let pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
          if (pend && pend.uid && !uid) uid = String(pend.uid);
          const plan = normalizeDepixPlan((pend && pend.plan) || info.plan || "vip30");
          out.plan = plan;
          if (email) out.email = email;
          if (info.paid && email) {
            out.premium_until_ms = await grantPremium(env, email, id, depixPlanDays(plan), uid);
            await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
          }
          return json(out, 200, cors);
        } catch (e) {
          return json({ error: String((e && e.message) || e) }, 502, cors);
        }
      }

      // ---------- Depix: webhook (Depix -> Worker; verifica HMAC) ----------
      if (url.pathname === "/api/depix/webhook" && req.method === "POST") {
        const raw = await req.text();
        const sig = req.headers.get("X-DePix-Signature") || req.headers.get("x-depix-signature") || "";
        if (env.DEPIX_WEBHOOK_SECRET) {
          const ok = await verifyDepixSignature(raw, sig, env.DEPIX_WEBHOOK_SECRET);
          if (!ok) return json({ error: "forbidden" }, 403, cors);
        }
        let evt = {};
        try { evt = raw ? JSON.parse(raw) : {}; } catch { evt = {}; }
        const data = evt.data || evt.checkout || evt;
        const bid = String(data.id || data.checkout_id || data.checkoutId || "");
        const status = String(evt.type || evt.event || data.status || "").toLowerCase();
        const isCompleted = /completed/.test(status) || data.status === "completed";
        try {
          const lst = (await env.PREMIUM_KV.get("dlog", "json").catch(() => null)) || [];
          lst.unshift({ at: Date.now(), type: String(evt.type || evt.event || "").slice(0, 60), id: bid.slice(0, 40), status: status.slice(0, 30) });
          await env.PREMIUM_KV.put("dlog", JSON.stringify(lst.slice(0, 50))).catch(() => {});
        } catch (e) {}
        if (bid && (isCompleted || status.includes("checkout"))) {
          try {
            const info = await depixStatus(env, bid);
            let email = info.email;
            let uid = info.uid || "";
            const pend = await env.PREMIUM_KV.get(pendKey(bid), "json").catch(() => null);
            if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
            if (pend && pend.uid && !uid) uid = String(pend.uid);
            const plan = normalizeDepixPlan((pend && pend.plan) || info.plan || "vip30");
            if (info.paid && email) await grantPremium(env, email, bid, depixPlanDays(plan), uid);
          } catch (e) { console.log("depix webhook erro: " + (e && e.message)); }
        }
        return json({ ok: true }, 200, cors);
      }

      // ---------- Depix: visor do log (só com segredo do webhook) ----------
      if (url.pathname === "/api/depix/log" && req.method === "GET") {
        if (!env.DEPIX_WEBHOOK_SECRET || url.searchParams.get("secret") !== env.DEPIX_WEBHOOK_SECRET) {
          return json({ error: "forbidden" }, 403, cors);
        }
        return json({ items: (await env.PREMIUM_KV.get("dlog", "json").catch(() => null)) || [] }, 200, cors);
      }

      // ---------- Depix: simular pagamento (TESTE local, sk_test_ apenas) ----------
      if (url.pathname === "/api/depix/simulate" && req.method === "POST") {
        if (!env.DEPIX_API_KEY || !String(env.DEPIX_API_KEY).startsWith("sk_test_")) {
          return json({ error: "Simulação só com sk_test_ no servidor." }, 403, cors);
        }
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const id = String(body.id || url.searchParams.get("id") || "").trim();
        if (!id) return json({ error: "Parâmetro 'id' obrigatório." }, 400, cors);
        const resp = await fetch("https://api.depixapp.com/api/checkouts/" + encodeURIComponent(id) + "/simulate-payment", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.DEPIX_API_KEY, "Content-Type": "application/json" },
          body: "{}"
        });
        const txt = await resp.text();
        if (!resp.ok) return json({ error: "Depix recusou simulação (" + resp.status + "): " + txt.slice(0, 200) }, 502, cors);
        return json({ ok: true, id: id }, 200, cors);
      }

      // ---------- log de erro do navegador (diagnóstico; leitura protegida) ----------
      if (url.pathname === "/api/client-log" && req.method === "POST") {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-log:" + ip, 20, 3600))) return json({ ok: false }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const entry = {
          at: Date.now(),
          step: String(body.step || "").slice(0, 40),
          msg: String(body.message || "").slice(0, 300),
          href: String(body.href || "").slice(0, 120),
          ua: (req.headers.get("User-Agent") || "").slice(0, 120),
        };
        const lst = (await env.PREMIUM_KV.get("clog", "json").catch(() => null)) || [];
        lst.unshift(entry);
        await env.PREMIUM_KV.put("clog", JSON.stringify(lst.slice(0, 50))).catch(() => {});
        return json({ ok: true }, 200, cors);
      }
      if (url.pathname === "/api/client-log" && req.method === "GET") {
        if (!env.WEBHOOK_SECRET || url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
          return json({ error: "forbidden" }, 403, cors);
        }
        return json({ items: (await env.PREMIUM_KV.get("clog", "json").catch(() => null)) || [] }, 200, cors);
      }

      // ---------- contas: registro ----------
      if (url.pathname === "/api/auth/register" && req.method === "POST") {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-reg:" + ip, 10, 3600))) return json({ error: "Muitas contas criadas. Aguarde 1 hora." }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim().slice(0, 80);
        if (name.length < 2) return json({ error: "Informe seu nome." }, 400, cors);
        if (!validEmail(email)) return json({ error: "Informe um e-mail válido." }, 400, cors);
        if (!validPw(body.password)) return json({ error: "A senha precisa de 8 a 128 caracteres." }, 400, cors);
        if (await env.PREMIUM_KV.get(acctKey(email)).catch(() => null)) {
          return json({ error: "Este e-mail já tem conta. Faça login.", code: "EXISTS" }, 409, cors);
        }
        const { salt, hash } = await hashPw(body.password);
        await env.PREMIUM_KV.put(acctKey(email), JSON.stringify({ name, salt, hash, created: Date.now() }));
        const token = newToken();
        await env.PREMIUM_KV.put(sessKey(token), JSON.stringify({ email, exp: Date.now() + SESS_TTL * 1000 }), { expirationTtl: SESS_TTL });
        return json({ token, email, name }, 200, cors);
      }

      // ---------- contas: login ----------
      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-login:" + ip, 20, 3600))) return json({ error: "Muitas tentativas. Aguarde 1 hora." }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const email = String(body.email || "").trim().toLowerCase();
        const acct = await env.PREMIUM_KV.get(acctKey(email), "json").catch(() => null);
        if (!acct) return json({ error: "E-mail ou senha incorretos." }, 401, cors);
        const { hash } = await hashPw(String(body.password || ""), acct.salt);
        if (hash !== acct.hash) return json({ error: "E-mail ou senha incorretos." }, 401, cors);
        const token = newToken();
        await env.PREMIUM_KV.put(sessKey(token), JSON.stringify({ email, exp: Date.now() + SESS_TTL * 1000 }), { expirationTtl: SESS_TTL });
        return json({ token, email, name: acct.name || "" }, 200, cors);
      }

      // ---------- contas: quem sou ----------
      if (url.pathname === "/api/auth/me" && req.method === "GET") {
        const email = await sessionEmail(req, env);
        if (!email) return json({ error: "Sessão inválida. Entre de novo." }, 401, cors);
        const acct = await env.PREMIUM_KV.get(acctKey(email), "json").catch(() => null);
        return json({ email, name: (acct && acct.name) || "", premium_until_ms: await premiumUntil(env, email) }, 200, cors);
      }

      // ---------- contas: sair ----------
      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        const h = req.headers.get("Authorization") || "";
        const t = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
        if (t) await env.PREMIUM_KV.delete(sessKey(t)).catch(() => {});
        return json({ ok: true }, 200, cors);
      }

      // ---------- criar checkout ----------
      if (url.pathname === "/api/abacate/create" && req.method === "POST") {
        if (!env.ABACATEPAY_API_KEY) return json({ error: "Pagamento não configurado no servidor." }, 502, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const plan = body.plan === "vip24h" ? "vip24h" : "vip30";
        if (plan === "vip24h" && !env.ABACATEPAY_PRODUCT_ID_24H) return json({ error: "Passe 24h não configurado no servidor." }, 502, cors);
        if (plan === "vip30" && !env.ABACATEPAY_PRODUCT_ID) return json({ error: "Produto não configurado no servidor." }, 502, cors);
        const email = (await sessionEmail(req, env)) || String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim().slice(0, 80);
        if (!validEmail(email)) return json({ error: "Informe um e-mail válido (ou entre na conta)." }, 400, cors);
        // rate-limit simples: 10 criações/hora por IP
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        const rlKey = "rl:" + ip;
        const n = parseInt((await env.PREMIUM_KV.get(rlKey).catch(() => null)) || "0", 10);
        if (n >= 10) return json({ error: "Muitas tentativas. Aguarde 1 hora." }, 429, cors);
        await env.PREMIUM_KV.put(rlKey, String(n + 1), { expirationTtl: 3600 }).catch(() => {});
        const origin = req.headers.get("Origin") || "";
        const r = await abacateCreate(env, email, name, origin.startsWith("http") ? origin : "", plan);
        await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({ email, at: Date.now(), plan }), { expirationTtl: 86400 }).catch(() => {});
        return json(r, 200, cors);
      }

      // ---------- status ----------
      if (url.pathname === "/api/abacate/status" && req.method === "GET") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!id) return json({ error: "Parâmetro 'id' obrigatório." }, 400, cors);
        const info = await abacateStatus(env, id);
        const out = { status: info.status, paid: info.paid, email: info.email };
        let email = info.email;
        let pend = null;
        if (!email || info.paid) {
          pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
        }
        if (info.paid && email) {
          const days = planDays(pend);
          out.plan = days === 1 ? "vip24h" : "vip30";
          out.premium_until_ms = await grantPremium(env, email, id, days);
          await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
        }
        return json(out, 200, cors);
      }

      // ---------- webhook (AbacatePay -> Worker; nunca confia só no POST) ----------
      if (url.pathname === "/api/abacate/webhook" && req.method === "POST") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
          return json({ error: "forbidden" }, 403, cors);
        }
        let evt = {};
        try { evt = await req.json(); } catch { evt = {}; }
        const data = evt.data || evt;
        const billing = data.billing || data;
        const bid = String(billing.id || data.id || "");
        if (bid) {
          try {
            const info = await abacateStatus(env, bid);
            let email = info.email;
            let pend = null;
            if (!email || info.paid) {
              pend = await env.PREMIUM_KV.get(pendKey(bid), "json").catch(() => null);
              if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
            }
            if (info.paid && email) await grantPremium(env, email, bid, planDays(pend));
          } catch (e) { console.log("webhook erro: " + (e && e.message)); }
        }
        return json({ ok: true }, 200, cors);
      }

      // ---------- Kiwify: compra aprovada -> libera VIP ----------      // Na Kiwify: produto -> Webhooks -> Adicionar: evento "Compra aprovada",
      // URL: https://<worker>/api/kiwify/webhook?secret=VALOR (VALOR = secret
      // KIWIFY_SECRET). Dias pelo produto: KIWIFY_PID_24H = 1, KIWIFY_PID_30D = 30.
      if (url.pathname === "/api/kiwify/webhook" && req.method === "POST") {
        if (!env.KIWIFY_SECRET || url.searchParams.get("secret") !== env.KIWIFY_SECRET) {
          return json({ error: "forbidden" }, 403, cors);
        }
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const evt = String(body.webhook_event_type || body.event || body.type || "");
        const status = String(body.order_status || body.status || body.orderStatus || "").toLowerCase();
        const approved = /approv/i.test(evt) || ["paid", "approved", "completed", "active", "payment_confirmed", "confirmed"].includes(status);
        const email = String((body.Customer && body.Customer.email) || (body.customer && body.customer.email) || (body.Client && body.Client.email) || body.customer_email || body.customerEmail || body.email || "").trim().toLowerCase();
        const pid = String((body.Product && (body.Product.product_id || body.Product.id)) || body.product_id || body.productId || "");
        const oid = String(body.order_id || body.orderId || body.id || body.code || "");
        // log cru (últimos 50) p/ depurar sem adivinhar formato
        try {
          const lst = (await env.PREMIUM_KV.get("klog", "json").catch(() => null)) || [];
          lst.unshift({ at: Date.now(), evt, status, email, pid, oid });
          await env.PREMIUM_KV.put("klog", JSON.stringify(lst.slice(0, 50))).catch(() => {});
        } catch (e) {}
        if (!approved || !validEmail(email)) return json({ ok: true, granted: false }, 200, cors);
        // Dias pelo ID do produto quando KIWIFY_PID_* estão configurados;
        // senão cai no NOME do produto ("24h"/"24 h"/"passe" = 1 dia, resto = 30).
        // (Antes havia um early-return "no_product_map" aqui que impedia
        //  qualquer liberação quando os PIDs não estavam configurados —
        //  ou seja, quem pagava na Kiwify nunca virava VIP. Removido.)
        const pname = String((body.Product && (body.Product.product_name || body.Product.name)) || body.product_name || body.productName || "").toLowerCase();
        let days = 30;
        if (pid && env.KIWIFY_PID_24H && pid === env.KIWIFY_PID_24H) days = 1;
        else if (pid && env.KIWIFY_PID_30D && pid === env.KIWIFY_PID_30D) days = 30;
        else if (/24\s*h|passe|di[aá]ria|avulso/.test(pname)) days = 1;
        if (oid) {
          const seen = await env.PREMIUM_KV.get("kwo:" + oid).catch(() => null);
          if (seen) return json({ ok: true, granted: false, duplicate: true }, 200, cors);
        }
        const until = await grantPremium(env, email, "kiwify:" + (oid || Date.now()), days);
        if (oid) await env.PREMIUM_KV.put("kwo:" + oid, JSON.stringify({ email, at: Date.now() }), { expirationTtl: 90 * 86400 }).catch(() => {});
        return json({ ok: true, granted: true, premium_until_ms: until, plan: days === 1 ? "vip24h" : "vip30" }, 200, cors);
      }
      // Visor do log Kiwify (só com o segredo): ver o que chegou.
      if (url.pathname === "/api/kiwify/log" && req.method === "GET") {
        if (!env.KIWIFY_SECRET || url.searchParams.get("secret") !== env.KIWIFY_SECRET) {
          return json({ error: "forbidden" }, 403, cors);
        }
        return json({ items: (await env.PREMIUM_KV.get("klog", "json").catch(() => null)) || [] }, 200, cors);
      }

      // ---------- premium da conta Google (UID); e-mail antigo só como compatibilidade ----------
      if (url.pathname === "/api/premium" && req.method === "GET") {
        const fb = await firebaseUser(req, env);
        if (fb) {
          return json({
            premium_until_ms: await premiumUntilAccount(env, fb.uid, fb.email),
            account_email: fb.email,
            account_uid: fb.uid
          }, 200, cors);
        }
        const email = (url.searchParams.get("email") || "").trim().toLowerCase();
        if (!validEmail(email)) return json({ premium_until_ms: 0 }, 200, cors);
        return json({ premium_until_ms: await premiumUntil(env, email) }, 200, cors);
      }

      return json({ error: "rota desconhecida" }, 404, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502, cors);
    }
  },
};
