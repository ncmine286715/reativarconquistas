/* ReativaConquistas — Worker Cloudflare (API: Depix + AbacatePay + contas).
   NENHUM segredo neste arquivo: tudo via `wrangler secret put` (nunca no git/site).
   Planos: world1 (1 crédito de mundo = 599 centavos), vip7 (7 dias = 799 centavos), vip30 (30 dias = 2490 centavos) e creator (30 dias = 3990 centavos).
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
      ABACATEPAY_API_KEY, WEBHOOK_SECRET, KIWIFY_SECRET, KIWIFY_TOKEN
    Vars (wrangler.toml): ABACATEPAY_PRODUCT_ID, ABACATEPAY_PRODUCT_ID_24H,
      KIWIFY_PID_WORLD1, KIWIFY_PID_7D, KIWIFY_PID_30D, KIWIFY_PID_CREATOR,
      PUBLIC_BASE_URL, ALLOWED_ORIGINS,
      DEPIX_TEST_MODE ("1" = teste).
    KV: PREMIUM_KV (contas, sessões, pendentes, premium).
*/

const PAID = new Set(["PAID", "COMPLETED", "APPROVED", "ACTIVE", "PAYMENT_CONFIRMED", "CONFIRMED"]);
const TERMS_VERSION = "2026-09-20-v1.6";
const FREE_DAILY = 3;
const SECURITY_REWARD_DAYS = 9999;

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders(), ...cors },
  });
}

export function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const ok = origin && (allowed.includes(origin) ||
    allowed.some((a) => a.startsWith("*.") && origin.endsWith(a.slice(1))) || local);
  // file:// manda Origin "null"; não é uma origem confiável e não recebe CORS.
  if (origin && ok) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
    };
  }
  return {};
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com; frame-src https://*.firebaseapp.com https://accounts.google.com;",
  };
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
const PLAN_LIMITS = {
  world1: { maxMb: 150, batch: 1, kind: "credit" },
  vip7: { maxMb: 500, batch: 5, kind: "time" },
  vip30: { maxMb: Infinity, batch: 10, kind: "time" },
  creator: { maxMb: Infinity, batch: 20, kind: "time" },
};
const ANALYTICS_EVENTS = new Set(["page_view", "converter_view", "file_selected", "file_valid", "file_too_large", "world_analyzed", "operation_started", "operation_completed", "paywall_shown", "plan_viewed", "buy_clicked", "checkout_opened", "cpf_valid", "checkout_validation_failed", "pix_create_clicked", "pix_create_success", "pix_create_error", "pix_checkout_redirect", "payment_pending", "payment_paid", "webhook_received", "webhook_verified", "plan_granted", "payment_expired"]);
const PLAN_PRICES = { world1: 599, vip7: 799, vip30: 2490, creator: 3990 };
function analyticsDay(ms = Date.now()) { return new Date(ms).toISOString().slice(0, 10); }
function cleanDimension(value, max = 40) { return String(value || "").replace(/[^a-zA-Z0-9_:\-.]/g, "_").slice(0, max); }
function deviceType(ua) { return /mobile|android|iphone|ipad/i.test(ua || "") ? "mobile" : "desktop"; }
function browserType(ua) { ua = ua || ""; return /edg\//i.test(ua) ? "edge" : /firefox/i.test(ua) ? "firefox" : /chrome|crios/i.test(ua) ? "chrome" : /safari/i.test(ua) ? "safari" : "other"; }
async function metric(env, event, data = {}, req = null) {
  if (!ANALYTICS_EVENTS.has(event)) return;
  const day = analyticsDay(); const key = "analytics:" + day;
  const current = (await env.PREMIUM_KV.get(key, "json").catch(() => null)) || { events: {}, plans: {}, sources: {}, devices: {}, filters: {}, errors: {}, revenue_cents: 0 };
  current.events[event] = (+current.events[event] || 0) + 1;
  const plan = cleanDimension(data.plan, 20);
  const source = cleanDimension(data.source, 40);
  const device = req ? deviceType(req.headers.get("User-Agent")) : "";
  if (plan) { current.plans[plan] = current.plans[plan] || {}; current.plans[plan][event] = (+current.plans[plan][event] || 0) + 1; }
  if (source) { current.sources[source] = current.sources[source] || {}; current.sources[source][event] = (+current.sources[source][event] || 0) + 1; }
  if (device) { current.devices[device] = current.devices[device] || {}; current.devices[device][event] = (+current.devices[device][event] || 0) + 1; }
  const filterKeys = new Set([
    [plan || "*", "*", "*"].join("|"), ["*", device || "*", "*"].join("|"), ["*", "*", source || "*"].join("|"),
    [plan || "*", device || "*", "*"].join("|"), [plan || "*", "*", source || "*"].join("|"), ["*", device || "*", source || "*"].join("|"),
    [plan || "*", device || "*", source || "*"].join("|")
  ]);
  for (const filterKey of filterKeys) { current.filters[filterKey] = current.filters[filterKey] || {}; current.filters[filterKey][event] = (+current.filters[filterKey][event] || 0) + 1; }
  if (event === "payment_paid" && PLAN_PRICES[plan]) current.revenue_cents = (+current.revenue_cents || 0) + PLAN_PRICES[plan];
  if (event === "pix_create_error" || event === "checkout_validation_failed") { const ek = cleanDimension(data.error_type || data.reason || "unknown", 40); current.errors[ek] = (current.errors[ek] || 0) + 1; }
  await env.PREMIUM_KV.put(key, JSON.stringify(current), { expirationTtl: 400 * 86400 }).catch(() => {});
}

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

function quotaIdentity(req, fb) {
  if (fb && fb.uid) return "uid:" + fb.uid;
  return "ip:" + String(req.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80);
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
    await env.PREMIUM_KV.put(premUidKey(uid), JSON.stringify({ until, email, plan: (byEmail && byEmail.plan) || "vip30", migrated_at: Date.now() })).catch(() => {});
  }
  return until > Date.now() ? until : 0;
}

