/* ReativaConquistas — Worker Cloudflare (API: AbacatePay + contas).
   A chave abc_* mora SÓ aqui (wrangler secret), NUNCA no site.
   Endpoints (chamados por site/pagamento.js e site/auth.js):
     POST /api/auth/register {email,name,password} -> {token,email,name}
     POST /api/auth/login    {email,password} -> {token,email,name}
     GET  /api/auth/me      (Bearer) -> {email,name,premium_until_ms}
     POST /api/auth/logout  (Bearer) -> {ok:true}
     POST /api/abacate/create   {email, name} -> {url, id} (checkout 30 dias;
                                se logado, o e-mail da conta vale)
     GET  /api/abacate/status?id=BILLING_ID -> {status, paid, email, premium_until_ms?}
     POST /api/abacate/webhook[?secret=...]   (chamado pelo AbacatePay)
     GET  /api/premium?email=X -> {premium_until_ms}
     GET  /api/config -> flags públicas
   Secrets (via API: nunca neste arquivo nem no git):
     ABACATEPAY_API_KEY, WEBHOOK_SECRET
   Vars (wrangler.toml): ABACATEPAY_PRODUCT_ID, PUBLIC_BASE_URL, ALLOWED_ORIGINS.
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
  if (allowed.includes("*") || (origin && allowed.includes(origin))) {
    return { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  }
  return {};
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim().toLowerCase().slice(0, 120));
const validPw = (p) => typeof p === "string" && p.length >= 8 && p.length <= 128;
const premKey = (email) => "prem:" + email.trim().toLowerCase();
const pendKey = (id) => "pend:" + id;
const acctKey = (email) => "acct:" + email.trim().toLowerCase();
const sessKey = (t) => "sess:" + t;
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

async function abacateCreate(env, email, name, origin) {
  const base = (origin || String(env.PUBLIC_BASE_URL || "")).replace(/\/+$/, "");
  const body = {
    items: [{ id: env.ABACATEPAY_PRODUCT_ID, quantity: 1 }],
    returnUrl: base + "/",
    completionUrl: base + "/sucesso.html",
    metadata: { email, name, plan: "premium30" },
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
  return { url: d.url, id: d.id };
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

async function grantPremium(env, email, billingId, days = 30) {
  email = email.trim().toLowerCase();
  const now = Date.now();
  const cur = await env.PREMIUM_KV.get(premKey(email), "json").catch(() => null);
  let until = now + days * 86400000;
  if (cur && cur.until > now) until = cur.until + days * 86400000;
  await env.PREMIUM_KV.put(premKey(email), JSON.stringify({ until, billing_id: billingId, granted_at: now }));
  return until;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      // ---------- flags públicas ----------
      if (url.pathname === "/api/config" && req.method === "GET") {
        return json({ abacate_configured: !!env.ABACATEPAY_API_KEY, product_configured: !!env.ABACATEPAY_PRODUCT_ID, premium_days: 30, accounts: true }, 200, cors);
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
        if (!env.ABACATEPAY_PRODUCT_ID) return json({ error: "Produto não configurado no servidor." }, 502, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
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
        const r = await abacateCreate(env, email, name, origin.startsWith("http") ? origin : "");
        await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({ email, at: Date.now() }), { expirationTtl: 86400 }).catch(() => {});
        return json(r, 200, cors);
      }

      // ---------- status ----------
      if (url.pathname === "/api/abacate/status" && req.method === "GET") {
        const id = (url.searchParams.get("id") || "").trim();
        if (!id) return json({ error: "Parâmetro 'id' obrigatório." }, 400, cors);
        const info = await abacateStatus(env, id);
        const out = { status: info.status, paid: info.paid, email: info.email };
        let email = info.email;
        if (!email) {
          const pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if (pend && pend.email) email = String(pend.email).toLowerCase();
        }
        if (info.paid && email) {
          out.premium_until_ms = await grantPremium(env, email, id);
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
            if (!email) {
              const pend = await env.PREMIUM_KV.get(pendKey(bid), "json").catch(() => null);
              if (pend && pend.email) email = String(pend.email).toLowerCase();
            }
            if (info.paid && email) await grantPremium(env, email, bid);
          } catch (e) { console.log("webhook erro: " + (e && e.message)); }
        }
        return json({ ok: true }, 200, cors);
      }

      // ---------- premium por e-mail ----------
      if (url.pathname === "/api/premium" && req.method === "GET") {
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
