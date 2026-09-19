/* ReativaConquistas — Worker Cloudflare do AbacatePay (código separado).
   A chave abc_* mora SÓ aqui (wrangler secret), NUNCA no site.
   Endpoints (chamados por site/pagamento.js):
     POST /api/abacate/create   {email, name} -> {url, id} (checkout 30 dias)
     GET  /api/abacate/status?id=BILLING_ID -> {status, paid, email, premium_until_ms?}
     POST /api/abacate/webhook[?secret=...]   (chamado pelo AbacatePay)
     GET  /api/premium?email=X -> {premium_until_ms}
     GET  /api/config -> flags públicas
   Secrets (wrangler secret put NOME):
     ABACATEPAY_API_KEY      (obrigatório, abc_dev_... ou produção)
   Vars (wrangler.toml):
     ABACATEPAY_PRODUCT_ID   (obrigatório p/ chaves v2: prod_... do dashboard)
     PUBLIC_BASE_URL         (ex.: https://seudominio.com.br)
     WEBHOOK_SECRET          (opcional, mas recomendado)
     ALLOWED_ORIGINS         (CSV; "*" = qualquer origem — só p/ teste)
   KV: PREMIUM_KV (pendentes + premium por e-mail).
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
const premKey = (email) => "prem:" + email.trim().toLowerCase();
const pendKey = (id) => "pend:" + id;

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
        return json({ abacate_configured: !!env.ABACATEPAY_API_KEY, product_configured: !!env.ABACATEPAY_PRODUCT_ID, premium_days: 30 }, 200, cors);
      }

      // ---------- criar checkout ----------
      if (url.pathname === "/api/abacate/create" && req.method === "POST") {
        if (!env.ABACATEPAY_API_KEY) return json({ error: "Pagamento não configurado no servidor." }, 502, cors);
        if (!env.ABACATEPAY_PRODUCT_ID) return json({ error: "Produto não configurado no servidor." }, 502, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const email = String(body.email || "").trim().toLowerCase();
        const name = String(body.name || "").trim().slice(0, 80);
        if (!validEmail(email)) return json({ error: "Informe um e-mail válido." }, 400, cors);
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
        const rec = await env.PREMIUM_KV.get(premKey(email), "json").catch(() => null);
        const until = rec && rec.until > Date.now() ? rec.until : 0;
        return json({ premium_until_ms: until }, 200, cors);
      }

      return json({ error: "rota desconhecida" }, 404, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502, cors);
    }
  },
};