export function isSecurityResearcherReward(env, email) {
  const configured = String(env.SECURITY_REWARD_EMAIL || "").trim().toLowerCase();
  return !!configured && configured === String(email || "").trim().toLowerCase();
}

async function abacateCreate(env, email, name, uid, origin, plan) {
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
    metadata: { firebase_uid: uid || "", email, name, plan },
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
  if (plan === "vip24h") return "world1"; // legacy id now maps to the R$ 5,99 credit
  return ["world1", "vip7", "vip30", "creator"].includes(plan) ? plan : "vip30";
}
function depixAmount(plan) {
  plan = normalizeDepixPlan(plan);
  return { world1: 599, vip7: 799, vip30: 2490, creator: 3990 }[plan];
}
function depixPlanDays(plan) {
  plan = normalizeDepixPlan(plan);
  if (plan === "world1") return 0;
  return plan === "vip7" ? 7 : 30;
}
function depixPlanLabel(plan) {
  plan = normalizeDepixPlan(plan);
  return ({ world1: "Resolver 1 mundo", vip7: "Passe 7 dias", vip30: "Passe 30 dias", creator: "Criador" })[plan];
}

// Kiwify envia o produto no webhook. IDs configurados no Worker têm
// prioridade; os nomes abaixo existem para permitir ativação imediata sem
// confiar em um produto desconhecido como se fosse VIP30.
export function normalizeKiwifyPlan(body, env) {
  const product = body && (body.Product || body.product || {}) || {};
  const pid = String(product.product_id || product.id || body.product_id || body.productId || "").trim();
  const rawName = product.product_name || product.name || body.product_name || body.productName || "";
  const name = String(rawName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const ids = [
    [env.KIWIFY_PID_WORLD1 || env.KIWIFY_PID_24H, "world1"],
    [env.KIWIFY_PID_7D, "vip7"],
    [env.KIWIFY_PID_30D, "vip30"],
    [env.KIWIFY_PID_CREATOR, "creator"]
  ];
  for (const [configured, plan] of ids) if (configured && pid && pid === String(configured).trim()) return plan;
  if (["1 mundo", "resolver 1 mundo"].includes(name)) return "world1";
  if (["passe 7 dias", "7 dias"].includes(name)) return "vip7";
  if (["vip 30 dias", "passe 30 dias", "30 dias"].includes(name)) return "vip30";
  if (name === "criador") return "creator";
  return "";
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
async function depixCreate(env, email, name, uid, plan, doc, payerEmail, req) {
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
    metadata: {
      firebase_uid: uid || "",
      email: email,
      payer_email: String(payerEmail || "").trim().toLowerCase(),
      name: name || "",
      plan: plan
    }
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

async function grantPremium(env, email, billingId, days, uid = "", plan = "") {
  days = [1, 7, 30].includes(+days) ? +days : 30;
  email = email.trim().toLowerCase();
  uid = String(uid || "").trim().slice(0, 160);
  billingId = String(billingId || "").trim().slice(0, 180);
  const now = Date.now();

  // Polling e webhooks podem repetir a MESMA confirmação. Não some o plano
  // novamente quando o ID da cobrança/pedido já foi processado.
  if (billingId) {
    const previous = await env.PREMIUM_KV.get(grantKey(billingId), "json").catch(() => null);
    // Um ID de cobrança só pode conceder benefício uma vez, mesmo se o
    // provedor repetir o webhook ou retornar metadata diferente.
    if (previous && (+previous.until > 0 || +previous.world_credits > 0)) {
      return +previous.until || 0;
    }
  }

  const curEmail = await env.PREMIUM_KV.get(premKey(email), "json").catch(() => null);
  const curUid = uid ? await env.PREMIUM_KV.get(premUidKey(uid), "json").catch(() => null) : null;
  const baseUntil = Math.max(now, (curEmail && +curEmail.until) || 0, (curUid && +curUid.until) || 0);
  const until = baseUntil + days * 86400000;

  const record = { until, email, uid, plan: plan || (days === 7 ? "vip7" : (days === 30 ? "vip30" : "vip24h")), billing_id: billingId, granted_at: now };
  await env.PREMIUM_KV.put(premKey(email), JSON.stringify(record));
  if (uid) await env.PREMIUM_KV.put(premUidKey(uid), JSON.stringify(record));

  if (billingId) {
    await env.PREMIUM_KV.put(
      grantKey(billingId),
      JSON.stringify({ email, uid, plan: record.plan, until, days, granted_at: now }),
      { expirationTtl: 400 * 86400 }
    ).catch(() => {});
  }
  return until;
}

async function entitlementStub(env, uid, email) {
  if (!env.ENTITLEMENTS) throw new Error("ENTITLEMENTS não configurado no Worker.");
  const name = String(uid || email || "").trim().slice(0, 160);
  return env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName(name));
}

// Compras Kiwify antigas podem chegar antes de existir um UID Firebase e,
// nesse caso, o crédito fica inicialmente indexado pelo e-mail. Ao consultar
// a conta, aceitamos o mesmo e-mail como identidade legada; compras novas
// autenticadas continuam usando o UID.
async function worldCreditState(env, fb) {
  if (!env.ENTITLEMENTS) return { stub: null, worldCredits: 0 };
  const uidStub = await entitlementStub(env, fb.uid, fb.email);
  const uidRes = await uidStub.fetch("https://entitlements/state");
  const uidCredits = uidRes.ok ? +((await uidRes.json()).world_credits || 0) : 0;
  if (uidCredits > 0 || !fb.email || fb.email === fb.uid) return { stub: uidStub, worldCredits: uidCredits };
  const emailStub = await entitlementStub(env, "", fb.email);
  const emailRes = await emailStub.fetch("https://entitlements/state");
  const emailCredits = emailRes.ok ? +((await emailRes.json()).world_credits || 0) : 0;
  return emailCredits > 0 ? { stub: emailStub, worldCredits: emailCredits } : { stub: uidStub, worldCredits: 0 };
}

async function grantPurchase(env, email, billingId, plan, uid = "") {
  plan = normalizeDepixPlan(plan);
  if (plan === "world1") {
    const stub = await entitlementStub(env, uid, email);
    const r = await stub.fetch("https://entitlements/grant", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, billing_id: billingId, email, uid })
    });
    if (!r.ok) throw new Error("Não consegui registrar o crédito de mundo.");
    const out = await r.json();
    return { premium_until_ms: 0, world_credits: +out.world_credits || 0 };
  }
  const days = plan === "vip24h" ? 1 : (plan === "vip7" ? 7 : 30);
  return { premium_until_ms: await grantPremium(env, email, billingId, days, uid, plan), world_credits: 0 };
}

async function accountEntitlements(env, fb) {
  const reward = isSecurityResearcherReward(env, fb.email);
  const rewardUntil = reward ? Date.now() + SECURITY_REWARD_DAYS * 86400000 : 0;
  const until = Math.max(await premiumUntilAccount(env, fb.uid, fb.email), rewardUntil);
  const creditState = await worldCreditState(env, fb);
  const worldCredits = creditState.worldCredits;
  const recUid = await env.PREMIUM_KV.get(premUidKey(fb.uid), "json").catch(() => null);
  const recEmail = await env.PREMIUM_KV.get(premKey(fb.email), "json").catch(() => null);
  const rec = recUid || recEmail;
  const plan = reward ? "creator" : (rec && rec.plan && PLAN_LIMITS[rec.plan] ? rec.plan : (until > Date.now() ? "vip30" : (worldCredits > 0 ? "world1" : "")));
  return { premium_until_ms: until, world_credits: worldCredits, plan };
}

export function checkEntitlement(ent, worlds, sizeBytes, now = Date.now(), features = {}) {
  worlds = Math.max(1, Math.min(100, Number(worlds) || 1));
  sizeBytes = Math.max(0, Number(sizeBytes) || 0);
  const mode = String(features.mode || "keep").toLowerCase();
  const hardcore = features.hardcore === true;
  const advancedRules = features.advanced_rules === true;
  const advancedTools = features.advanced_tools === true;
  const removePacks = features.remove_behavior_packs === true;
  const addPacks = Math.max(0, Math.min(1000, Number(features.add_packs) || 0));
  const rename = features.rename === true;
  const icon = features.icon === true;
  // Derive the paid requirement on the server. A client-provided premium
  // flag is intentionally ignored.
  const hasFeatureRequest = Object.keys(features).length > 0;
  const premiumFeature = !hasFeatureRequest || mode !== "keep" || hardcore || advancedRules || advancedTools || removePacks ||
    addPacks > 1 || rename || icon || worlds > 1 || sizeBytes > 10 * 1024 * 1024;
  let plan = ent && ent.plan || "";
  const activeTimePlan = (+((ent && ent.premium_until_ms) || 0) > now) && plan !== "world1";
  if (!activeTimePlan && +(ent && ent.world_credits || 0) > 0 && worlds === 1 && sizeBytes <= PLAN_LIMITS.world1.maxMb * 1024 * 1024) plan = "world1";
  if (!premiumFeature) return { allowed: true, plan: "free", max_batch: 1, max_mb: 10 };
  const lim = PLAN_LIMITS[plan];
  if (!lim || (!activeTimePlan && plan !== "world1")) return { allowed: false, code: "NO_ENTITLEMENT" };
  if (plan === "world1" && +(ent && ent.world_credits || 0) < 1) return { allowed: false, code: "WORLD_CREDIT_EXHAUSTED" };
  if (worlds > lim.batch) return { allowed: false, code: "BATCH_LIMIT", plan, max_batch: lim.batch };
  if (isFinite(lim.maxMb) && sizeBytes > lim.maxMb * 1024 * 1024) return { allowed: false, code: "SIZE_LIMIT", plan, max_mb: lim.maxMb };
  return { allowed: true, plan, max_batch: lim.batch, max_mb: isFinite(lim.maxMb) ? lim.maxMb : null };
}

// Dias de VIP a partir do plano guardado no pendente (padrão: 30).
function planDays(pend) {
  if (pend && pend.plan === "vip24h") return 1;
  if (pend && pend.plan === "vip7") return 7;
  if (pend && pend.plan === "world1") return 0;
  return 30;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") {
      if (!req.headers.get("Origin") || !cors["Access-Control-Allow-Origin"]) {
        return withSecurityHeaders(new Response(null, { status: 403, headers: securityHeaders() }));
      }
      return withSecurityHeaders(new Response(null, { status: 204, headers: { ...securityHeaders(), ...cors } }));
    }

    // O mesmo Worker tambem pode servir o frontend quando o dominio aponta
    // diretamente para ele. Rotas /api/* continuam sendo tratadas abaixo.
    if (!url.pathname.startsWith("/api/") && env.ASSETS) {
      return withSecurityHeaders(await env.ASSETS.fetch(req));
    }

    try {
      // ---------- flags públicas ----------
      if (url.pathname === "/api/config" && req.method === "GET") {
        return json({ abacate_configured: !!env.ABACATEPAY_API_KEY, product_configured: !!env.ABACATEPAY_PRODUCT_ID, product24h_configured: !!env.ABACATEPAY_PRODUCT_ID_24H, premium_days: 30, accounts: true, firebase_auth: !!env.FIREBASE_WEB_API_KEY, depix_configured: !!env.DEPIX_API_KEY, depix_test_mode: String(env.DEPIX_TEST_MODE || "") === "1" || String(env.DEPIX_API_KEY || "").startsWith("sk_test_"), terms_version: TERMS_VERSION, world1_cents: 599, pass7_cents: 799, premium30_cents: 2490, creator_cents: 3990 }, 200, cors);
      }

      // The browser may display quota locally, but it cannot be the authority
      // for the free-operation count. This endpoint is a defense-in-depth
      // gate for the official UI; truly unforgeable billing still requires
      // paid processing to happen on a server.
      if (url.pathname === "/api/free-quota" && req.method === "POST") {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-free-quota:" + ip, 120, 86400))) return json({ error: "Muitas consultas de quota." }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const fb = await firebaseUser(req, env).catch(() => null);
        const day = new Date().toISOString().slice(0, 10);
        const identity = quotaIdentity(req, fb);
        if (env.ENTITLEMENTS) {
          const stub = env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName("free:" + identity));
          const result = await stub.fetch("https://entitlements/free-quota", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ day, consume: body.consume === true })
          });
          return json(await result.json(), result.status, cors);
        }
        const key = "freequota:" + day + ":" + encodeURIComponent(identity);
        let used = parseInt((await env.PREMIUM_KV.get(key).catch(() => null)) || "0", 10);
        if (!Number.isFinite(used) || used < 0) used = 0;
        if (body.consume === true) {
          if (used >= FREE_DAILY) return json({ allowed: false, code: "QUOTA_EXCEEDED", used, remaining: 0 }, 402, cors);
          used += 1;
          await env.PREMIUM_KV.put(key, String(used), { expirationTtl: 2 * 86400 });
        }
        return json({ allowed: used < FREE_DAILY, used, remaining: Math.max(0, FREE_DAILY - used) }, used >= FREE_DAILY ? 402 : 200, cors);
      }

      // ---------- Depix: criar checkout Pix ----------
      if (url.pathname === "/api/depix/create" && req.method === "POST") {
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const plan = normalizeDepixPlan(body.plan);
        const source = cleanDimension(body.source, 40);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com sua conta Google para continuar." }, 401, cors);
        const email = fb.email;
        const name = fb.name;
        const uid = fb.uid;
        const doc = cleanDoc(body.payer_tax_number || body.doc || body.cpf);
        const payerEmail = String(body.payer_email || "").trim().toLowerCase().slice(0, 120);
        if (!validDocServer(doc)) return json({ error: "Informe um CPF/CNPJ válido p/ gerar o Pix." }, 400, cors);
        if (!validEmail(payerEmail)) return json({ error: "Preencha um e-mail válido para o Pix." }, 400, cors);
        if (body.terms_accepted !== true) {
          return json({ error: "Você precisa aceitar os Termos de Uso e a Política de Reembolso antes de pagar." }, 400, cors);
        }
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        // Evita bloqueio exagerado: por conta + IP, janela curta e chave versionada.
        // O frontend não repete automaticamente uma cobrança que falhou.
        if (!(await rlTake(env, "rl-depix-v2:" + uid + ":" + ip, 12, 900))) {
          return json({ error: "Muitas tentativas em poucos minutos. Aguarde 15 minutos e tente novamente." }, 429, cors);
        }
        try {
          const r = await depixCreate(env, email, name, uid, plan, doc, payerEmail, req);
          await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({
            uid, email, at: Date.now(), plan, source, via: "depix",
            terms_version: TERMS_VERSION, client_terms_version: String(body.terms_version || "").slice(0, 40), terms_accepted_at: Date.now()
          }), { expirationTtl: 86400 }).catch(() => {});
          await metric(env, "payment_pending", { plan, source }, req);
          await metric(env, "pix_create_success", { plan, source }, req);
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
          const fb = await firebaseUser(req, env);
          if (!fb) return json({ error: "Entre novamente com a mesma conta Google usada na compra." }, 401, cors);
          const statusIp = req.headers.get("CF-Connecting-IP") || "unknown";
          if (!(await rlTake(env, "rl-depix-status:" + fb.uid + ":" + statusIp, 60, 900))) {
            return json({ error: "Muitas consultas de pagamento. Aguarde alguns minutos." }, 429, cors);
          }
          const info = await depixStatus(env, id);
          const out = { status: info.status, paid: info.paid, email: info.email, plan: info.plan };
          let email = info.email;
          let uid = info.uid || "";
          let pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
          if (pend && pend.uid && !uid) uid = String(pend.uid);
          if ((pend && pend.uid && String(pend.uid) !== fb.uid) || (email && email !== fb.email)) {
            return json({ error: "Esta cobrança pertence a outra conta Google." }, 403, cors);
          }
          const plan = normalizeDepixPlan((pend && pend.plan) || info.plan || "vip30");
          out.plan = plan;
          if (email) out.email = email;
          if (info.paid && email) {
            const grant = await grantPurchase(env, email, id, plan, uid);
            await metric(env, "payment_paid", { plan, source: pend && pend.source }, req);
            await metric(env, "plan_granted", { plan, source: pend && pend.source }, req);
            out.premium_until_ms = grant.premium_until_ms;
            out.world_credits = grant.world_credits;
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
        await metric(env, "webhook_received", {}, req);
        const sig = req.headers.get("X-DePix-Signature") || req.headers.get("x-depix-signature") || "";
        if (!env.DEPIX_WEBHOOK_SECRET) return json({ error: "webhook não configurado" }, 503, cors);
        const ok = await verifyDepixSignature(raw, sig, env.DEPIX_WEBHOOK_SECRET);
        if (!ok) return json({ error: "forbidden" }, 403, cors);
        await metric(env, "webhook_verified", {}, req);
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
            if (info.paid && email) { await grantPurchase(env, email, bid, plan, uid); await metric(env, "payment_paid", { plan, source: pend && pend.source }, req); await metric(env, "plan_granted", { plan, source: pend && pend.source }, req); }
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

      // Funil comercial agregado: nunca recebe CPF/CNPJ, e-mail, conteúdo de mundo ou tokens.
      if (url.pathname === "/api/telemetry" && req.method === "POST") {
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-tel:" + ip, 120, 3600))) return json({ ok: false }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const event = String(body.event || "").trim().slice(0, 40);
        if (!ANALYTICS_EVENTS.has(event)) return json({ ok: false }, 400, cors);
        await metric(env, event, { plan: body.plan, source: body.source, reason: body.reason, error_type: body.error_type }, req);
        return json({ ok: true }, 200, cors);
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
        const requestedPlan = normalizeDepixPlan(body.plan);
        if (!["world1", "vip30"].includes(requestedPlan)) return json({ error: "Este provedor reserva só suporta Resolver 1 mundo e Passe 30 dias; use o Pix principal para este plano." }, 400, cors);
        const providerPlan = requestedPlan === "world1" ? "vip24h" : "vip30";
        if (providerPlan === "vip24h" && !env.ABACATEPAY_PRODUCT_ID_24H) return json({ error: "Produto Resolver 1 mundo não configurado no servidor." }, 502, cors);
        if (providerPlan === "vip30" && !env.ABACATEPAY_PRODUCT_ID) return json({ error: "Produto não configurado no servidor." }, 502, cors);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com sua conta Google para continuar." }, 401, cors);
        if (body.terms_accepted !== true) {
          return json({ error: "Você precisa aceitar os Termos de Uso e a Política de Reembolso antes de pagar." }, 400, cors);
        }
        const email = fb.email;
        const name = fb.name;
        const uid = fb.uid;
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-alt-v2:" + uid + ":" + ip, 12, 900))) {
          return json({ error: "Muitas tentativas em poucos minutos. Aguarde 15 minutos e tente novamente." }, 429, cors);
        }
        const origin = req.headers.get("Origin") || "";
        const r = await abacateCreate(env, email, name, uid, origin.startsWith("http") ? origin : "", providerPlan);
        await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({
          uid, email, at: Date.now(), plan: requestedPlan, via: "abacate",
          terms_version: TERMS_VERSION, client_terms_version: String(body.terms_version || "").slice(0, 40), terms_accepted_at: Date.now()
        }), { expirationTtl: 86400 }).catch(() => {});
        return json({ ...r, plan: requestedPlan }, 200, cors);
      }

      // ---------- status ----------
      if (url.pathname === "/api/abacate/status" && req.method === "GET") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!id) return json({ error: "Parâmetro 'id' obrigatório." }, 400, cors);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com a mesma conta Google usada na compra." }, 401, cors);
        const statusIp = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-abacate-status:" + fb.uid + ":" + statusIp, 60, 900))) {
          return json({ error: "Muitas consultas de pagamento. Aguarde alguns minutos." }, 429, cors);
        }
        const info = await abacateStatus(env, id);
        const out = { status: info.status, paid: info.paid, email: info.email };
        let email = info.email;
        let pend = null;
        if (!email || info.paid) {
          pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
        }
        if (info.paid && email) {
          pend = pend || await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if ((pend && pend.uid && String(pend.uid) !== fb.uid) || (email && email !== fb.email)) {
            return json({ error: "Esta cobrança pertence a outra conta Google." }, 403, cors);
          }
          const days = planDays(pend);
          const uid = pend && pend.uid ? String(pend.uid) : "";
          out.plan = (pend && pend.plan) || (days === 1 ? "vip24h" : (days === 7 ? "vip7" : "vip30"));
          const grant = await grantPurchase(env, email, id, (pend && pend.plan) || (days === 7 ? "vip7" : "vip30"), uid);
          out.premium_until_ms = grant.premium_until_ms;
          out.world_credits = grant.world_credits;
          await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
        }
        return json(out, 200, cors);
      }

      // ---------- webhook (AbacatePay -> Worker; nunca confia só no POST) ----------
      if (url.pathname === "/api/abacate/webhook" && req.method === "POST") {
        if (!env.WEBHOOK_SECRET || url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
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
            if (info.paid && email) await grantPurchase(env, email, bid, (pend && pend.plan) || "vip30", pend && pend.uid ? String(pend.uid) : "");
          } catch (e) { console.log("webhook erro: " + (e && e.message)); }
        }
        return json({ ok: true }, 200, cors);
      }

      // ---------- Kiwify: compra aprovada -> libera VIP ----------      // Na Kiwify: produto -> Webhooks -> Adicionar: evento "Compra aprovada",
      // URL: https://<worker>/api/kiwify/webhook?secret=VALOR (VALOR = secret
      // KIWIFY_SECRET). Dias pelo produto: KIWIFY_PID_24H = 1, KIWIFY_PID_30D = 30.
      if (url.pathname === "/api/kiwify/webhook" && req.method === "POST") {
        const querySecretOk = !!env.KIWIFY_SECRET && url.searchParams.get("secret") === env.KIWIFY_SECRET;
        const headerToken = req.headers.get("x-kiwify-token") || req.headers.get("x-webhook-token") || req.headers.get("x-token") || "";
        const headerTokenOk = !!env.KIWIFY_TOKEN && headerToken === env.KIWIFY_TOKEN;
        if (!querySecretOk && !headerTokenOk) {
          return json({ error: "forbidden" }, 403, cors);
        }
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const evt = String(body.webhook_event_type || body.event || body.type || "");
        const status = String(body.order_status || body.status || body.orderStatus || "").toLowerCase();
        const approvedStatus = ["paid", "approved", "completed", "active", "payment_confirmed", "confirmed"].includes(status);
        const approvedEvent = /^(order_approved|purchase_approved|compra_aprovada)$/.test(evt.toLowerCase());
        const approved = approvedEvent || (!evt && approvedStatus);
        const email = String((body.Customer && body.Customer.email) || (body.customer && body.customer.email) || (body.Client && body.Client.email) || body.customer_email || body.customerEmail || body.email || "").trim().toLowerCase();
        const pid = String((body.Product && (body.Product.product_id || body.Product.id)) || body.product_id || body.productId || "");
        const oid = String(body.order_id || body.orderId || body.id || body.code || "");
        const plan = normalizeKiwifyPlan(body, env);
        // log cru (últimos 50) p/ depurar sem adivinhar formato
        try {
          const lst = (await env.PREMIUM_KV.get("klog", "json").catch(() => null)) || [];
          lst.unshift({ at: Date.now(), evt, status, email, pid, oid, plan });
          await env.PREMIUM_KV.put("klog", JSON.stringify(lst.slice(0, 50))).catch(() => {});
        } catch (e) {}
        if (!approved || !validEmail(email) || !plan || !oid) {
          return json({ ok: true, granted: false, reason: !plan ? "unmapped_product" : (!oid ? "missing_order_id" : "not_approved") }, 200, cors);
        }
        // Produto desconhecido nunca recebe um plano por fallback.
        if (oid) {
          const seen = await env.PREMIUM_KV.get("kwo:" + oid).catch(() => null);
          if (seen) return json({ ok: true, granted: false, duplicate: true }, 200, cors);
        }
        const grant = await grantPurchase(env, email, "kiwify:" + oid, plan);
        await env.PREMIUM_KV.put("kwo:" + oid, JSON.stringify({ email, plan, at: Date.now() }), { expirationTtl: 90 * 86400 }).catch(() => {});
        return json({ ok: true, granted: true, premium_until_ms: grant.premium_until_ms, world_credits: grant.world_credits, plan }, 200, cors);
      }
      // Visor do log Kiwify (só com o segredo): ver o que chegou.
      if (url.pathname === "/api/kiwify/log" && req.method === "GET") {
        if (!env.KIWIFY_SECRET || url.searchParams.get("secret") !== env.KIWIFY_SECRET) {
          return json({ error: "forbidden" }, 403, cors);
        }
        return json({ items: (await env.PREMIUM_KV.get("klog", "json").catch(() => null)) || [] }, 200, cors);
      }

      // ---------- premium da conta Google (UID); e-mail antigo só como compatibilidade ----------
      if (url.pathname === "/api/entitlements" && req.method === "GET") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        return json(await accountEntitlements(env, fb), 200, cors);
      }

      if (url.pathname === "/api/entitlements/check" && req.method === "POST") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const ent = await accountEntitlements(env, fb);
        const features = body.features && typeof body.features === "object" ? body.features : {};
        const decision = checkEntitlement(ent, body.worlds, body.size_bytes, Date.now(), features);
        return json({ ...decision, world_credits: ent.world_credits, premium_until_ms: ent.premium_until_ms }, decision.allowed ? 200 : 403, cors);
      }

      if (url.pathname === "/api/entitlements/consume" && req.method === "POST") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const operationId = String(body.operation_id || "").trim().slice(0, 120);
        const worlds = Math.max(1, Math.min(1, Number(body.worlds) || 1));
        if (!operationId) return json({ error: "operation_id obrigatório." }, 400, cors);
        const ent = await accountEntitlements(env, fb);
        if (ent.plan !== "world1" && ent.world_credits <= 0) return json({ consumed: true, plan: ent.plan || "time" }, 200, cors);
        const creditState = await worldCreditState(env, fb);
        const stub = creditState.stub || await entitlementStub(env, fb.uid, fb.email);
        const r = await stub.fetch("https://entitlements/consume", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation_id: operationId, worlds })
        });
        const out = await r.json();
        return json(out, r.status, cors);
      }

      if (url.pathname === "/api/premium" && req.method === "GET") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        const ent = await accountEntitlements(env, fb);
        return json({ ...ent, account_email: fb.email, account_uid: fb.uid }, 200, cors);
      }

      return json({ error: "rota desconhecida" }, 404, cors);
    } catch (e) {
      console.error("request failed", e && e.message ? e.message : e);
      return json({ error: "Erro interno ao processar a solicitaÃ§Ã£o." }, 500, cors);
    }
  },
};

// Serializable, per-account state for the one-world credit. Cloudflare KV is
// eventually consistent and cannot safely decrement a single credit under
// two simultaneous devices; this Durable Object makes consume() atomic and
// idempotent by operation_id.
export class EntitlementDO {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url);
    const data = (await this.state.storage.get("entitlement")) || { world_credits: 0, purchases: {}, consumed: {} };
    if (url.pathname === "/state") return json({ world_credits: data.world_credits || 0 });
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    if (url.pathname === "/free-quota") {
      const day = String(body.day || "").replace(/[^0-9-]/g, "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Dia invÃ¡lido." }, 400);
      const key = "freequota:" + day;
      let used = +(await this.state.storage.get(key)) || 0;
      if (body.consume === true) {
        if (used >= FREE_DAILY) return json({ allowed: false, code: "QUOTA_EXCEEDED", used, remaining: 0 }, 402);
        used += 1;
        await this.state.storage.put(key, used);
      }
      return json({ allowed: used < FREE_DAILY, used, remaining: Math.max(0, FREE_DAILY - used) }, used >= FREE_DAILY ? 402 : 200);
    }
    if (url.pathname === "/grant") {
      const bid = String(body.billing_id || "").slice(0, 180);
      if (bid && data.purchases[bid]) return json({ world_credits: data.world_credits || 0 });
      if (body.plan === "world1") data.world_credits = (data.world_credits || 0) + 1;
      if (bid) data.purchases[bid] = { plan: body.plan, at: Date.now() };
      await this.state.storage.put("entitlement", data);
      return json({ world_credits: data.world_credits || 0 });
    }
    if (url.pathname === "/consume") {
      const op = String(body.operation_id || "").slice(0, 120);
      if (!op) return json({ error: "operation_id obrigatório." }, 400);
      if (data.consumed[op]) return json({ consumed: true, duplicate: true, world_credits: data.world_credits || 0 });
      if ((data.world_credits || 0) < 1) return json({ error: "Crédito de mundo já utilizado.", code: "WORLD_CREDIT_EXHAUSTED" }, 409);
      data.world_credits -= 1;
      data.consumed[op] = { worlds: 1, at: Date.now() };
      await this.state.storage.put("entitlement", data);
      return json({ consumed: true, world_credits: data.world_credits });
    }
    return json({ error: "rota desconhecida" }, 404);
  }
}
