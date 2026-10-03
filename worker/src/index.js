/* ReativaConquistas — Worker Cloudflare (API: Depix + AbacatePay + contas).
   NENHUM segredo neste arquivo: tudo via `wrangler secret put` (nunca no git/site).
   Planos: world1 (1 crédito = 599 centavos), ouro (3 = 1499), diamante (5 = 2290), vip7, vip30 e creator.
   Fluxo Depix (ativo): site/pagamento.js -> POST /api/depix/create -> api.depixapp.com
   -> payment_url -> volta em sucesso.html?checkout_id=chk_... -> GET /api/depix/status
   -> webhook POST /api/depix/webhook (HMAC X-DePix-Signature com DEPIX_WEBHOOK_SECRET).
   Endpoints (chamados por site/pagamento.js e site/auth.js):
      POST /api/depix/create   {name, plan, payer_tax_number} -> {url, id, plan}
                               (plano sempre explícito; vínculo ao Firebase UID autenticado)
      GET  /api/depix/status?id=chk_... -> {status, paid, email, plan?, premium_until_ms?}
      POST /api/depix/webhook   (chamado pelo Depix App; verifica HMAC)
      POST /api/depix/simulate {id} (TESTE local: sk_test_ marca como pago)
      POST /api/abacate/create   {email, name, plan?} -> {url, id, plan} (reserva)
      GET  /api/abacate/status?id=BILLING_ID -> {status, paid, email, plan?, premium_until_ms?}
      POST /api/abacate/webhook[?secret=...]   (chamado pelo AbacatePay)
      GET  /api/premium (Bearer Firebase) -> compatibility alias for /api/entitlements
      GET  /api/config -> flags públicas
      POST /api/kiwify/webhook[?secret=...] (reserva — backup em site/backup-kiwify-*)
    Secrets (via API: nunca neste arquivo nem no git):
      DEPIX_API_KEY (sk_test_ p/ teste, sk_live_ p/ produção),
      DEPIX_WEBHOOK_SECRET (whsec_... do painel Depix > My Business),
      ABACATEPAY_API_KEY, WEBHOOK_SECRET, KIWIFY_SECRET, KIWIFY_TOKEN
    Vars (wrangler.toml): ABACATEPAY_PRODUCT_ID, ABACATEPAY_PRODUCT_ID_WORLD1,
      ABACATEPAY_PRODUCT_ID_24H (legado), KIWIFY_PID_WORLD1, KIWIFY_PID_7D,
      KIWIFY_PID_24H (legado), KIWIFY_PID_30D, KIWIFY_PID_CREATOR,
      PUBLIC_BASE_URL, ALLOWED_ORIGINS,
      DEPIX_TEST_MODE ("1" = teste).
    KV: PREMIUM_KV (pendências, recibos, auditoria e migração legada por e-mail).
*/

const PAID = new Set(["PAID", "COMPLETED", "APPROVED", "PAYMENT_CONFIRMED"]);
const TERMS_VERSION = "2026-10-03-v4";
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
    "X-Frame-Options": "SAMEORIGIN",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com;",
  };
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "").trim().toLowerCase().slice(0, 120));
const premKey = (email) => "prem:" + email.trim().toLowerCase();
const premUidKey = (uid) => "premuid:" + String(uid || "").trim().slice(0, 160);
const pendKey = (id) => "pend:" + id;
const grantKey = (id) => "grant:" + String(id || "").trim().slice(0, 180);
// A única fonte de permissões, limites e preços. Os clientes recebem somente
// a projeção pública deste catálogo; cada autorização usa estes mesmos dados.
export const PLAN_LIMITS = Object.freeze({
essential7v4: Object.freeze({"label":"Essencial","duration_days":7,"price_cents":790,"max_file_mb":75,"max_file_bytes":78643200,"max_batch":1,"kind":"time","daily_operations":3,"fit":"Para resolver edições pontuais no seu mundo","featured":false,"allowed_tools":["convert","world_map","world_analysis","chunks_restore","player_basic","builder"],"capabilities":{"premium_features":true,"world_studio":false}}),
pro7v4: Object.freeze({"label":"Pro","duration_days":7,"price_cents":1490,"max_file_mb":300,"max_file_bytes":314572800,"max_batch":3,"kind":"time","daily_operations":12,"fit":"Para editar vários mundos durante a semana","featured":false,"allowed_tools":["convert","world_map","world_analysis","chunks_restore","player_basic","builder"],"capabilities":{"premium_features":true,"world_studio":false}}),
creator30v4: Object.freeze({"label":"Criador","duration_days":30,"price_cents":2990,"max_file_mb":750,"max_file_bytes":786432000,"max_batch":6,"kind":"time","daily_operations":30,"fit":"Para editar, pintar e exportar mundos durante o mês","featured":true,"allowed_tools":["convert","world_map","world_analysis","chunks_restore","player_basic","builder","world_paint"],"capabilities":{"premium_features":true,"world_studio":true}}),
studio30v4: Object.freeze({"label":"Studio","duration_days":30,"price_cents":4990,"max_file_mb":1536,"max_file_bytes":1610612736,"max_batch":12,"kind":"time","daily_operations":80,"fit":"Para quem trabalha com muitos mundos e arquivos grandes","featured":false,"allowed_tools":["convert","world_map","world_analysis","chunks_restore","player_basic","builder","world_paint"],"capabilities":{"premium_features":true,"world_studio":true}}),
  free: Object.freeze({
    label: "Plano gratuito", duration_days: 0, price_cents: 0,
    max_file_mb: 10, max_file_bytes: 10 * 1024 * 1024, max_batch: 2,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: {
      restore_achievements: true, change_mode: false, hardcore: false,
      advanced_rules: true, change_difficulty: true, world_icon: true,
      rename: true, remove_behavior_packs: true, add_behavior_packs: 2,
      chunks_restore: { max_chunks: 8, daily_operations: 1 },
      player: { basic_inventory: true, armor: false, ender_chest: false, xp: false, max_enchantment: "vanilla", daily_operations: 2 },
      builder: { daily_operations: 3 },
      convert: { daily_operations: 3 }
    }
  }),
  world1: Object.freeze({
    label: "Créditos de mundo", catalog_label: "1 mundo", duration_days: 0, price_cents: 599, credit_count: 1,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  worlds2v1: Object.freeze({
    label: "2 mundos", duration_days: 0, price_cents: 1190, credit_count: 2,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  ouro: Object.freeze({
    label: "Créditos de mundo", catalog_label: "Ouro · 3 créditos", duration_days: 0, price_cents: 1499, credit_count: 3,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  diamante: Object.freeze({
    label: "Créditos de mundo", catalog_label: "Diamante · 5 créditos", duration_days: 0, price_cents: 2290, credit_count: 5,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "world_credit", project_window_days: 30,
    allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true, repeated_operations_same_world: true }
  }),
  vip24h: Object.freeze({
    label: "Passe 24 horas (legado)", duration_days: 1, price_cents: 599,
    max_file_mb: 150, max_file_bytes: 150 * 1024 * 1024, max_batch: 1,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder"],
    capabilities: { premium_features: true }
  }),
  vip7: Object.freeze({
    label: "Passe 7 dias", duration_days: 7, price_cents: 799,
    max_file_mb: 500, max_file_bytes: 500 * 1024 * 1024, max_batch: 5,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder", "world_paint"],
    capabilities: { premium_features: true }
  }),
  vip30: Object.freeze({
    label: "Passe 30 dias", duration_days: 30, price_cents: 2490,
    max_file_mb: null, max_file_bytes: null, max_batch: 10,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder", "world_paint"],
    capabilities: { premium_features: true }
  }),
  creator: Object.freeze({
    label: "Criador", duration_days: 30, price_cents: 3990,
    max_file_mb: null, max_file_bytes: null, max_batch: 20,
    kind: "time", allowed_tools: ["convert", "world_map", "world_analysis", "chunks_restore", "player_basic", "builder", "world_paint"],
    capabilities: { premium_features: true }
  })
});
// New SKU: existing receipts keep their original price and credit count.
const WORLD_PROJECT_WINDOW_MS = PLAN_LIMITS.world1.project_window_days * 86400000;
const PUBLIC_PLAN_CATALOG = Object.freeze(Object.fromEntries(Object.entries(PLAN_LIMITS).map(([id, plan]) => [id, {
  id, daily_operations: plan.daily_operations || 0, fit: plan.fit || "", featured: plan.featured === true, label: plan.catalog_label || plan.label, duration_days: plan.duration_days, price_cents: plan.price_cents,
  kind: plan.kind || "time", credit_count: plan.credit_count || 0,
  max_file_mb: plan.max_file_mb, max_file_bytes: plan.max_file_bytes, max_batch: plan.max_batch,
  allowed_tools: plan.allowed_tools, capabilities: plan.capabilities,
  project_window_days: plan.project_window_days || 0
}]).filter(([id]) => ["free","essential7v4","pro7v4","creator30v4","studio30v4"].includes(id))));
const FREE_DAILY = PLAN_LIMITS.free.capabilities.convert.daily_operations;
const PURCHASABLE_PLAN_IDS = new Set(["essential7v4","pro7v4","creator30v4","studio30v4"]);
const KNOWN_TOOL_IDS = new Set(Object.values(PLAN_LIMITS).flatMap((plan) => plan.allowed_tools));
const PLAN_PRICES = Object.freeze(Object.fromEntries(Object.entries(PLAN_LIMITS).map(([id, plan]) => [id, plan.price_cents]).filter(([, price]) => price > 0)));
const ANALYTICS_EVENTS = new Set(["page_view", "converter_view", "file_selected", "file_valid", "file_too_large", "world_analyzed", "operation_started", "operation_completed", "operation_failed", "download_started", "paywall_shown", "plan_viewed", "buy_clicked", "checkout_opened", "kiwify_checkout_redirect", "cpf_valid", "checkout_validation_failed", "pix_create_clicked", "pix_create_success", "pix_create_error", "pix_checkout_redirect", "payment_pending", "payment_paid", "webhook_received", "webhook_verified", "plan_granted", "payment_expired", "entitlement_loaded", "entitlement_load_error", "premium_operation_authorized", "premium_operation_denied", "credit_consumed"]);
const TELEMETRY_SOURCES = new Set(["pricing_card", "world_size_paywall", "feature_paywall", "tool_conquistas", "tool_hardcore", "tool_criativo", "tool_keep_inventory", "tool_jogador", "tool_addons", "tool_chunks", "tool_mundo", "tool_upload", "tool_builder"]);
const TELEMETRY_REASONS = new Set(["terms", "email", "document", "session_expired", "unavailable"]);
const TELEMETRY_ERRORS = new Set(["document_invalid", "email_invalid", "unauthenticated", "rate_limited", "api_key", "compliance", "timeout", "network", "provider", "internal"]);
const ADMIN_HISTORY_LIMIT = 300;
const ADMIN_HISTORY_TTL = 400 * 86400;
const ABANDONED_AFTER_MS = 20 * 60 * 1000;
const ABACATE_PENDING_MS = 24 * 60 * 60 * 1000;
function checkoutLockUntil(checkout) {
  // Link creation is a short lease, not a day-long account purchase lock.
  if (checkout && checkout.provider === "infinitepay" && checkout.status === "creating") return +((checkout.at || checkout.created_at) || 0) + 120000;
  const explicitExpiry = timestampMs(checkout && (checkout.expires_at || (checkout.result && checkout.result.expires_at)));
  if (explicitExpiry) return explicitExpiry;
  const startedAt = +((checkout && (checkout.at || checkout.created_at)) || 0);
  return startedAt + (checkout && ["abacate", "infinitepay"].includes(checkout.provider) ? ABACATE_PENDING_MS : ABANDONED_AFTER_MS);
}
function checkoutIsPending(checkout, now = Date.now()) {
  return !!checkout && ["creating", "ready"].includes(checkout.status) && checkoutLockUntil(checkout) > now;
}
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

export function isAdminEmail(env, email) {
  const allowed = String(env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email || "").trim().toLowerCase());
}

export function classifyAdminCheckout(item, now = Date.now()) {
  if (item && item.status === "paid") return "paid";
  return item && now >= checkoutLockUntil(item) ? "abandoned" : "pending";
}

async function adminUser(req, env) {
  const fb = await firebaseUser(req, env);
  return fb && isAdminEmail(env, fb.email) ? fb : null;
}

async function adminList(env, key) {
  const value = await env.PREMIUM_KV.get(key, "json").catch(() => null);
  return Array.isArray(value) ? value : [];
}

const AUDIT_CLIENT_TYPES = new Set(["session_started", "page_viewed", "tool_viewed", "pricing_viewed", "checkout_opened", "file_selected", "file_validation_started", "file_validation_failed", "file_accepted", "file_analysis_started", "file_analysis_completed", "file_analysis_failed", "tool_opened", "operation_configured", "operation_started", "operation_completed", "operation_failed", "operation_cancelled", "result_generated", "download_requested", "download_response_completed", "download_failed", "refund_form_opened", "refund_form_submitted", "support_opened", "client_error"]);
const AUDIT_SERVER_TYPES = new Set(["payment_created", "payment_confirmed", "plan_granted", "operation_authorized", "credit_used", "benefit_validation_failed", "refund_request_created", "refund_review_started", "refund_approved", "refund_denied", "refund_completed", "refund_decision_changed", "support_status_changed"]);
const AUDIT_METADATA_FIELDS = new Set(["plan", "provider", "source", "tool", "page", "status", "phase", "settings", "file_name", "file_extension", "file_size_bytes", "file_hash", "file_id", "operation_id", "result_size_bytes", "error_code", "error_category", "error_message", "http_status", "browser", "browser_version", "os", "device_type", "screen_resolution", "language", "timezone", "app_version", "frontend_version", "reason", "refund_kind", "description", "expected", "actual", "selected_chunk_count", "world_size_mb", "worlds", "amount_cents"]);
function auditText(value, max = 240) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}
function auditIndexTime(ms = Date.now()) { return String(Math.max(0, 9999999999999 - (+ms || Date.now()))).padStart(13, "0"); }
function auditMetadata(value) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (!AUDIT_METADATA_FIELDS.has(key)) continue;
    if (key === "settings") {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const clean = {};
        for (const [k, v] of Object.entries(raw).slice(0, 20)) if (/^[a-zA-Z0-9_-]{1,40}$/.test(k) && !/(token|secret|password|senha|email|cookie|clipboard|content|payload|key)/i.test(k) && ["string", "number", "boolean"].includes(typeof v)) clean[k] = typeof v === "string" ? auditText(v, 100) : v;
        out.settings = clean;
      }
      continue;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = Math.max(0, raw);
    else if (typeof raw === "boolean") out[key] = raw;
    else if (typeof raw === "string") {
      let clean = auditText(raw, key.includes("description") || key === "expected" || key === "actual" ? 800 : 240);
      if (["error_message", "description", "expected", "actual"].includes(key)) clean = clean
        .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
        .replace(/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|senha|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[token redigido]");
      out[key] = clean;
    }
  }
  return out;
}
async function auditWriteEvent(env, input) {
  try {
    const uid = auditText(input.uid, 160);
    const type = auditText(input.type, 50);
    if (!uid || !type || (!AUDIT_CLIENT_TYPES.has(type) && !AUDIT_SERVER_TYPES.has(type))) return null;
    // Page impressions create far more writes than useful user activity.
    // Keep meaningful actions and errors for the admin timeline.
    if (["session_started", "page_viewed", "tool_viewed", "pricing_viewed"].includes(type)) return null;
    const now = +input.timestamp || Date.now();
    const eventId = (type === "client_error" ? "ERR_" : "EVT_") + crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
    const event = {
      event_id: eventId, event_type: type, timestamp: now, uid,
      session_id: auditText(input.session_id, 100), purchase_id: auditText(input.purchase_id, 180),
      operation_id: auditText(input.operation_id, 120), file_id: auditText(input.file_id, 100),
      refund_request_id: auditText(input.refund_request_id, 80), page: auditText(input.page, 120),
      tool: auditText(input.tool, 60), app_version: auditText(input.app_version || "worldify-static-v1", 80),
      status: auditText(input.status, 40), trust: input.trust === "server" ? "server" : "client",
      metadata: auditMetadata(input.metadata)
    };
    const expires = type === "client_error" ? 90 * 86400 : 400 * 86400;
    const timeKey = auditIndexTime(now) + ":" + eventId;
    // Store the event in its user timeline directly. This replaces two to
    // four KV writes with one while preserving the old event-ID format on read.
    await env.PREMIUM_KV.put("audit:user:" + uid + ":" + timeKey, JSON.stringify(event), { expirationTtl: expires });
    return event;
  } catch (error) { return null; }
}
async function auditList(env, prefix, limit = 500) {
  const events = [];
  let cursor;
  do {
    const page = await env.PREMIUM_KV.list({ prefix, cursor, limit: Math.min(100, Math.max(1, limit - events.length)) });
    const records = await Promise.all((page.keys || []).map(async (item) => {
      const raw = await env.PREMIUM_KV.get(item.name).catch(() => null);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.event_type) return parsed;
      } catch {}
      // Legacy indexes contain only event IDs.
      return env.PREMIUM_KV.get("audit:event:" + raw, "json").catch(() => null);
    }));
    events.push(...records.filter(Boolean));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && events.length < limit);
  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}
async function supportList(env, prefix, limit = 200) {
  const rows = [];
  let cursor;
  do {
    const page = await env.PREMIUM_KV.list({ prefix, cursor, limit: Math.min(100, Math.max(1, limit - rows.length)) });
    const ids = (page.keys || []).map((item) => item.name.split(":").pop());
    const batch = await Promise.all(ids.map((id) => env.PREMIUM_KV.get("support:case:" + id, "json").catch(() => null)));
    rows.push(...batch.filter(Boolean));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && rows.length < limit);
  return rows.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}
function supportPurchaseForUser(purchase, user) {
  if (!purchase || !user) return false;
  const emailMatches = String(purchase.email || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase();
  const uidMatches = !purchase.uid || String(purchase.uid) === String(user.uid);
  return emailMatches && uidMatches;
}
function supportFilesShape(files) {
  if (!Array.isArray(files) || files.length > 3) throw new Error("Anexe até 3 imagens por solicitação.");
  let total = 0;
  return files.map((file) => {
    const mime = String(file && file.mime || "").toLowerCase();
    const name = auditText(file && file.name, 100).replace(/[\\/:*?"<>|]/g, "_");
    const dataUrl = String(file && file.data_url || "");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match || match[1] !== mime) throw new Error("Os anexos devem ser imagens PNG, JPG ou WebP.");
    let decoded;
    try { decoded = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)); } catch { throw new Error("Um dos anexos não é uma imagem válida."); }
    const isPng = mime === "image/png" && decoded.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => decoded[i] === byte);
    const isJpeg = mime === "image/jpeg" && decoded.length >= 3 && decoded[0] === 255 && decoded[1] === 216 && decoded[2] === 255;
    const isWebp = mime === "image/webp" && decoded.length >= 12 && String.fromCharCode(...decoded.slice(0, 4)) === "RIFF" && String.fromCharCode(...decoded.slice(8, 12)) === "WEBP";
    if (!(isPng || isJpeg || isWebp)) throw new Error("Um dos anexos não corresponde ao formato de imagem informado.");
    const bytes = decoded.length;
    if (bytes < 1 || bytes > 1024 * 1024) throw new Error("Cada imagem pode ter no máximo 1 MB.");
    total += bytes;
    if (total > 2 * 1024 * 1024) throw new Error("O total dos anexos pode ter no máximo 2 MB.");
    return { id: "ATT_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase(), name, mime, size_bytes: bytes, data: match[2] };
  });
}
function supportStatusOpen(status) { return ["received", "in_review", "waiting_customer", "problem_resolved", "refund_approved"].includes(status); }
function supportTags(item, events) {
  const tags = new Set();
  if (item && item.payment_confirmed && !item.benefit_granted) tags.add("PAYMENT_NOT_GRANTED");
  if (!events.length) tags.add("NO_USAGE");
  if (events.some((event) => event.event_type === "operation_failed" || event.event_type === "client_error" || event.event_type === "file_analysis_failed")) tags.add("TECHNICAL_FAILURE");
  if (events.some((event) => event.event_type === "download_failed")) tags.add("DOWNLOAD_FAILURE");
  if (events.filter((event) => event.event_type === "operation_completed").length >= 5) tags.add("HEAVY_USAGE");
  if (!tags.size) tags.add("UNKNOWN");
  return Array.from(tags);
}


function browserVersion(ua) { const m=String(ua||"").match(/(?:Edg|Firefox|Chrome|CriOS|Version)\/([0-9.]+)/i); return m ? m[1].slice(0,24) : ""; }
function operatingSystem(ua) { return /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : "other"; }
async function checkoutTelemetrySource(env, id) {
  const checkouts = await adminList(env, "admin:checkouts");
  const checkout = checkouts.find((item) => item.id === String(id || ""));
  const source = String(checkout && checkout.source || "");
  return TELEMETRY_SOURCES.has(source) ? source : "";
}

async function saveAdminList(env, key, items) {
  await env.PREMIUM_KV.put(key, JSON.stringify(items.slice(0, ADMIN_HISTORY_LIMIT)), { expirationTtl: ADMIN_HISTORY_TTL }).catch(() => {});
}

function summarizeAdminErrors(items) {
  const groups = new Map();
  for (const item of items) {
    const rawMessage = String(item.msg || "Sem detalhes");
    let kind = "technical";
    let title = "Erro técnico";
    let message = rawMessage;
    if (/aceitar os termos|e-mail válido|cpf\/cnpj válido/i.test(rawMessage)) {
      kind = "checkout_input";
      title = "Dados incompletos no checkout";
      message = "O Pix não foi criado porque o cliente não preencheu ou confirmou todos os dados.";
    } else if (/compliance review|unable to process deposits/i.test(rawMessage)) {
      kind = "depix_compliance";
      title = "Pagamento recusado pela análise da Depix";
      message = "A Depix bloqueou esta cobrança para o pagador. Oriente o cliente a falar com o suporte da Depix ou usar outro pagador.";
    } else if (item.step) {
      title += " em " + String(item.step).slice(0, 40);
    }
    const key = kind + ":" + title + ":" + message;
    const current = groups.get(key) || { at: 0, title, msg: message, count: 0, kind };
    current.at = Math.max(+current.at || 0, +item.at || 0);
    current.count += 1;
    groups.set(key, current);
  }
  return Array.from(groups.values()).sort((a, b) => b.at - a.at).slice(0, 20);
}

async function recordCheckout(env, entry) {
  const items = await adminList(env, "admin:checkouts");
  const id = String(entry.id || "").slice(0, 180);
  if (!id || items.some((item) => item.id === id)) return;
  items.unshift({
    id,
    at: +entry.at || Date.now(),
    email: String(entry.email || "").trim().toLowerCase().slice(0, 120),
    uid: String(entry.uid || "").slice(0, 160),
    plan: normalizeDepixPlan(entry.plan),
    amount_cents: PLAN_PRICES[normalizeDepixPlan(entry.plan)] || 0,
    provider: String(entry.provider || "depix").slice(0, 20),
    expires_at: timestampMs(entry.expires_at),
    source: cleanDimension(entry.source, 40),
    status: "pending"
  });
  await saveAdminList(env, "admin:checkouts", items);
}

async function recordPaidCheckout(env, entry) {
  const id = String(entry.id || "").slice(0, 180);
  if (!id) return;
  const paidAt = +entry.paid_at || Date.now();
  const checkouts = await adminList(env, "admin:checkouts");
  const checkout = checkouts.find((item) => item.id === id);
  const checkoutSource = String(checkout && checkout.source || "");
  const entrySource = String(entry.source || "");
  const attribution = TELEMETRY_SOURCES.has(checkoutSource)
    ? checkoutSource
    : (TELEMETRY_SOURCES.has(entrySource) ? entrySource : cleanDimension(entrySource || checkoutSource || entry.provider, 40));
  if (checkout) {
    checkout.status = "paid";
    checkout.paid_at = paidAt;
    if (entry.email) checkout.email = String(entry.email).trim().toLowerCase().slice(0, 120);
    if (entry.uid) checkout.uid = String(entry.uid).slice(0, 160);
    if (entry.plan) checkout.plan = normalizeDepixPlan(entry.plan);
  }
  await saveAdminList(env, "admin:checkouts", checkouts);

  const purchases = await adminList(env, "admin:purchases");
  const plan = normalizeDepixPlan(entry.plan || (checkout && checkout.plan));
  const existingPurchase = purchases.find((item) => item.id === id);
  if (existingPurchase) {
    existingPurchase.paid_at = paidAt;
    if (entry.email) existingPurchase.email = String(entry.email).trim().toLowerCase().slice(0, 120);
    if (entry.uid) existingPurchase.uid = String(entry.uid).slice(0, 160);
    if (plan) existingPurchase.plan = plan;
    if (plan) existingPurchase.amount_cents = PLAN_PRICES[plan] || 0;
    if (entry.provider) existingPurchase.provider = String(entry.provider).slice(0, 20);
    if (attribution) existingPurchase.source = attribution;
    await saveAdminList(env, "admin:purchases", purchases);
    return;
  }
  purchases.unshift({
    id,
    at: checkout ? checkout.at : paidAt,
    paid_at: paidAt,
    email: String(entry.email || (checkout && checkout.email) || "").trim().toLowerCase().slice(0, 120),
    uid: String(entry.uid || (checkout && checkout.uid) || "").slice(0, 160),
    plan,
    amount_cents: PLAN_PRICES[plan] || 0,
    provider: String(entry.provider || (checkout && checkout.provider) || "depix").slice(0, 20),
    source: attribution
  });
  await saveAdminList(env, "admin:purchases", purchases);
}

async function recordAdminAction(env, entry) {
  const items = await adminList(env, "admin:actions");
  items.unshift({
    at: Date.now(),
    admin: String(entry.admin || "").slice(0, 120),
    email: String(entry.email || "").slice(0, 120),
    plan: normalizeDepixPlan(entry.plan),
    reason: String(entry.reason || "").slice(0, 160),
    billing_id: String(entry.billing_id || "").slice(0, 180)
  });
  await saveAdminList(env, "admin:actions", items);
}

async function reconcileDepixCheckout(env, id) {
  id = String(id || "").trim().slice(0, 180);
  if (!id) throw new Error("ID da cobrança obrigatório.");
  const info = await depixStatus(env, id);
  const pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
  if (info.uid && pend && pend.uid && String(info.uid) !== String(pend.uid)) throw new Error("UID do provedor não corresponde ao UID do checkout.");
  const email = String(info.email || (pend && pend.email) || "").trim().toLowerCase();
  const uid = String(info.uid || (pend && pend.uid) || "").trim().slice(0, 160);
  const plan = normalizeDepixPlan((pend && pend.plan) || info.plan);
  if (!plan) throw new Error("Pagamento confirmado sem um plano reconhecido.");
  if (!info.paid) return { id, paid: false, status: info.status, email, plan };
  if (!validEmail(email)) throw new Error("Pagamento confirmado, mas sem e-mail válido para liberar o plano.");
  const receipt = await persistConfirmedPayment(env, { id, email, plan, uid, provider: "depix", source: pend && pend.source, paid_at: info.paid_at });
  const grant = await grantPurchase(env, email, id, plan, uid, "depix", info.paid_at, pend && pend.source);
  await env.PREMIUM_KV.delete(receipt.key);
  await recordPaidCheckout(env, { id, email, uid, plan, provider: "depix", source: pend && pend.source });
  await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
  return { id, paid: true, status: info.status, email, plan, source: pend && pend.source, ...grant };
}

async function listDepixCheckouts(env, status) {
  if (!env.DEPIX_API_KEY) throw new Error("Depix não configurado no servidor.");
  const response = await fetch("https://api.depixapp.com/api/checkouts?status=" + encodeURIComponent(status) + "&limit=100", {
    headers: { Authorization: "Bearer " + env.DEPIX_API_KEY }
  });
  if (!response.ok) throw new Error("Falha ao listar checkouts Depix (HTTP " + response.status + ").");
  const data = await response.json();
  return Array.isArray(data.checkouts) ? data.checkouts : [];
}

export async function reconcileRecentDepixCheckouts(env) {
  const all = [];
  for (const status of ["approved", "completed"]) {
    all.push(...await listDepixCheckouts(env, status));
  }
  const seen = new Set();
  const results = [];
  for (const checkout of all) {
    const id = String(checkout.id || "").trim().slice(0, 180);
    if (!id || !isDepixReleasableStatus(checkout.status) || seen.has(id)) continue;
    seen.add(id);
    const reconciledKey = "depix:reconciled:" + encodeURIComponent(id);
    if (await env.PREMIUM_KV.get(reconciledKey).catch(() => null)) continue;
    let metadata = checkout.metadata || {};
    if (typeof metadata === "string") { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
    const email = String(metadata.email || "").trim().toLowerCase();
    const uid = String(metadata.firebase_uid || "").trim().slice(0, 160);
    const rawPlan = String(metadata.plan || "");
    if (!validEmail(email) || !normalizeDepixPlan(rawPlan)) continue;
    const plan = normalizeDepixPlan(rawPlan);
    const paidAt = timestampMs(checkout.paid_at || checkout.approved_at || checkout.completed_at || checkout.updated_at);
    const pending = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
    const receipt = await persistConfirmedPayment(env, { id, email, plan, uid, provider: "depix", source: pending && pending.source, paid_at: paidAt });
    const grant = await grantPurchase(env, email, id, plan, uid, "depix", paidAt, pending && pending.source);
    await env.PREMIUM_KV.delete(receipt.key);
    await recordPaidCheckout(env, { id, email, uid, plan, provider: "depix", source: "automatic_reconcile" });
    await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
    await env.PREMIUM_KV.put(reconciledKey, "1", { expirationTtl: 400 * 86400 }).catch(() => {});
    results.push({ id, paid: true, status: String(checkout.status || ""), email, plan, ...grant });
  }
  return { checked: seen.size, recovered: results.length, results };
}

// Valida o ID token do Firebase no servidor. O navegador nunca escolhe qual
// conta receberá o VIP: UID/e-mail vêm da sessão Google verificada.
async function firebaseUser(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const apiKey = String(env.FIREBASE_WEB_API_KEY || "").trim();
  if (!token || token.length > 4096) return null;
  if (!apiKey) { const error = new Error("Firebase verification is unavailable."); error.code = "AUTH_UNAVAILABLE"; throw error; }
  try {
    const resp = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!resp.ok) {
      if (resp.status >= 500 || resp.status === 429) { const error = new Error("Firebase verification is temporarily unavailable."); error.code = "AUTH_UNAVAILABLE"; throw error; }
      return null;
    }
    const data = await resp.json();
    const u = data && data.users && data.users[0];
    if (!u || !u.localId || !validEmail(u.email)) return null;
    return {
      uid: String(u.localId).slice(0, 160),
      email: String(u.email).trim().toLowerCase(),
      name: String(u.displayName || "").slice(0, 80),
    };
  } catch (e) {
    if (e && e.code === "AUTH_UNAVAILABLE") throw e;
    const error = new Error("Firebase verification is temporarily unavailable."); error.code = "AUTH_UNAVAILABLE"; throw error;
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
export function isSecurityResearcherReward(env, email) {
  const configured = String(env.SECURITY_REWARD_EMAIL || "").trim().toLowerCase();
  return !!configured && configured === String(email || "").trim().toLowerCase();
}

export async function abacateCreate(env, email, name, uid, origin, plan) {
  const pid = PURCHASABLE_PLAN_IDS.has(plan) ? env["ABACATEPAY_PRODUCT_ID_" + plan.toUpperCase()] : (plan === "world1" ? env.ABACATEPAY_PRODUCT_ID_WORLD1 : plan === "vip24h" ? env.ABACATEPAY_PRODUCT_ID_24H : env.ABACATEPAY_PRODUCT_ID);
  if (!pid) {
    throw new Error(plan === "world1"
      ? "Produto de 1 mundo não configurado no servidor (ABACATEPAY_PRODUCT_ID_WORLD1)."
      : plan === "vip24h" ? "Produto legado de 24 horas não configurado no servidor (ABACATEPAY_PRODUCT_ID_24H)."
      : "Produto não configurado no servidor (ABACATEPAY_PRODUCT_ID).");
  }
  if (PURCHASABLE_PLAN_IDS.has(plan)) {
    const productResponse = await fetch("https://api.abacatepay.com/v2/products/get?id=" + encodeURIComponent(pid), {headers:{Authorization:"Bearer " + (env.ABACATEPAY_V4_API_KEY || env.ABACATEPAY_API_KEY)}});
    const product = (await productResponse.json()).data;
    if (!productResponse.ok || !product || product.id !== pid || product.price !== PLAN_LIMITS[plan].price_cents || product.currency !== "BRL" || product.cycle || product.status !== "ACTIVE" || product.devMode) throw new Error("Produto ou preço incompatível. Nenhuma cobrança foi criada.");
  }
  const base = String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const body = {
    items: [{ id: pid, quantity: 1 }],
    returnUrl: base + "/",
    completionUrl: base + "/sucesso.html",
    metadata: { firebase_uid: uid || "", email, name, plan },
    methods: ["PIX"],
  };
  const resp = await fetch("https://api.abacatepay.com/v2/checkouts/create", {
    method: "POST",
    headers: { Authorization: "Bearer " + (env.ABACATEPAY_V4_API_KEY || env.ABACATEPAY_API_KEY), "Content-Type": "application/json" },
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
  if (PURCHASABLE_PLAN_IDS.has(plan) && (d.amount !== PLAN_LIMITS[plan].price_cents || d.devMode || !/^https:\/\/(?:app\.)?abacatepay\.com\//i.test(d.url))) throw new Error("Checkout inválido. Consulte o suporte antes de repetir a compra.");
  return { url: d.url, id: d.id, plan, expires_at: timestampMs(d.expiresAt || d.expires_at) };
}

export async function abacateStatus(env, id) {
  const urls = [
    "https://api.abacatepay.com/v2/checkouts/get?id=" + encodeURIComponent(id),
    "https://api.abacatepay.com/v1/billing/get?id=" + encodeURIComponent(id),
  ];
  let last = null;
  const attempts = [...new Set([env.ABACATEPAY_V4_API_KEY,env.ABACATEPAY_API_KEY].filter(Boolean))].flatMap(token => urls.map(url => ({token,url})));
  for (const attempt of attempts) {
    const u = attempt.url;
    try {
      const resp = await fetch(u, { headers: { Authorization: "Bearer " + attempt.token } });
      if (!resp.ok) { last = new Error("HTTP " + resp.status); continue; }
      const data = await resp.json();
      const b = data.data || data;
      const status = String(b.status || "").toUpperCase();
      const verifiedPlan = normalizeDepixPlan(b.metadata && b.metadata.plan);
      if (isPaidPaymentStatus(status) && PURCHASABLE_PLAN_IDS.has(verifiedPlan) && (b.amount !== PLAN_LIMITS[verifiedPlan].price_cents || b.paidAmount !== PLAN_LIMITS[verifiedPlan].price_cents || b.devMode)) throw new Error("Pagamento com valor ou ambiente incompatível.");
      const meta = b.metadata || {};
      const cust = b.customer || {};
      const email = String(meta.email || cust.email || "").toLowerCase();
      return { amount: b.amount, paidAmount: b.paidAmount, devMode: b.devMode, status: status || "UNKNOWN", paid: isPaidPaymentStatus(status), email, uid: String(meta.firebase_uid || "").slice(0, 160), plan: normalizeDepixPlan(meta.plan),
        paid_at: timestampMs(b.paidAt || b.paid_at || b.approvedAt || b.approved_at || b.completedAt || b.updatedAt || b.updated_at) };
    } catch (e) { last = e; }
  }
  throw new Error("Não consegui consultar a cobrança agora (" + (last && last.message) + ").");
}

/* ---------- Depix: preços em centavos p/ teste e produção ---------- */
export function normalizeDepixPlan(plan) {
  const value = String(plan || "").trim();
  return Object.prototype.hasOwnProperty.call(PLAN_LIMITS, value) && value !== "free" ? value : "";
}
export function isPaidPaymentStatus(status) {
  return PAID.has(String(status || "").trim().toUpperCase());
}
function depixAmount(plan) {
  plan = normalizeDepixPlan(plan);
  return plan ? PLAN_LIMITS[plan].price_cents : 0;
}
function depixPlanLabel(plan) {
  plan = normalizeDepixPlan(plan);
  return plan ? (PLAN_LIMITS[plan].catalog_label || PLAN_LIMITS[plan].label) : "";
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
    [env.KIWIFY_PID_WORLD1, "world1"],
    [env.KIWIFY_PID_24H, "vip24h"],
    [env.KIWIFY_PID_7D, "vip7"],
    [env.KIWIFY_PID_30D, "vip30"],
    [env.KIWIFY_PID_CREATOR, "creator"]
  ];
  for (const [configured, plan] of ids) if (configured && pid && pid === String(configured).trim()) return plan;
  if (["1 mundo", "resolver 1 mundo"].includes(name)) return "world1";
  if (["vip 24h", "passe 24h", "24 horas"].includes(name)) return "vip24h";
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
async function depixCreate(env, email, name, uid, plan, doc, payerEmail, req, requestId = "") {
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
    idempotency_key: String(requestId || "").slice(0, 100),
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
      plan: plan,
      request_id: String(requestId || "").slice(0, 100)
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
  return { url: data.payment_url, id: data.id, plan: plan, expires_at: timestampMs(data.expires_at || data.expiresAt) };
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
  var paid = isDepixReleasableStatus(status);
  var meta = c.metadata || {};
  if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch (e) { meta = {}; } }
  return {
    status: status || "unknown",
    paid: paid,
    uid: String(meta.firebase_uid || "").slice(0, 160),
    email: String(meta.email || "").toLowerCase(),
    plan: normalizeDepixPlan(meta.plan),
    paid_at: timestampMs(c.paid_at || c.approved_at || c.completed_at || c.updated_at)
  };
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function isDepixReleasableStatus(status) {
  return ["approved", "completed"].includes(String(status || "").toLowerCase());
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
function infinitePayOrderStub(env, orderNsu) {
  if (!env.ENTITLEMENTS) throw new Error("ENTITLEMENTS não configurado no Worker.");
  return env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName("infinitepay:" + String(orderNsu || "").trim().slice(0, 100)));
}
async function saveInfinitePayOrder(env, order) {
  const stub = infinitePayOrderStub(env, order.order_nsu);
  const response = await stub.fetch("https://entitlements/payment/record", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order)
  });
  if (!response.ok) throw new Error("Não consegui registrar o pedido de pagamento.");
  return response.json();
}
async function getInfinitePayOrder(env, orderNsu) {
  const stub = infinitePayOrderStub(env, orderNsu);
  const response = await stub.fetch("https://entitlements/payment/get");
  if (!response.ok) throw new Error("Não consegui consultar o pedido de pagamento.");
  const result = await response.json();
  return result && result.order || null;
}

function paymentReceiptKey(identityKind, identity, provider, billingId) {
  return "payrec:" + identityKind + ":" + encodeURIComponent(String(identity || "")) + ":" + cleanDimension(provider, 20) + ":" + encodeURIComponent(String(billingId || "").slice(0, 180));
}

async function persistConfirmedPayment(env, payment) {
  const plan = normalizeDepixPlan(payment.plan);
  const id = String(payment.id || payment.billing_id || "").trim().slice(0, 180);
  const provider = cleanDimension(payment.provider || "depix", 20);
  const uid = String(payment.uid || "").trim().slice(0, 160);
  const email = String(payment.email || "").trim().toLowerCase();
  const source = TELEMETRY_SOURCES.has(String(payment.source || "")) ? String(payment.source) : "";
  if (!id || !plan || (!uid && !validEmail(email))) throw new Error("Pagamento confirmado sem identidade ou plano válido.");
  const identityKind = uid ? "uid" : "email";
  const identity = uid || email;
  const key = paymentReceiptKey(identityKind, identity, provider, id);
  const paidAt = timestampMs(payment.paid_at) || Date.now();
  await env.PREMIUM_KV.put(key, JSON.stringify({ id, provider, uid, email, plan, source, paid_at: paidAt }), { expirationTtl: 400 * 86400 });
  return { key, id, provider, uid, email, plan, source, paid_at: paidAt };
}

async function grantPurchase(env, email, billingId, plan, uid = "", provider = "depix", paidAt = 0, source = "") {
  plan = normalizeDepixPlan(plan);
  if (!plan) throw new Error("Plano de pagamento não reconhecido; benefício não concedido.");
  if (!env.ENTITLEMENTS) throw new Error("Armazenamento de benefícios indisponível.");
  const stub = await entitlementStub(env, uid, email);
  const idempotencyKey = cleanDimension(provider, 20) + ":" + String(billingId || "").trim().slice(0, 180);
  const r = await stub.fetch("https://entitlements/grant", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billing_id: idempotencyKey, email, uid, paid_at: timestampMs(paidAt) || Date.now() })
  });
  if (!r.ok) throw new Error("Não consegui registrar o benefício da compra.");
  const out = await r.json();
  const grant = { premium_until_ms: +out.premium_until_ms || 0, world_credits: +out.world_credits || 0, plan: out.plan || plan, duplicate: out.duplicate === true };
  if (!grant.duplicate && provider !== "manual") {
    if (uid) await auditWriteEvent(env, { uid, type: "plan_granted", purchase_id: String(billingId || ""), trust: "server", status: "granted", metadata: { plan, provider } });
    const requestedSource = TELEMETRY_SOURCES.has(String(source || "")) ? String(source) : await checkoutTelemetrySource(env, billingId);
    const attribution = requestedSource || provider;
    await metric(env, "payment_paid", { plan, source: attribution });
    await metric(env, "plan_granted", { plan, source: provider });
  }
  return grant;
}

function isValidInfinitePayCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && ["checkout.infinitepay.com.br", "checkout.infinitepay.io"].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

async function infinitePayCreate(env, { orderNsu, plan, email, name, uid }) {
  const handle = String(env.INFINITEPAY_HANDLE || "").trim().replace(/^\$/, "");
  if (!handle) throw new Error("Configure INFINITEPAY_HANDLE no Worker antes de abrir as vendas.");
  const base = String(env.PUBLIC_BASE_URL || "https://worldify.com.br").replace(/\/$/, "");
  const definition = PLAN_LIMITS[plan];
  const response = await fetch("https://api.checkout.infinitepay.io/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      redirect_url: base + "/sucesso.html",
      webhook_url: String(env.PAYMENT_API_URL || base).replace(/\/$/, "") + "/api/infinitepay/webhook",
      order_nsu: orderNsu,
      customer: { name: String(name || "Worldify").slice(0, 100), email },
      items: [{ quantity: 1, price: definition.price_cents, description: (definition.catalog_label || definition.label).slice(0, 100) }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  const checkoutUrl = String(payload.url || payload.checkout_url || payload.link || "");
  const validCheckoutUrl = isValidInfinitePayCheckoutUrl(checkoutUrl);
  if (!response.ok || payload.success === false || !validCheckoutUrl) {
    const providerError = (message, retryable) => {
      const error = new Error(message);
      error.retryable = retryable;
      return error;
    };
    if (response.status === 401 || response.status === 403) {
      throw providerError("A InfinitePay recusou a criação do checkout. Ative o Checkout Integrado em Vendas > Checkout > Configurações e confirme se a InfiniteTag configurada pertence a essa conta.", true);
    }
    if (response.status === 400) {
      throw providerError("A InfinitePay rejeitou os dados do pedido. Confirme se o Checkout Integrado está habilitado e tente novamente.", true);
    }
    if (response.status === 429) {
      throw providerError("A InfinitePay recebeu muitas tentativas. Aguarde alguns minutos e tente novamente.", true);
    }
    if (response.status >= 500) {
      throw providerError("O checkout da InfinitePay está temporariamente indisponível. Tente novamente em alguns minutos.", false);
    }
    throw providerError("A InfinitePay não retornou um link de checkout válido. Confirme se o Checkout Integrado está habilitado na sua conta.", false);
  }
  return { id: orderNsu, url: checkoutUrl, plan };
}

async function infinitePayCheck(env, event) {
  const handle = String(env.INFINITEPAY_LEGACY_HANDLE || env.INFINITEPAY_HANDLE || "").trim().replace(/^\$/, "");
  if (!handle) throw new Error("INFINITEPAY_HANDLE não configurado.");
  const response = await fetch("https://api.checkout.infinitepay.io/payment_check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle,
      order_nsu: String(event.order_nsu || ""),
      transaction_nsu: String(event.transaction_nsu || ""),
      slug: String(event.invoice_slug || event.slug || "")
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success !== true) {
    throw new Error("A InfinitePay ainda não confirmou o pagamento.");
  }
  return payload;
}

async function fulfillInfinitePayOrder(env, { orderNsu, transactionNsu, slug, expectedUid = "", expectedEmail = "" }) {
  const paidKey = "infinitepay:paid:" + orderNsu;
  const prior = await env.PREMIUM_KV.get(paidKey, "json").catch(() => null);
  if (prior) {
    if (expectedUid && prior.uid !== expectedUid) throw new Error("Este pedido pertence a outra conta.");
    return { paid: true, duplicate: true, id: orderNsu, plan: prior.plan, paid_at: prior.paid_at };
  }
  // New InfinitePay orders live in Durable Objects, which do not share KV's
  // daily write cap. Fall back to KV only for checkouts created by older code.
  let pending = await getInfinitePayOrder(env, orderNsu).catch(() => null)
    || await env.PREMIUM_KV.get(pendKey(orderNsu), "json").catch(() => null);
  // Recover a legacy checkout whose KV write failed after the account DO had
  // already saved the provider URL. This lets the signed-in buyer finish the
  // existing payment instead of creating another charge.
  if (!pending && expectedUid && validEmail(expectedEmail)) {
    const account = await entitlementStub(env, expectedUid, expectedEmail).then((stub) => stub.fetch("https://entitlements/state"))
      .then((response) => response.ok ? response.json() : null).catch(() => null);
    const checkout = (account && account.pending_payments || []).find((item) => item.id === orderNsu && item.provider === "infinitepay");
    if (checkout) pending = { uid: expectedUid, email: expectedEmail, plan: checkout.plan, via: "infinitepay", source: "" };
  }
  if (!pending || pending.via !== "infinitepay") throw new Error("Pedido não encontrado.");
  if (expectedUid && pending.uid !== expectedUid) throw new Error("Este pedido pertence a outra conta.");
  const plan = normalizeDepixPlan(pending.plan);
  if (!plan || !validEmail(pending.email) || !pending.uid) throw new Error("Pedido sem plano ou conta válidos.");
  if (pending.status === "paid") return { paid: true, duplicate: true, id: orderNsu, plan, paid_at: pending.paid_at || 0 };
  const payment = await infinitePayCheck(env, { order_nsu: orderNsu, transaction_nsu: transactionNsu, invoice_slug: slug });
  if (!payment.paid) return { paid: false, status: "pending", id: orderNsu, plan };
  if (+payment.amount !== PLAN_LIMITS[plan].price_cents) throw new Error("Valor recebido diferente do pedido.");
  const paidAt = Date.now();
  // Grant first using the idempotent account Durable Object. KV receipts are
  // useful for legacy reconciliation, but must never block a confirmed buyer.
  const grant = await grantPurchase(env, pending.email, orderNsu, plan, pending.uid, "infinitepay", paidAt, pending.source);
  const orderStub = infinitePayOrderStub(env, orderNsu);
  await orderStub.fetch("https://entitlements/payment/paid", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paid_at: paidAt })
  }).catch(() => {});
  await env.PREMIUM_KV.put(paidKey, JSON.stringify({ uid: pending.uid, plan, paid_at: paidAt }), { expirationTtl: 400 * 86400 }).catch(() => {});
  await persistConfirmedPayment(env, { id: orderNsu, email: pending.email, uid: pending.uid, plan, provider: "infinitepay", source: pending.source, paid_at: paidAt }).catch(() => {});
  await env.PREMIUM_KV.delete(pendKey(orderNsu)).catch(() => {});
  await recordPaidCheckout(env, { id: orderNsu, email: pending.email, uid: pending.uid, plan, provider: "infinitepay", source: pending.source, paid_at: paidAt });
  return { id: orderNsu, paid: true, status: "paid", plan, paid_at: paidAt, ...grant };
}

async function reconcileKnownPayments(env, uid, email) {
  const prefixes = ["payrec:uid:" + encodeURIComponent(uid) + ":"];
  if (email) prefixes.push("payrec:email:" + encodeURIComponent(email.toLowerCase()) + ":");
  for (const prefix of prefixes) {
    let cursor;
    do {
      const page = await env.PREMIUM_KV.list({ prefix, cursor, limit: 100 });
      for (const item of page.keys || []) {
        const receipt = await env.PREMIUM_KV.get(item.name, "json");
        if (!receipt) continue;
        await grantPurchase(env, email, receipt.id, receipt.plan, uid, receipt.provider, receipt.paid_at, receipt.source);
        await recordPaidCheckout(env, { id: receipt.provider === "kiwify" ? "kiwify:" + receipt.id : receipt.id,
          email: receipt.email || email, uid, plan: receipt.plan, provider: receipt.provider, paid_at: receipt.paid_at, source: "entitlement_reconcile" });
        await env.PREMIUM_KV.delete(item.name);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
}

async function reconcilePendingCheckouts(env, uid, email, checkouts) {
  const recent = (Array.isArray(checkouts) ? checkouts : [])
    .filter((item) => checkoutIsPending(item))
    .sort((a, b) => +b.created_at - +a.created_at);
  const uncertainCreation = recent.find((item) => item.status === "creating" && !item.id);
  const candidates = recent
    .filter((item) => item.id)
    .sort((a, b) => +b.created_at - +a.created_at)
    .slice(0, 20);
  let latestPending = uncertainCreation ? { plan: uncertainCreation.plan, provider: uncertainCreation.provider, status: "checkout_creation_uncertain", created_at: +uncertainCreation.created_at, request_id: uncertainCreation.request_id || "", checkout_url: "" } : null;
  let unavailable = false;
  let recovered = false;
  for (const checkout of candidates) {
    const provider = ["abacate", "infinitepay"].includes(checkout.provider) ? checkout.provider : "depix";
    if (provider === "infinitepay") continue; // Confirmed by verified webhook or authenticated return.
    const id = String(checkout.id).slice(0, 180);
    const cacheKey = "paycheck:" + encodeURIComponent(uid) + ":" + provider + ":" + encodeURIComponent(id);
    let info = await env.PREMIUM_KV.get(cacheKey, "json").catch(() => null);
    if (!info) {
      try { info = provider === "depix" ? await depixStatus(env, id) : await abacateStatus(env, id); }
      catch (error) {
        unavailable = true;
        await metric(env, "entitlement_load_error", { reason: "unavailable" });
        continue;
      }
      await env.PREMIUM_KV.put(cacheKey, JSON.stringify({ paid: info.paid === true, status: String(info.status || "unknown"), paid_at: timestampMs(info.paid_at) }), { expirationTtl: info.paid === true ? 30 : 5 }).catch(() => {});
    }
    if (info.paid !== true) {
      if (!latestPending || +checkout.created_at > +latestPending.created_at) latestPending = { plan: checkout.plan, provider, status: info.status || "pending", created_at: +checkout.created_at, request_id: checkout.request_id || "", checkout_url: checkout.checkout_url || "" };
      continue;
    }
    const plan = normalizeDepixPlan(checkout.plan);
    if (!plan || (info.plan && info.plan !== plan) || (info.uid && info.uid !== uid)) {
      unavailable = true;
      continue;
    }
    try {
      const paidAt = timestampMs(info.paid_at);
      const pending = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
      const receipt = await persistConfirmedPayment(env, { id, email: info.email || email, uid, plan, provider, source: pending && pending.source, paid_at: paidAt });
      await grantPurchase(env, info.email || email, id, plan, uid, provider, paidAt, pending && pending.source);
      await env.PREMIUM_KV.delete(receipt.key);
      await recordPaidCheckout(env, { id, email: info.email || email, uid, plan, provider, source: "entitlement_reconcile" });
      recovered = true;
    } catch (error) {
      // Keep the provider's paid result cached and the checkout available for a later grant retry.
      unavailable = true;
    }
  }
  return { pending_payment: latestPending, unavailable, recovered };
}

async function readObjectState(stub) {
  const response = await stub.fetch("https://entitlements/state");
  if (!response.ok) throw new Error("ENTITLEMENT_UNAVAILABLE");
  return response.json();
}

export async function getUserEntitlements(env, firebaseUid, user = {}) {
  const uid = String(firebaseUid || "").trim().slice(0, 160);
  const email = String(user.email || "").trim().toLowerCase();
  if (!uid || !validEmail(email)) throw new Error("AUTH_REQUIRED");

  // Recibos confirmados ficam no KV até o Durable Object confirmar a concessão.
  // Esta leitura no próximo login/status recupera falhas temporárias de grant.
  await reconcileKnownPayments(env, uid, email);

  const uidStub = await entitlementStub(env, uid, email);
  let uidState = await readObjectState(uidStub);
  const pendingReconciliation = await reconcilePendingCheckouts(env, uid, email, uidState.pending_payments);
  if (pendingReconciliation.recovered) uidState = await readObjectState(uidStub);

  // Migra concessões antigas por e-mail somente após validar o e-mail no token Google.
  const legacyEmailStub = await entitlementStub(env, "", email);
  const legacyEmailState = await readObjectState(legacyEmailStub);
  if (+legacyEmailState.revision > 0) {
    const importRes = await uidStub.fetch("https://entitlements/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "legacy-email:" + email, revision: legacyEmailState.revision, state: legacyEmailState })
    });
    if (!importRes.ok) throw new Error("ENTITLEMENT_UNAVAILABLE");
  }

  const uidRecord = await env.PREMIUM_KV.get(premUidKey(uid), "json");
  const emailRecord = await env.PREMIUM_KV.get(premKey(email), "json");
  const legacyRecord = (+((emailRecord && emailRecord.until) || 0) > +((uidRecord && uidRecord.until) || 0)) ? emailRecord : uidRecord;
  if (legacyRecord && +legacyRecord.until > +uidState.premium_until_ms) {
    const legacyPlan = normalizeDepixPlan(legacyRecord.plan);
    if (!legacyPlan || PLAN_LIMITS[legacyPlan].kind !== "time") {
      // Old credit records may carry an unrelated expiry. They cannot grant a
      // time pass, but must not block valid credit and purchase records.
      await metric(env, "entitlement_load_error", { reason: "invalid_legacy_plan" });
    } else {
      const migrated = await uidStub.fetch("https://entitlements/migrate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premium_until_ms: +legacyRecord.until, plan: legacyPlan })
      });
      if (!migrated.ok) throw new Error("ENTITLEMENT_UNAVAILABLE");
    }
  }

  const state = await readObjectState(uidStub);
  const now = Date.now();
  const reward = isSecurityResearcherReward(env, email);
  const candidateTimePlan = normalizeDepixPlan(state.plan);
  const hasTimePlan = !!(candidateTimePlan && PLAN_LIMITS[candidateTimePlan].kind === "time");
  const storedUntil = hasTimePlan ? (+state.premium_until_ms || 0) : 0;
  if (!hasTimePlan && +state.premium_until_ms > now) {
    // A legacy credit/unknown plan can carry a future timestamp. Never grant
    // time access from it, and do not make the account unreadable.
    await metric(env, "entitlement_load_error", { reason: "invalid_active_plan" });
  }
  const timeUntil = Math.max(storedUntil, reward ? now + SECURITY_REWARD_DAYS * 86400000 : 0);
  const activeProjects = (state.world_projects || []).filter((project) => +project.expires_at > now);
  const storedTimePlan = timeUntil > now && hasTimePlan ? candidateTimePlan : "";
  const timePlan = reward ? "creator" : storedTimePlan;
  const worldCredits = Math.max(0, +state.world_credits || 0);
  const plan = timePlan || ((worldCredits || activeProjects.length) ? "world1" : "free");
  if (plan === "free" && pendingReconciliation.unavailable) throw new Error("ENTITLEMENT_UNAVAILABLE");
  const definition = PLAN_LIMITS[plan];
  const active = plan !== "free";
  const expiresAt = plan === "world1"
    ? (activeProjects.length ? Math.max(...activeProjects.map((project) => +project.expires_at || 0)) : null)
    : (timeUntil > now ? (reward ? timeUntil : (+state.plan_expires_at > now ? +state.plan_expires_at : timeUntil)) : null);
  return {
    authenticated: true, active, status: active ? "active" : "free", plan,
    plan_label: definition.label, expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    premium_until_ms: plan === "world1" ? 0 : (timeUntil > now ? timeUntil : 0),
    world_credits: worldCredits, active_world_projects: activeProjects.length,
    world_projects: activeProjects.map((project) => ({ id: project.id, expires_at: +project.expires_at })),
    max_file_mb: definition.max_file_mb, max_file_bytes: definition.max_file_bytes,
    max_batch: definition.max_batch, allowed_tools: definition.allowed_tools,
    capabilities: definition.capabilities, account_email: email,
    pending_payment: plan === "free" && pendingReconciliation.pending_payment ? {
      ...pendingReconciliation.pending_payment,
      plan_label: PLAN_LIMITS[pendingReconciliation.pending_payment.plan]?.label || "plano pago"
    } : null
  };
}

export function checkEntitlement(ent, worlds, sizeBytes, now = Date.now(), features = {}) {
  worlds = Number(worlds);
  sizeBytes = Number(sizeBytes);
  if (!Number.isSafeInteger(worlds) || worlds < 1 || worlds > 100 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    return { allowed: false, code: "INVALID_REQUEST" };
  }
  features = features && typeof features === "object" ? features : {};
  const free = PLAN_LIMITS.free;
  const tools = Array.from(new Set((Array.isArray(features.tools) ? features.tools : [features.tool || "convert"]).map((tool) => String(tool || "").trim().toLowerCase()).filter(Boolean)));
  if (!tools.length) tools.push("convert");
  if (tools.some((tool) => !KNOWN_TOOL_IDS.has(tool))) return { allowed: false, code: "TOOL_NOT_INCLUDED" };
  const knownTools = new Set(free.allowed_tools);
  const maxChunks = +free.capabilities.chunks_restore.max_chunks;
  const chunkCount = Math.max(0, Number(features.chunks_count) || 0);
  const playerAdvanced = features.player_advanced === true;
  const addPacks = Math.max(0, Math.min(1000, Number(features.add_packs) || 0));
  const toolRequiresPremium = tools.some((tool) => !knownTools.has(tool) ||
    (tool === "chunks_restore" && chunkCount > maxChunks) ||
    (tool === "player_basic" && playerAdvanced));
  const paidFeature = sizeBytes > free.max_file_bytes || worlds > free.max_batch ||
    (features.mode && String(features.mode).toLowerCase() !== "keep" && !(String(features.mode).toLowerCase() === "survival" && features.reactivate_achievements === true)) || features.hardcore === true ||
    addPacks > free.capabilities.add_behavior_packs || playerAdvanced ||
    toolRequiresPremium;

  const timeActive = +((ent && ent.premium_until_ms) || 0) > now && ent.plan !== "world1";
  if (timeActive && (!PLAN_LIMITS[ent.plan] || PLAN_LIMITS[ent.plan].kind !== "time")) {
    return { allowed: false, code: "PLAN_UNVERIFIED" };
  }
  const hasWorldBenefit = +(ent && ent.world_credits || 0) > 0 || +(ent && ent.active_world_projects || 0) > 0;
  const plan = timeActive ? ent.plan : (hasWorldBenefit ? "world1" : "free");
  const worldPlanActive = !timeActive && hasWorldBenefit;
  const planDefinition = PLAN_LIMITS[plan];
  if (tools.some((tool) => !planDefinition.allowed_tools.includes(tool))) {
    return { allowed: false, code: "TOOL_NOT_INCLUDED", plan };
  }

  if (!paidFeature && !worldPlanActive && !timeActive) {
    return { allowed: true, plan: "free", max_batch: free.max_batch, max_file_mb: free.max_file_mb,
      free_quota_tools: tools.map((tool) => ({ tool, limit: tool === "convert" ? free.capabilities.convert.daily_operations : (tool === "chunks_restore" ? free.capabilities.chunks_restore.daily_operations : (tool === "player_basic" ? free.capabilities.player.daily_operations : (tool === "builder" ? free.capabilities.builder.daily_operations : 0))) })).filter((item) => item.limit > 0) };
  }
  if (plan === "free" && ent.pending_payment) {
    return { allowed: false, code: "PAYMENT_PENDING", plan: "free", pending_plan: ent.pending_payment.plan };
  }
  if (plan === "free") return { allowed: false, code: "NO_ENTITLEMENT", plan: "free" };
  const limit = PLAN_LIMITS[plan];
  if (worlds > limit.max_batch) return { allowed: false, code: "BATCH_LIMIT", plan, max_batch: limit.max_batch };
  if (limit.max_file_bytes !== null && sizeBytes > limit.max_file_bytes) {
    return { allowed: false, code: "SIZE_LIMIT", plan, max_file_mb: limit.max_file_mb, max_file_bytes: limit.max_file_bytes };
  }
  return { allowed: true, plan, max_batch: limit.max_batch, max_file_mb: limit.max_file_mb,
    requires_credit: plan === "world1", requires_completion: plan === "world1" || !!limit.daily_operations, ...(limit.daily_operations ? {free_quota_tools:[{tool:"paid_operations",limit:limit.daily_operations}]} : {}) };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/") && env.PAYMENT_SERVICE) { const dest = new URL(url.pathname + url.search, env.PAYMENT_API_URL); return env.PAYMENT_SERVICE.fetch(new Request(dest,req)); }
    const cors = corsHeaders(req, env);
    if (req.method === "POST" && ["/api/infinitepay/create", "/api/depix/create"].includes(url.pathname)) return json({error:"Este checkout foi substituído pela AbacatePay. Atualize a página."},410,cors);
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
      if (url.pathname === "/api/admin/dashboard" && req.method === "GET") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Conta sem permissão para acessar o painel." }, 403, cors);
        const days = Math.max(1, Math.min(400, parseInt(url.searchParams.get("days") || "30", 10) || 30));
        const since = Date.now() - days * 86400000;
        const allPurchases = await adminList(env, "admin:purchases");
        const allCheckouts = await adminList(env, "admin:checkouts");
        const allManualGrants = await adminList(env, "admin:actions");
        const errors = await adminList(env, "clog");
        const purchases = allPurchases.filter((item) => (+item.paid_at || +item.at || 0) >= since);
        const manualGrants = allManualGrants.filter((item) => (+item.at || 0) >= since);
        const checkouts = allCheckouts.filter((item) => (+item.at || 0) >= since).map((item) => ({ ...item, status: classifyAdminCheckout(item) }));
        const abandoned = checkouts.filter((item) => item.status === "abandoned");
        const pending = checkouts.filter((item) => item.status === "pending");
        const revenue = purchases.reduce((sum, item) => sum + (+item.amount_cents || 0), 0);
        const decided = purchases.length + abandoned.length;
        return json({
          admin_email: admin.email,
          period_days: days,
          summary: {
            paid_count: purchases.length,
            revenue_cents: revenue,
            abandoned_count: abandoned.length,
            pending_count: pending.length,
            conversion_percent: decided ? Math.round(purchases.length * 1000 / decided) / 10 : 0
          },
          purchases: purchases.slice(0, 150),
          manual_grants: manualGrants.slice(0, 150),
          abandoned: abandoned.slice(0, 150),
          pending: pending.slice(0, 100),
          errors: summarizeAdminErrors(errors.filter((item) => (+item.at || 0) >= since))
        }, 200, cors);
      }

      if (url.pathname === "/api/admin/grant" && req.method === "POST") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Conta sem permissão para liberar planos." }, 403, cors);
        if (!(await rlTake(env, "rl-admin-grant:" + admin.uid, 60, 86400))) return json({ error: "Limite diário de liberações atingido." }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const email = String(body.email || "").trim().toLowerCase();
        const rawPlan = String(body.plan || "");
        const plan = rawPlan === "vip24h" ? "vip24h" : normalizeDepixPlan(rawPlan);
        const reason = String(body.reason || "").trim().slice(0, 160);
        if (!validEmail(email)) return json({ error: "Informe um e-mail válido." }, 400, cors);
        if (!["world1", "vip24h", "vip7", "vip30", "creator"].includes(rawPlan)) return json({ error: "Plano inválido." }, 400, cors);
        if (reason.length < 3) return json({ error: "Informe o motivo da liberação." }, 400, cors);
        const billingId = "manual:" + Date.now() + ":" + crypto.randomUUID();
        const grant = await grantPurchase(env, email, billingId, plan, "", "manual");
        await recordAdminAction(env, { admin: admin.email, email, plan, reason, billing_id: billingId });
        return json({ ok: true, email, plan, premium_until_ms: grant.premium_until_ms, world_credits: grant.world_credits }, 200, cors);
      }

      if (url.pathname === "/api/admin/depix/reconcile" && req.method === "POST") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Conta sem permissão para reconciliar pagamentos." }, 403, cors);
        if (!(await rlTake(env, "rl-admin-reconcile:" + admin.uid, 30, 3600))) return json({ error: "Muitas reconciliações. Aguarde alguns minutos." }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { body = {}; }
        const requestedId = String(body.id || "").trim().slice(0, 180);
        let reconciliation;
        if (requestedId) {
          try {
            const result = await reconcileDepixCheckout(env, requestedId);
            reconciliation = { checked: 1, recovered: result.paid ? 1 : 0, results: [result] };
          } catch (error) {
            reconciliation = { checked: 1, recovered: 0, results: [{ id: requestedId, paid: false, error: String((error && error.message) || error).slice(0, 240) }] };
          }
        } else {
          reconciliation = await reconcileRecentDepixCheckouts(env);
        }
        const { checked, recovered, results } = reconciliation;
        await recordAdminAction(env, { admin: admin.email, email: "reconcile", plan: "vip30", reason: "Reconciliação Depix: " + recovered + " pagamento(s)", billing_id: requestedId || "recentes" });
        return json({ ok: true, checked, recovered, results }, 200, cors);
      }

      if (url.pathname === "/api/audit/events" && req.method === "POST") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const type = String(body.event_type || "");
        if (!AUDIT_CLIENT_TYPES.has(type)) return json({ error: "Tipo de evento não permitido." }, 400, cors);
        if (["session_started", "page_viewed", "tool_viewed", "pricing_viewed"].includes(type)) return json({ accepted: false, event_id: "" }, 202, cors);
        const auditRate = env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName("audit-rate:" + fb.uid));
        const permit = await auditRate.fetch("https://entitlements/audit-limit", { method: "POST" });
        if (!permit.ok) return json({ error: "Aguarde antes de enviar novos eventos." }, 429, cors);
        const purchaseId = auditText(body.purchase_id, 180);
        if (purchaseId) {
          const purchases = await adminList(env, "admin:purchases");
          const purchase = purchases.find((item) => String(item.id) === purchaseId);
          if (!purchase || !supportPurchaseForUser(purchase, fb)) return json({ error: "Compra não pertence a esta conta." }, 403, cors);
        }
        const metadata = auditMetadata(body.metadata);
        const ua = String(req.headers.get("User-Agent") || "");
        metadata.browser = browserType(ua);
        metadata.browser_version = browserVersion(ua);
        metadata.os = operatingSystem(ua);
        metadata.device_type = deviceType(ua);
        metadata.language = auditText(body.device && body.device.language, 40);
        metadata.timezone = auditText(body.device && body.device.timezone, 60);
        metadata.screen_resolution = auditText(body.device && body.device.screen_resolution, 24);
        const event = await auditWriteEvent(env, {
          uid: fb.uid, type, trust: "client", session_id: body.session_id, purchase_id: purchaseId,
          operation_id: body.operation_id, file_id: body.file_id, page: body.page, tool: body.tool,
          app_version: body.app_version, status: body.status, metadata
        });
        return json({ accepted: !!event, event_id: event && event.event_id || "" }, event ? 202 : 503, cors);
      }

      if (url.pathname === "/api/support/mine" && req.method === "GET") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        const purchases = await adminList(env, "admin:purchases");
        const mine = purchases.filter((item) => supportPurchaseForUser(item, fb)).slice(0, 50).map((item) => ({
          id: String(item.id || ""), plan: normalizeDepixPlan(item.plan), amount_cents: +item.amount_cents || 0,
          provider: auditText(item.provider, 30), paid_at: +item.paid_at || +item.at || 0
        }));
        const cases = await supportList(env, "support:user:" + fb.uid + ":", 50);
        const events = await auditList(env, "audit:user:" + fb.uid + ":", 300);
        const usage = events.filter((event) => ["tool_opened", "operation_started", "operation_completed", "operation_failed", "file_analysis_failed", "download_failed"].includes(event.event_type))
          .map((event) => ({ tool: event.tool, operation_id: event.operation_id, file_id: event.file_id, timestamp: event.timestamp, event_type: event.event_type, metadata: event.metadata }));
        return json({ purchases: mine, usage, cases: cases.map(({ id, status, kind, reason, created_at, updated_at, public_message }) => ({ id, status, kind, reason, created_at, updated_at, public_message })) }, 200, cors);
      }

      if (url.pathname === "/api/support/submit" && req.method === "POST") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre na mesma conta Google usada na compra." }, 401, cors);
        if (!(await rlTake(env, "rl-support:" + fb.uid, 5, 86400))) return json({ error: "Você já enviou solicitações hoje. Atualize o caso existente ou aguarde." }, 429, cors);
        if (+req.headers.get("Content-Length") > 3000000) return json({ error: "Anexos grandes demais." }, 413, cors);
        let body = {};
        try { const text = await req.text(); if (text.length > 3000000) return json({ error: "Anexos grandes demais." }, 413, cors); body = JSON.parse(text); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const kind = body.kind === "refund" ? "refund" : "support";
        const purchaseId = auditText(body.purchase_id, 180);
        const purchases = await adminList(env, "admin:purchases");
        const purchase = purchaseId ? purchases.find((item) => String(item.id) === purchaseId) : { email: fb.email, uid: fb.uid, plan: "free", amount_cents: 0 };
        if ((!purchaseId && kind === "refund") || !purchase || !supportPurchaseForUser(purchase, fb)) return json({ error: "Selecione uma compra vinculada à sua conta para solicitar reembolso." }, 403, cors);
        const openKey = "support:open:" + (purchaseId || "user:" + fb.uid);
        const reasons = new Set(["payment_not_granted", "tool_error", "incorrect_result", "download_failed", "file_rejected", "wrong_plan", "duplicate_purchase", "could_not_use", "cancel", "other"]);
        const reason = reasons.has(String(body.reason || "")) ? String(body.reason) : "other";
        const description = auditText(body.description, 2400);
        if (description.length < 8) return json({ error: "Explique brevemente o que aconteceu (mínimo de 8 caracteres)." }, 400, cors);
        let attachments;
        try { attachments = supportFilesShape(body.attachments || []); }
        catch (error) { return json({ error: String(error.message || error) }, 400, cors); }
        const existingId = await env.PREMIUM_KV.get(openKey);
        if (existingId) {
          const existing = await env.PREMIUM_KV.get("support:case:" + existingId, "json").catch(() => null);
          if (existing && supportStatusOpen(existing.status)) return json({ id: existing.id, duplicate: true, status: existing.status }, 200, cors);
        }
        const id = "REF_" + crypto.randomUUID().replace(/-/g, "").slice(0, 18).toUpperCase();
        const createdAt = Date.now();
        const caseItem = {
          id, uid: fb.uid, email: fb.email, purchase_id: purchaseId,
          purchase: { plan: normalizeDepixPlan(purchase.plan) || "free", amount_cents: +purchase.amount_cents || 0, provider: auditText(purchase.provider, 30), paid_at: +purchase.paid_at || +purchase.at || 0 },
          kind, reason, description, expected: auditText(body.expected, 1200), actual: auditText(body.actual, 1200),
          tool: auditText(body.tool, 60), operation_id: auditText(body.operation_id, 120),
          status: "received", created_at: createdAt, updated_at: createdAt,
          public_message: "Recebemos sua solicitação. Vamos analisar e responder por esta página.",
          attachment_meta: attachments.map(({ id: attachmentId, name, mime, size_bytes }) => ({ id: attachmentId, name, mime, size_bytes })),
          history: [{ at: createdAt, action: "submitted", actor: "user", uid: fb.uid, note: "Solicitação recebida" }]
        };
        const existingEvents = await auditList(env, "audit:user:" + fb.uid + ":", 500);
        const related = existingEvents.filter((event) => (event.purchase_id === purchaseId || (!event.purchase_id && event.timestamp >= caseItem.purchase.paid_at)) && event.timestamp <= createdAt);
        caseItem.evidence = {
          event_count: related.length,
          operations_completed: related.filter((event) => event.event_type === "operation_completed").length,
          operations_failed: related.filter((event) => event.event_type === "operation_failed" || event.event_type === "file_analysis_failed" || event.event_type === "client_error").length,
          results_generated: related.filter((event) => event.event_type === "result_generated").length,
          downloads_requested: related.filter((event) => event.event_type === "download_requested" || event.event_type === "download_response_completed").length,
          payment_confirmed: !!purchaseId,
          benefit_granted: related.some((event) => event.event_type === "plan_granted" && event.purchase_id === purchaseId),
          tags: supportTags({ payment_confirmed: !!purchaseId, benefit_granted: related.some((event) => event.event_type === "plan_granted" && event.purchase_id === purchaseId) }, related)
        };
        await env.PREMIUM_KV.put("support:case:" + id, JSON.stringify(caseItem), { expirationTtl: 400 * 86400 });
        const index = auditIndexTime(createdAt) + ":" + id;
        await env.PREMIUM_KV.put("support:admin:" + index, id, { expirationTtl: 400 * 86400 });
        await env.PREMIUM_KV.put("support:user:" + fb.uid + ":" + index, id, { expirationTtl: 400 * 86400 });
        await env.PREMIUM_KV.put(openKey, id, { expirationTtl: 400 * 86400 });
        for (const file of attachments) await env.PREMIUM_KV.put("support:file:" + id + ":" + file.id, JSON.stringify({ id: file.id, name: file.name, mime: file.mime, size_bytes: file.size_bytes, data_url: "data:" + file.mime + ";base64," + file.data }), { expirationTtl: 90 * 86400 });
        await auditWriteEvent(env, { uid: fb.uid, type: "refund_request_created", trust: "server", purchase_id: purchaseId, refund_request_id: id, status: "received", metadata: { refund_kind: kind, reason, tool: caseItem.tool } });
        return json({ id, status: "received", duplicate: false }, 201, cors);
      }

      if (url.pathname === "/api/admin/support" && req.method === "GET") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Acesso restrito." }, 403, cors);
        const status = auditText(url.searchParams.get("status"), 32);
        const cases = await supportList(env, "support:admin:", 200);
        return json({ cases: cases.filter((item) => !status || item.status === status).map((item) => ({
          id: item.id, email: item.email, purchase_id: item.purchase_id, purchase: item.purchase,
          kind: item.kind, reason: item.reason, tool: item.tool, status: item.status,
          evidence: item.evidence, created_at: item.created_at, updated_at: item.updated_at
        })) }, 200, cors);
      }

      if (url.pathname === "/api/admin/customer/activity" && req.method === "POST") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Acesso restrito." }, 403, cors);
        if (!(await rlTake(env, "rl-admin-activity:" + admin.uid, 120, 3600))) return json({ error: "Muitas consultas de atividade. Aguarde alguns minutos." }, 429, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "Solicitação inválida." }, 400, cors); }
        const email = String(body.email || "").trim().toLowerCase();
        if (!validEmail(email)) return json({ error: "Informe um e-mail válido." }, 400, cors);
        const allPurchases = await adminList(env, "admin:purchases");
        const userPurchases = allPurchases.filter((item) => String(item.email || "").trim().toLowerCase() === email);
        const purchases = userPurchases
          .sort((a, b) => (+b.paid_at || +b.at || 0) - (+a.paid_at || +a.at || 0))
          .slice(0, 50)
          .map((item) => ({ id: item.id, at: +item.paid_at || +item.at || 0, plan: item.plan, amount_cents: +item.amount_cents || 0, provider: item.provider || "", source: item.source || "" }));
        const uids = [...new Set(userPurchases
          .map((item) => String(item.uid || "").trim()).filter(Boolean))].slice(0, 3);
        const events = (await Promise.all(uids.map((uid) => auditList(env, "audit:user:" + uid + ":", 100))))
          .flat().sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
        return json({ email, purchases, events, event_limit: 100, audit_retention_days: 400 }, 200, cors);
      }

      if (url.pathname === "/api/admin/support/detail" && req.method === "GET") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Acesso restrito." }, 403, cors);
        const id = auditText(url.searchParams.get("id"), 80);
        const item = await env.PREMIUM_KV.get("support:case:" + id, "json").catch(() => null);
        if (!item) return json({ error: "Caso não encontrado." }, 404, cors);
        const events = await auditList(env, "audit:user:" + item.uid + ":", 100);
        const timeline = events.filter((event) => event.purchase_id === item.purchase_id || (!event.purchase_id && event.timestamp >= item.purchase.paid_at && event.timestamp <= item.created_at));
        const attachments = await Promise.all((item.attachment_meta || []).map((file) => env.PREMIUM_KV.get("support:file:" + id + ":" + file.id, "json").catch(() => null)));
        const history = [];
        let cursor;
        do {
          const page = await env.PREMIUM_KV.list({ prefix: "support:history:" + id + ":", cursor, limit: 100 });
          for (const row of page.keys || []) {
            const entry = await env.PREMIUM_KV.get(row.name, "json").catch(() => null);
            if (entry) history.push(entry);
          }
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor && history.length < 100);
        return json({ case: item, timeline, attachments: attachments.filter(Boolean), history: history.sort((a, b) => a.at - b.at) }, 200, cors);
      }

      if (url.pathname === "/api/admin/support/decision" && req.method === "POST") {
        const admin = await adminUser(req, env);
        if (!admin) return json({ error: "Acesso restrito." }, 403, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const id = auditText(body.id, 80);
        const action = String(body.action || "");
        const allowed = new Set(["in_review", "waiting_customer", "problem_resolved", "refund_approved", "refund_denied", "refund_completed"]);
        const reason = auditText(body.reason, 1000);
        if (!allowed.has(action) || reason.length < 3) return json({ error: "Escolha uma ação e informe a justificativa obrigatória." }, 400, cors);
        const item = await env.PREMIUM_KV.get("support:case:" + id, "json").catch(() => null);
        if (!item) return json({ error: "Caso não encontrado." }, 404, cors);
        const oldStatus = item.status;
        item.status = action;
        item.updated_at = Date.now();
        item.public_message = auditText(body.public_message || "Atualizamos sua solicitação. Consulte esta página para ver a resposta.", 500);
        if (["refund_approved", "refund_completed"].includes(action)) {
          item.refund_decision = { decision: action, admin: admin.email, at: item.updated_at, reason, public_message: item.public_message,
            amount_refunded_cents: Math.min(+item.purchase.amount_cents || 0, Math.max(0, +body.amount_refunded_cents || (action === "refund_completed" ? +item.purchase.amount_cents || 0 : 0))),
            fee_loss_cents: Math.max(0, +body.fee_loss_cents || 0) };
        }
        const history = { id: "HIS_" + crypto.randomUUID().replace(/-/g, "").slice(0, 18), at: item.updated_at, action, actor: admin.email, reason, previous_status: oldStatus, public_message: item.public_message };
        item.history = Array.isArray(item.history) ? item.history : [];
        item.history.push(history);
        await env.PREMIUM_KV.put("support:case:" + id, JSON.stringify(item), { expirationTtl: 400 * 86400 });
        await env.PREMIUM_KV.put("support:history:" + id + ":" + auditIndexTime(item.updated_at) + ":" + history.id, JSON.stringify(history), { expirationTtl: 400 * 86400 });
        if (!supportStatusOpen(action)) await env.PREMIUM_KV.delete("support:open:" + (item.purchase_id || "user:" + item.uid)).catch(() => {});
        const eventType = action === "refund_approved" ? "refund_approved" : action === "refund_denied" ? "refund_denied" : action === "refund_completed" ? "refund_completed" : "support_status_changed";
        await auditWriteEvent(env, { uid: item.uid, type: eventType, trust: "server", purchase_id: item.purchase_id, refund_request_id: id, status: action, metadata: { reason, refund_kind: item.kind } });
        return json({ ok: true, id, status: action }, 200, cors);
      }

      if (url.pathname === "/api/config" && req.method === "GET") {
        return json({ payment_provider: "abacate", sales_enabled: String(env.SALES_ENABLED || "1") !== "0", infinitepay_configured: false, abacate_configured: !!(env.ABACATEPAY_V4_API_KEY || env.ABACATEPAY_API_KEY), abacate_world1_configured: !!env.ABACATEPAY_PRODUCT_ID_WORLD1, product_configured: !!env.ABACATEPAY_PRODUCT_ID, product24h_configured: !!env.ABACATEPAY_PRODUCT_ID_24H, premium_days: PLAN_LIMITS.vip30.duration_days, accounts: true, firebase_auth: !!env.FIREBASE_WEB_API_KEY, depix_configured: !!env.DEPIX_API_KEY, depix_test_mode: String(env.DEPIX_TEST_MODE || "") === "1" || String(env.DEPIX_API_KEY || "").startsWith("sk_test_"), terms_version: TERMS_VERSION, free_daily: FREE_DAILY, world_project_window_days: PLAN_LIMITS.world1.project_window_days, catalog_version: "worldify-v4", display_plan_ids: [...PURCHASABLE_PLAN_IDS], purchasable_plan_ids: [...PURCHASABLE_PLAN_IDS], plans: PUBLIC_PLAN_CATALOG }, 200, cors);
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
        const fb = await firebaseUser(req, env);
        const day = new Date().toISOString().slice(0, 10);
        const identity = quotaIdentity(req, fb);
        if (env.ENTITLEMENTS) {
          const stub = fb ? await entitlementStub(env, fb.uid, fb.email) : env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName("free:" + identity));
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
        return json({ allowed: used < FREE_DAILY, used, remaining: Math.max(0, FREE_DAILY - used) }, body.consume === true && used >= FREE_DAILY ? 402 : 200, cors);
      }

      // ---------- Depix: criar checkout Pix ----------
      if (url.pathname === "/api/depix/create" && req.method === "POST") {

        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const plan = normalizeDepixPlan(body.plan);
        if (!PURCHASABLE_PLAN_IDS.has(plan)) return json({ error: "Plano inválido ou indisponível para compra." }, 400, cors);
        const source = cleanDimension(body.source, 40);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com sua conta Google para continuar." }, 401, cors);
        const email = fb.email;
        const name = fb.name;
        const uid = fb.uid;
        const requestId = String(body.request_id || "").trim().slice(0, 100);
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return json({ error: "Identificador seguro do checkout ausente. Reabra o checkout e tente novamente." }, 400, cors);
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
        const checkoutStub = await entitlementStub(env, uid, email);
        const begin = await checkoutStub.fetch("https://entitlements/checkout-begin", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, plan, provider: "depix" })
        });
        const beginData = await begin.json();
        if (!begin.ok) return json({ error: beginData.error || "Este checkout já foi iniciado. Aguarde o resultado antes de tentar outra vez.", pending: beginData.pending === true }, begin.status, cors);
        let providerRequestId = requestId;
        if (beginData.retry_request_id) {
          providerRequestId = String(beginData.retry_request_id).slice(0, 100);
          const retryBegin = await checkoutStub.fetch("https://entitlements/checkout-begin", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: providerRequestId, plan, provider: "depix" })
          });
          const retryData = await retryBegin.json();
          if (!retryBegin.ok) return json({ error: retryData.error || "Este checkout esta em verificacao.", pending: retryData.pending === true }, retryBegin.status, cors);
          Object.assign(beginData, retryData);
        }
        if (!beginData.create) return json(beginData.result, 200, cors);
        try {
          const r = await depixCreate(env, email, name, uid, plan, doc, payerEmail, req, providerRequestId);
          const saved = await checkoutStub.fetch("https://entitlements/checkout-result", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: providerRequestId, plan, result: r })
          });
          if (!saved.ok) throw new Error("Cobrança iniciada, mas não consegui guardar o checkout. Não tente pagar novamente; atualize o status em alguns instantes.");
          await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({
            uid, email, at: Date.now(), plan, source, via: "depix",
            terms_version: TERMS_VERSION, client_terms_version: String(body.terms_version || "").slice(0, 40), terms_accepted_at: Date.now()
          }), { expirationTtl: 30 * 86400 }).catch(() => {});
          await recordCheckout(env, { id: r.id, uid, email, plan, source, provider: "depix", expires_at: r.expires_at });
          await metric(env, "payment_pending", { plan, source }, req);
          await metric(env, "pix_create_success", { plan, source }, req);
          return json(r, 200, cors);
        } catch (e) {
          return json({ error: String((e && e.message) || e) }, 502, cors);
        }
      }

      // ---------- InfinitePay: checkout e confirmação server-to-server ----------
      if (url.pathname === "/api/infinitepay/create" && req.method === "POST") {
        if (String(env.SALES_ENABLED || "1") === "0" || !env.INFINITEPAY_HANDLE) return json({ error: "As vendas estão temporariamente suspensas. Os acessos já pagos continuam válidos até a expiração do plano." }, 503, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const plan = normalizeDepixPlan(body.plan);
        if (!PURCHASABLE_PLAN_IDS.has(plan)) return json({ error: "Plano inválido ou indisponível para compra." }, 400, cors);
        if (body.terms_accepted !== true) return json({ error: "Você precisa aceitar os Termos de Uso e a Política de Reembolso antes de pagar." }, 400, cors);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com sua conta Google para continuar." }, 401, cors);
        const requestId = String(body.request_id || "").trim().slice(0, 100);
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return json({ error: "Identificador seguro do checkout ausente. Reabra o checkout e tente novamente." }, 400, cors);
        const ip = req.headers.get("CF-Connecting-IP") || "unknown";
        if (!(await rlTake(env, "rl-infinitepay-v1:" + fb.uid + ":" + ip, 12, 900))) return json({ error: "Muitas tentativas em poucos minutos. Aguarde e tente novamente." }, 429, cors);
        const source = cleanDimension(body.source, 40);
        const checkoutStub = await entitlementStub(env, fb.uid, fb.email);
        const begin = await checkoutStub.fetch("https://entitlements/checkout-begin", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: requestId, plan, provider: "infinitepay" })
        });
        let beginData = await begin.json();
        if (!begin.ok) return json({ error: beginData.error || "Este checkout já está em andamento.", code: beginData.code, retry_after: beginData.retry_after, pending: beginData.pending === true, existing_checkout: beginData.existing_checkout || null }, begin.status, cors);
        if (!beginData.create) {
          if (beginData.result && beginData.result.id && isValidInfinitePayCheckoutUrl(beginData.result.url)) return json(beginData.result, 200, cors);
          // A reusable checkout can outlive a failed/legacy provider response.
          // Invalidate only a result that cannot point to an official InfinitePay checkout.
          const staleRequestId = String(beginData.checkout_request_id || requestId);
          await checkoutStub.fetch("https://entitlements/checkout-failed", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: staleRequestId, plan, retryable: true, error: "Saved InfinitePay checkout URL failed official-host validation." })
          });
          const retry = await checkoutStub.fetch("https://entitlements/checkout-begin", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: requestId, plan, provider: "infinitepay" })
          });
          beginData = await retry.json();
          if (!retry.ok) return json({ error: beginData.error || "Não consegui renovar o link seguro. Atualize Minha conta e tente novamente.", pending: beginData.pending === true }, retry.status, cors);
          if (!beginData.create) {
            if (beginData.result && isValidInfinitePayCheckoutUrl(beginData.result.url)) return json(beginData.result, 200, cors);
            return json({ error: "A InfinitePay não retornou um link seguro válido. Nenhuma nova cobrança foi criada; tente novamente em instantes." }, 502, cors);
          }
        }
        try {
          const orderNsu = crypto.randomUUID();
          // Persist ownership before calling the provider, including when its
          // response is lost or a webhook arrives before the link is returned.
          await saveInfinitePayOrder(env, { order_nsu: orderNsu, uid: fb.uid, email: fb.email, at: Date.now(), plan, source, via: "infinitepay", status: "pending" });
          const checkout = await infinitePayCreate(env, { orderNsu, plan, email: fb.email, name: fb.name, uid: fb.uid });
          const saved = await checkoutStub.fetch("https://entitlements/checkout-result", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: requestId, plan, result: checkout })
          });
          if (!saved.ok) throw new Error("Checkout criado, mas não foi possível registrar o pedido.");
          // Legacy fallback only; quota exhaustion must not hide a valid link.
          await env.PREMIUM_KV.put(pendKey(orderNsu), JSON.stringify({ uid: fb.uid, email: fb.email, at: Date.now(), plan, source, via: "infinitepay" }), { expirationTtl: 30 * 86400 }).catch(() => {});
          await recordCheckout(env, { id: orderNsu, uid: fb.uid, email: fb.email, plan, source, provider: "infinitepay", expires_at: Date.now() + 30 * 86400000 });
          await metric(env, "payment_pending", { plan, source }, req);
          return json(checkout, 200, cors);
        } catch (e) {
          if (e && e.retryable === true) {
            await checkoutStub.fetch("https://entitlements/checkout-failed", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ request_id: requestId, plan, retryable: true, error: String(e.message || e).slice(0, 200) })
            }).catch(() => {});
          }
          return json({ error: String((e && e.message) || e) }, 502, cors);
        }
      }

      if (url.pathname === "/api/infinitepay/webhook" && req.method === "POST") {
        let event = {};
        try { event = await req.json(); } catch { return json({ success: false, message: "JSON inválido." }, 400, cors); }
        const orderNsu = String(event.order_nsu || "").trim().slice(0, 100);
        const transactionNsu = String(event.transaction_nsu || "").trim().slice(0, 120);
        const slug = String(event.invoice_slug || event.slug || "").trim().slice(0, 120);
        if (!orderNsu || !transactionNsu || !slug) return json({ success: false, message: "Dados do pedido incompletos." }, 400, cors);
        try {
          const result = await fulfillInfinitePayOrder(env, { orderNsu, transactionNsu, slug });
          if (!result.paid) return json({ success: false, message: "Pagamento ainda não confirmado." }, 400, cors);
          return json({ success: true, message: null }, 200, cors);
        } catch (e) {
          console.log("infinitepay webhook erro: " + String((e && e.message) || e));
          return json({ success: false, message: "Pagamento será conciliado após nova tentativa." }, 400, cors);
        }
      }

      if (url.pathname === "/api/infinitepay/status" && req.method === "GET") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com a mesma conta Google usada na compra." }, 401, cors);
        const orderNsu = String(url.searchParams.get("order_nsu") || "").trim().slice(0, 100);
        const transactionNsu = String(url.searchParams.get("transaction_nsu") || "").trim().slice(0, 120);
        const slug = String(url.searchParams.get("slug") || "").trim().slice(0, 120);
        if (!orderNsu || !transactionNsu || !slug) return json({ error: "Dados de retorno do checkout incompletos." }, 400, cors);
        try {
          const result = await fulfillInfinitePayOrder(env, { orderNsu, transactionNsu, slug, expectedUid: fb.uid, expectedEmail: fb.email });
          return json(result, 200, cors);
        } catch (e) {
          const msg = String((e && e.message) || e);
          return json({ error: msg, code: /outra conta/.test(msg) ? "PURCHASE_ACCOUNT_MISMATCH" : "PAYMENT_PENDING" }, /outra conta/.test(msg) ? 403 : 202, cors);
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
          const out = { id, status: info.status, paid: info.paid, email: info.email, plan: info.plan };
          let email = info.email;
          let uid = info.uid || "";
          let pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
          if (info.uid && pend && pend.uid && String(info.uid) !== String(pend.uid)) {
            return json({ error: "Esta cobrança não corresponde à identidade gravada no checkout." }, 403, cors);
          }
          if (pend && pend.email && !email) email = String(pend.email).toLowerCase();
          if (pend && pend.uid && !uid) uid = String(pend.uid);
          const ownerUid = String(info.uid || (pend && pend.uid) || "");
          if (ownerUid ? ownerUid !== fb.uid : (email && email !== fb.email)) {
            return json({ error: "Esta cobrança pertence a outra conta Google." }, 403, cors);
          }
          const plan = normalizeDepixPlan((pend && pend.plan) || info.plan);
          if (info.paid && !plan) return json({ error: "Pagamento confirmado, mas o plano não pôde ser identificado. Entre em contato com o suporte sem fazer outra compra." }, 409, cors);
          out.plan = plan;
          out.source = String((pend && pend.source) || "").slice(0, 80);
          if (email) out.email = email;
          if (info.paid && email) {
            const receipt = await persistConfirmedPayment(env, { id, email, plan, uid, provider: "depix", source: pend && pend.source, paid_at: info.paid_at });
            const grant = await grantPurchase(env, email, id, plan, uid, "depix", info.paid_at, pend && pend.source);
            await env.PREMIUM_KV.delete(receipt.key);
            await recordPaidCheckout(env, { id, email, uid, plan, provider: "depix", source: pend && pend.source });
            out.premium_until_ms = grant.premium_until_ms;
            out.world_credits = grant.world_credits;
            out.amount_cents = PLAN_PRICES[plan] || 0;
            await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
          }
          return json(out, 200, cors);
        } catch (e) {
          console.log("depix status erro: " + cleanDimension((e && e.message) || e, 120));
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
        try {
          const lst = (await env.PREMIUM_KV.get("dlog", "json").catch(() => null)) || [];
          lst.unshift({ at: Date.now(), type: String(evt.type || evt.event || "").slice(0, 60), id: bid.slice(0, 40), status: status.slice(0, 30) });
          await env.PREMIUM_KV.put("dlog", JSON.stringify(lst.slice(0, 50))).catch(() => {});
        } catch (e) {}
        if (bid) {
          try {
            const reconciled = await reconcileDepixCheckout(env, bid);
            if (reconciled.paid === false) return json({ ok: true, paid: false }, 200, cors);
          } catch (e) { console.log("depix webhook erro: " + (e && e.message)); return json({ error: "Pagamento confirmado ou pendente de concessão; o recibo será reconciliado." }, 503, cors); }
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
        const rawMessage = String(body.message || "").toLowerCase();
        const safeMessage = /cpf|cnpj|document/.test(rawMessage) ? "document_error"
          : /email|e-mail/.test(rawMessage) ? "email_error"
          : /timeout|timed out/.test(rawMessage) ? "timeout"
          : /failed to fetch|network|conex/.test(rawMessage) ? "network"
          : /401|auth|conta google/.test(rawMessage) ? "authentication"
          : /429|rate|tentativas/.test(rawMessage) ? "rate_limited"
          : /5\d\d|provider|depix|abacate/.test(rawMessage) ? "payment_provider"
          : "client_error";
        let page = "/";
        try { page = new URL(String(body.href || "/"), url.origin).pathname.slice(0, 120) || "/"; } catch (e) {}
        const entry = {
          at: Date.now(),
          step: new Set(["selftest", "depix-create", "create-alt"]).has(String(body.step || "")) ? String(body.step) : "other",
          msg: safeMessage,
          href: page
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
        const plan = PLAN_LIMITS[String(body.plan || "")] ? String(body.plan) : "";
        const source = TELEMETRY_SOURCES.has(String(body.source || "")) ? String(body.source) : "";
        const reason = TELEMETRY_REASONS.has(String(body.reason || "")) ? String(body.reason) : "";
        const error_type = TELEMETRY_ERRORS.has(String(body.error_type || "")) ? String(body.error_type) : "";
        await metric(env, event, { plan, source, reason, error_type }, req);
        return json({ ok: true }, 200, cors);
      }
      // ---------- criar checkout ----------
      if (url.pathname === "/api/abacate/create" && req.method === "POST") {
        if (String(env.SALES_ENABLED || "1") === "0") return json({error:"As vendas estão temporariamente suspensas."},503,cors);

        if (!(env.ABACATEPAY_V4_API_KEY || env.ABACATEPAY_API_KEY)) return json({ error: "Pagamento não configurado no servidor." }, 502, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const requestedPlan = normalizeDepixPlan(body.plan);
        if (!requestedPlan) return json({ error: "Plano inválido." }, 400, cors);
        if (!PURCHASABLE_PLAN_IDS.has(requestedPlan)) return json({error:"Oferta antiga encerrada. Atualize os planos antes de comprar."},400,cors);
        const source = TELEMETRY_SOURCES.has(String(body.source || "")) ? String(body.source) : "";
        const providerPlan = requestedPlan;
        if (providerPlan === "world1" && !env.ABACATEPAY_PRODUCT_ID_WORLD1) return json({ error: "Produto Resolver 1 mundo não configurado no servidor." }, 502, cors);
        if (providerPlan === "vip30" && !env.ABACATEPAY_PRODUCT_ID) return json({ error: "Produto não configurado no servidor." }, 502, cors);
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Entre novamente com sua conta Google para continuar." }, 401, cors);
        const requestId = String(body.request_id || "").trim().slice(0, 100);
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) return json({ error: "Identificador seguro do checkout ausente. Reabra o checkout e tente novamente." }, 400, cors);
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
        const checkoutStub = await entitlementStub(env, uid, email);
        const begin = await checkoutStub.fetch("https://entitlements/checkout-begin", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, plan: requestedPlan, provider: "abacate" })
        });
        const beginData = await begin.json();
        if (!begin.ok) return json({ error: beginData.error || "Este checkout já foi iniciado. Aguarde o resultado.", pending: beginData.pending === true }, begin.status, cors);
        if (!beginData.create) return json(beginData.result, 200, cors);
        try {
          const origin = req.headers.get("Origin") || "";
          const r = await abacateCreate(env, email, name, uid, origin.startsWith("http") ? origin : "", providerPlan);
          const safe = { id: r.id, url: r.url, plan: requestedPlan, expires_at: r.expires_at };
          const saved = await checkoutStub.fetch("https://entitlements/checkout-result", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, plan: requestedPlan, result: safe })
          });
          if (!saved.ok) throw new Error("Checkout iniciado, mas não consegui guardar o link. Não gere outra cobrança; consulte o suporte.");
          await env.PREMIUM_KV.put(pendKey(r.id), JSON.stringify({
            uid, email, at: Date.now(), plan: requestedPlan, source, via: "abacate",
            terms_version: TERMS_VERSION, client_terms_version: String(body.terms_version || "").slice(0, 40), terms_accepted_at: Date.now()
          }), { expirationTtl: 30 * 86400 }).catch(() => {});
          await recordCheckout(env, { id: r.id, uid, email, plan: requestedPlan, provider: "abacate", source, expires_at: r.expires_at });
          return json(safe, 200, cors);
        } catch (e) {
          await checkoutStub.fetch("https://entitlements/checkout-failed", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: requestId, plan: requestedPlan, error: String((e && e.message) || e).slice(0, 200) })
          }).catch(() => {});
          return json({ error: String((e && e.message) || e) }, 502, cors);
        }
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
        const out = { id, status: info.status, paid: info.paid, email: info.email };
        let pend = await env.PREMIUM_KV.get(pendKey(id), "json").catch(() => null);
        let email = String(info.email || (pend && pend.email) || "").toLowerCase();
        if (pend && info.uid && pend.uid && String(pend.uid) !== info.uid) return json({ error: "Esta cobrança pertence a outra conta Google." }, 403, cors);
        if (pend && info.email && pend.email && String(pend.email).toLowerCase() !== String(info.email).toLowerCase()) return json({ error: "A identidade desta cobrança não confere com o checkout." }, 403, cors);
        const ownerUid = String(info.uid || (pend && pend.uid) || "");
        if (ownerUid ? ownerUid !== fb.uid : (email && email !== fb.email)) {
          return json({ error: "Esta cobrança pertence a outra conta Google." }, 403, cors);
        }
        if (!ownerUid && !email) return json({ error: "Não consegui associar esta cobrança à sua conta Google." }, 409, cors);
        if (info.paid && email) {
          out.plan = normalizeDepixPlan((pend && pend.plan) || info.plan);
          out.source = String((pend && pend.source) || "").slice(0, 80);
          if (!out.plan) return json({ error: "Pagamento confirmado, mas o plano não pôde ser identificado. Entre em contato com o suporte sem fazer outra compra." }, 409, cors);
          if (info.plan && info.plan !== out.plan) return json({ error: "O plano confirmado não corresponde ao checkout. Entre em contato com o suporte sem fazer outra compra." }, 409, cors);
          if (PURCHASABLE_PLAN_IDS.has(out.plan) && (info.amount !== PLAN_LIMITS[out.plan].price_cents || info.paidAmount !== PLAN_LIMITS[out.plan].price_cents || info.devMode)) return json({error:"Valor confirmado não corresponde ao plano. Contate o suporte."},409,cors);
          const uid = String(info.uid || (pend && pend.uid) || fb.uid);
          const paidAt = timestampMs(info.paid_at);
          const receipt = await persistConfirmedPayment(env, { id, email, uid, plan: out.plan, provider: "abacate", source: pend && pend.source, paid_at: paidAt });
          const grant = await grantPurchase(env, email, id, out.plan, uid, "abacate", paidAt, pend && pend.source);
          await env.PREMIUM_KV.delete(receipt.key);
          await recordPaidCheckout(env, { id, email, uid, plan: out.plan, provider: "abacate" });
          out.premium_until_ms = grant.premium_until_ms;
          out.world_credits = grant.world_credits;
          out.amount_cents = PLAN_PRICES[out.plan] || 0;
          await env.PREMIUM_KV.delete(pendKey(id)).catch(() => {});
        }
        return json(out, 200, cors);
      }

      // ---------- webhook (AbacatePay -> Worker; nunca confia só no POST) ----------
      if (url.pathname === "/api/abacate/webhook" && req.method === "POST") {
        if (![env.WEBHOOK_SECRET, env.ABACATEPAY_V4_WEBHOOK_SECRET].filter(Boolean).includes(url.searchParams.get("secret"))) {
          return json({ error: "forbidden" }, 403, cors);
        }
        let evt = {};
        try { evt = await req.json(); } catch { evt = {}; }
        const data = evt.data || evt;
        const billing = data.checkout || data.billing || data;
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
            if (info.paid && email) {
              if (info.uid && pend && String(pend.uid || "") && String(pend.uid) !== info.uid) throw new Error("identidade de pagamento incompatível");
              if (pend && info.email && String(pend.email || "").toLowerCase() && String(pend.email).toLowerCase() !== email) throw new Error("identidade de pagamento incompatível");
              const plan = normalizeDepixPlan((pend && pend.plan) || info.plan);
              if (!plan) throw new Error("plano não reconhecido");
              if (info.plan && info.plan !== plan) throw new Error("plano de pagamento incompatível");
              if (PURCHASABLE_PLAN_IDS.has(plan) && (info.amount !== PLAN_LIMITS[plan].price_cents || info.paidAmount !== PLAN_LIMITS[plan].price_cents || info.devMode)) throw new Error("Valor confirmado incompatível");
              const uid = String(info.uid || (pend && pend.uid) || "");
              const paidAt = timestampMs(info.paid_at);
              const receipt = await persistConfirmedPayment(env, { id: bid, email, uid, plan, provider: "abacate", source: pend && pend.source, paid_at: paidAt });
              if (uid) {
                const grant = await grantPurchase(env, email, bid, plan, uid, "abacate", paidAt, pend && pend.source);
                await env.PREMIUM_KV.delete(receipt.key);
                await recordPaidCheckout(env, { id: bid, email, uid, plan, provider: "abacate" });
              } else {
                await recordPaidCheckout(env, { id: bid, email, plan, provider: "abacate" });
              }
            }
          } catch (e) { console.log("abacate webhook erro: " + (e && e.message)); return json({ error: "Pagamento será conciliado automaticamente." }, 503, cors); }
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
        const approvedStatus = ["paid", "approved", "completed", "payment_confirmed", "confirmed"].includes(status);
        const approvedEvent = /^(order_approved|purchase_approved|compra_aprovada)$/.test(evt.toLowerCase());
        const approved = approvedEvent || (!evt && approvedStatus);
        const email = String((body.Customer && body.Customer.email) || (body.customer && body.customer.email) || (body.Client && body.Client.email) || body.customer_email || body.customerEmail || body.email || "").trim().toLowerCase();
        const pid = String((body.Product && (body.Product.product_id || body.Product.id)) || body.product_id || body.productId || "");
        const oid = String(body.order_id || body.orderId || body.id || body.code || "");
        const plan = normalizeKiwifyPlan(body, env);
        // log cru (últimos 50) p/ depurar sem adivinhar formato
        try {
          const lst = (await env.PREMIUM_KV.get("klog", "json").catch(() => null)) || [];
          lst.unshift({ at: Date.now(), evt, status, pid, oid, plan });
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
        await persistConfirmedPayment(env, { id: oid, email, plan, provider: "kiwify" });
        await recordPaidCheckout(env, { id: "kiwify:" + oid, email, plan, provider: "kiwify" });
        await env.PREMIUM_KV.put("kwo:" + oid, JSON.stringify({ email, plan, at: Date.now() }), { expirationTtl: 90 * 86400 }).catch(() => {});
        return json({ ok: true, paid: true, benefit_pending_account_claim: true, plan }, 200, cors);
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
        const ent = await getUserEntitlements(env, fb.uid, fb);
        await metric(env, "entitlement_loaded", { plan: ent.plan }, req);
        return json(ent, 200, cors);
      }

      if (url.pathname === "/api/entitlements/check" && req.method === "POST") {
        const fb = await firebaseUser(req, env);
        if (!fb && /^Bearer\s+/i.test(req.headers.get("Authorization") || "")) return json({ error: "Sessão Google inválida." }, 401, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        if (!Number.isSafeInteger(body.worlds) || body.worlds < 1 || body.worlds > 100 || !Number.isSafeInteger(body.size_bytes) || body.size_bytes < 1) {
          return json({ error: "Invalid file size or world count.", code: "INVALID_REQUEST" }, 400, cors);
        }
        const ent = fb ? await getUserEntitlements(env, fb.uid, fb) : { plan: "free", premium_until_ms: 0, world_credits: 0, active_world_projects: 0 };
        const features = body.features && typeof body.features === "object" ? body.features : {};
        const decision = checkEntitlement(ent, body.worlds, body.size_bytes, Date.now(), features);
        const operationId = String(body.operation_id || "").trim().slice(0, 120);
        if (decision.allowed && (decision.requires_credit || (decision.free_quota_tools && decision.free_quota_tools.length)) && !operationId) {
          return json({ allowed: false, code: "OPERATION_ID_REQUIRED", plan: decision.plan }, 400, cors);
        }
        const quotaOwner = fb ? ("uid:" + fb.uid) : ("ip:" + String(req.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80));
        const stub = fb ? await entitlementStub(env, fb.uid, fb.email) : env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName("free:" + quotaOwner));
        if (decision.allowed && decision.free_quota_tools && decision.free_quota_tools.length) {
          const path = "/reserve-quota";
          const quotaStates = [];
          for (const item of decision.free_quota_tools) {
            const quota = await stub.fetch("https://entitlements" + path, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ operation_id: operationId, tool: item.tool, limit: item.limit, day: new Date().toISOString().slice(0, 10) })
            });
            const quotaState = await quota.json();
            if (!quota.ok || quotaState.allowed === false) {
              if (operationId) await stub.fetch("https://entitlements/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation_id: operationId }) });
              const denied = { allowed: false, code: "TOOL_QUOTA_EXCEEDED", tool: item.tool, remaining: 0, plan: decision.plan };
              await metric(env, "premium_operation_denied", { plan: ent.plan, reason: denied.code }, req);
              return json(denied, 403, cors);
            }
            quotaStates.push({ tool: item.tool, remaining: quotaState.remaining });
          }
          decision.free_quota_remaining = quotaStates;
          decision.requires_completion = !!operationId;
        }
        if (decision.allowed && decision.requires_credit && operationId) {
          const projectId = String(body.world_project_id || "").trim().slice(0, 120);
          const worldFingerprint = String(body.world_fingerprint || "").trim().slice(0, 160);
          const reservation = await stub.fetch("https://entitlements/reserve-world", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operation_id: operationId, world_project_id: projectId, world_fingerprint: worldFingerprint, candidate_project_id: crypto.randomUUID() })
          });
          const reservationData = await reservation.json();
          if (!reservation.ok) {
            const denied = { allowed: false, code: reservationData.code || "WORLD_CREDIT_EXHAUSTED", plan: ent.plan };
            await metric(env, "premium_operation_denied", { plan: ent.plan, reason: denied.code }, req);
            return json(denied, reservation.status, cors);
          }
          decision.world_project_id = reservationData.world_project_id;
          decision.requires_completion = true;
        }
        if (!decision.allowed) await metric(env, "premium_operation_denied", { plan: ent.plan, reason: decision.code }, req);
        else if (decision.plan !== "free") await metric(env, "premium_operation_authorized", { plan: decision.plan }, req);
        return json({ ...decision, world_credits: ent.world_credits, premium_until_ms: ent.premium_until_ms }, decision.allowed ? 200 : 403, cors);
      }

      if (["/api/entitlements/complete", "/api/entitlements/consume", "/api/entitlements/release"].includes(url.pathname) && req.method === "POST") {
        const fb = await firebaseUser(req, env);
        if (!fb && /^Bearer\s+/i.test(req.headers.get("Authorization") || "")) return json({ error: "Sessão Google inválida." }, 401, cors);
        let body = {};
        try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400, cors); }
        const operationId = String(body.operation_id || "").trim().slice(0, 120);
        if (!operationId) return json({ error: "operation_id obrigatório." }, 400, cors);
        const quotaOwner = fb ? ("uid:" + fb.uid) : ("ip:" + String(req.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80));
        const stub = fb ? await entitlementStub(env, fb.uid, fb.email) : env.ENTITLEMENTS.get(env.ENTITLEMENTS.idFromName("free:" + quotaOwner));
        const action = url.pathname.endsWith("/release") ? "/release" : "/complete";
        const r = await stub.fetch("https://entitlements" + action, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation_id: operationId, world_project_id: String(body.world_project_id || "").slice(0, 120), world_fingerprint: String(body.world_fingerprint || "").slice(0, 64) })
        });
        const out = await r.json();
        if (r.ok && out.credit_consumed) await metric(env, "credit_consumed", { plan: "world1" }, req);
        return json(out, r.status, cors);
      }

      if (url.pathname === "/api/premium" && req.method === "GET") {
        const fb = await firebaseUser(req, env);
        if (!fb) return json({ error: "Sessão Google inválida." }, 401, cors);
        const ent = await getUserEntitlements(env, fb.uid, fb);
        return json({ ...ent, account_email: fb.email }, 200, cors);
      }

      return json({ error: "rota desconhecida" }, 404, cors);
    } catch (e) {
      console.error("request failed", e && e.message ? e.message : e);
      if (e && (e.code === "AUTH_UNAVAILABLE" || e.message === "ENTITLEMENT_UNAVAILABLE")) {
        return json({ error: e.message === "ENTITLEMENT_UNAVAILABLE" ? "Não foi possível verificar seus benefícios agora. Tente novamente." : "Não foi possível verificar sua sessão Google agora. Tente novamente." }, 503, cors);
      }
      return json({ error: "Erro interno ao processar a solicitação." }, 500, cors);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reconcileRecentDepixCheckouts(env).catch((error) => console.log("depix reconcile erro: " + (error && error.message))));
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
    if (url.pathname === "/audit-limit" && req.method === "POST") {
      const allowed = await this.state.storage.transaction(async (txn) => {
        const hour = Math.floor(Date.now() / 3600000);
        const old = await txn.get("audit_rate");
        const count = old && old.hour === hour ? old.count : 0;
        if (count >= 80) return false;
        await txn.put("audit_rate", { hour, count: count + 1 });
        return true;
      });
      return json({ allowed }, allowed ? 200 : 429);
    }
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const fresh = () => ({ world_credits: 0, premium_until_ms: 0, plan: "", time_passes: [], revision: 0, purchases: {}, consumed: {}, world_projects: {}, world_fingerprints: {}, reservations: {}, completed_ops: {}, quotas: {}, imports: {}, checkouts: {} });
    const normalize = (data) => Object.assign(fresh(), data || {});
    const run = (fn) => this.state.storage.transaction(async (txn) => {
      const data = normalize(await txn.get("entitlement"));
      const result = await fn(data);
      if (!result || result.persist !== false) await txn.put("entitlement", data);
      return result || {};
    });
    const current = normalize(await this.state.storage.get("entitlement"));
    const publicState = (data) => {
      const now = Date.now();
      const passes = Array.isArray(data.time_passes) ? data.time_passes : [];
      const currentPass = passes.filter((pass) => +pass.starts_at <= now && +pass.expires_at > now).sort((a, b) => +a.starts_at - +b.starts_at)[0];
      const queuedUntil = passes.reduce((end, pass) => Math.max(end, +pass.expires_at || 0), 0);
      return {
      world_credits: Math.max(0, +data.world_credits || 0),
      premium_until_ms: Math.max(+data.premium_until_ms || 0, queuedUntil),
      plan: String((currentPass && currentPass.plan) || data.plan || ""),
      plan_expires_at: +((currentPass && currentPass.expires_at) || data.premium_until_ms || 0),
      revision: (+data.revision || 0) || Object.keys(data.purchases || {}).length,
      world_projects: Object.entries(data.world_projects || {}).filter(([, project]) => +project.expires_at > now)
        .map(([id, project]) => ({ id, expires_at: +project.expires_at })),
      pending_payments: Object.entries(data.checkouts || {}).filter(([, checkout]) => checkoutIsPending(checkout))
        .map(([request_id, checkout]) => ({ request_id, id: checkout.result && checkout.result.id || "", checkout_url: checkout.result && checkout.result.url || "", plan: checkout.plan, provider: checkout.provider || "depix", created_at: +checkout.at || 0, expires_at: checkoutLockUntil(checkout), status: checkout.status }))
    };
    };
    if (url.pathname === "/payment/record" && req.method === "POST") {
      const orderNsu = String(body.order_nsu || "").trim().slice(0, 100);
      const uid = String(body.uid || "").trim().slice(0, 160);
      const email = String(body.email || "").trim().toLowerCase();
      const plan = normalizeDepixPlan(body.plan);
      if (!orderNsu || !uid || !validEmail(email) || !plan || body.via !== "infinitepay") return json({ error: "Invalid InfinitePay order." }, 400);
      const key = "payment_record";
      const prior = await this.state.storage.get(key);
      if (prior && (prior.order_nsu !== orderNsu || prior.uid !== uid || prior.plan !== plan)) return json({ error: "Order identity mismatch." }, 409);
      const order = prior || {
        order_nsu: orderNsu, uid, email, plan,
        source: TELEMETRY_SOURCES.has(String(body.source || "")) ? String(body.source) : "",
        via: "infinitepay", status: "pending", at: timestampMs(body.at) || Date.now()
      };
      await this.state.storage.put(key, order);
      return json({ saved: true });
    }
    if (url.pathname === "/payment/get" && req.method === "GET") {
      return json({ order: await this.state.storage.get("payment_record") || null });
    }
    if (url.pathname === "/payment/paid" && req.method === "POST") {
      const order = await this.state.storage.get("payment_record");
      if (!order || order.via !== "infinitepay") return json({ error: "Order not found." }, 404);
      order.status = "paid";
      order.paid_at = timestampMs(body.paid_at) || Date.now();
      await this.state.storage.put("payment_record", order);
      return json({ saved: true });
    }
    if (url.pathname === "/state") return json(publicState(current));

    if (url.pathname === "/free-quota") {
      const day = String(body.day || "").replace(/[^0-9-]/g, "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Invalid day." }, 400);
      const result = await run((data) => {
        const key = "convert:" + day;
        let used = +data.quotas[key] || 0;
        if (body.consume === true && used < FREE_DAILY) used += 1;
        data.quotas[key] = used;
        return { value: { allowed: used < FREE_DAILY, used, remaining: Math.max(0, FREE_DAILY - used) } };
      });
      return json(result.value, body.consume === true && !result.value.allowed ? 402 : 200);
    }

    if (url.pathname === "/grant") {
      const bid = String(body.billing_id || "").slice(0, 180);
      const plan = normalizeDepixPlan(body.plan);
      if (!bid || !plan) return json({ error: "Invalid payment or plan." }, 400);
      const result = await run((data) => {
        if (data.purchases[bid]) return { persist: false, value: { ...publicState(data), duplicate: true } };
        const now = Date.now();
        const definition = PLAN_LIMITS[plan];
        if (definition.kind === "world_credit") data.world_credits = (+data.world_credits || 0) + (definition.credit_count || 1);
        else {
          data.time_passes = Array.isArray(data.time_passes) ? data.time_passes : [];
          const priorUntil = Math.max(+data.premium_until_ms || 0, ...data.time_passes.map((pass) => +pass.expires_at || 0));
          const confirmedAt = Math.min(timestampMs(body.paid_at) || now, now);
          let startsAt = Math.max(confirmedAt, priorUntil);
          const activePass = data.time_passes.find(pass => +pass.starts_at <= now && +pass.expires_at > now);
          const activePlan = activePass ? activePass.plan : (+data.premium_until_ms > now ? data.plan : '');
          const oldDefinition = PLAN_LIMITS[activePlan];
          const upgradeNow = oldDefinition && ((definition.capabilities.world_studio && !oldDefinition.capabilities.world_studio && !(oldDefinition.allowed_tools || []).includes('world_paint')) || (definition.daily_operations && oldDefinition.daily_operations && definition.daily_operations > oldDefinition.daily_operations));
          if (upgradeNow) {
            const shift = definition.duration_days * 86400000;
            if (!activePass && oldDefinition.kind === 'time') data.time_passes.push({plan:activePlan,starts_at:now,expires_at:+data.premium_until_ms,billing_id:'preserved-legacy-pass'});
            data.time_passes.forEach(pass => {if (+pass.expires_at > now) {pass.starts_at = Math.max(now,+pass.starts_at) + shift; pass.expires_at = +pass.expires_at + shift;}});
            startsAt = now;
          }

          const expiresAt = startsAt + definition.duration_days * 86400000;
          data.time_passes.push({ plan, starts_at: startsAt, expires_at: expiresAt, billing_id: bid });
          data.premium_until_ms = Math.max(priorUntil, expiresAt, ...data.time_passes.map(pass=>+pass.expires_at||0));
          if (startsAt <= now) data.plan = plan;
        }
        data.purchases[bid] = { plan, at: now };
        const billingParts = bid.split(":");
        const provider = billingParts.shift() || "";
        const providerId = billingParts.join(":");
        for (const checkout of Object.values(data.checkouts || {})) {
          if (checkout.provider === provider && checkout.result && checkout.result.id === providerId) {
            checkout.status = "paid";
            checkout.paid_at = timestampMs(body.paid_at) || now;
          }
        }
        data.revision = (+data.revision || 0) + 1;
        return { value: { ...publicState(data), duplicate: false } };
      });
      return json(result.value);
    }

    if (url.pathname === "/migrate") {
      const result = await run((data) => {
        const until = +body.premium_until_ms || 0;
        const plan = normalizeDepixPlan(body.plan);
        if (until > Date.now() && (!plan || PLAN_LIMITS[plan].kind !== "time")) {
          return { persist: false, status: 400, value: { error: "Active legacy entitlement requires a known time plan." } };
        }
        if (until > +data.premium_until_ms) {
          data.premium_until_ms = until; data.plan = plan; data.revision = (+data.revision || 0) + 1;
        }
        return { value: publicState(data) };
      });
      return json(result.value, result.status || 200);
    }

    if (url.pathname === "/import") {
      const source = String(body.source || "").slice(0, 200);
      const snapshot = body.state && typeof body.state === "object" ? body.state : {};
      const revision = Math.max(0, +body.revision || 0);
      if (!source || !revision) return json({ error: "Invalid import source." }, 400);
      const result = await run((data) => {
        const importedPlan = normalizeDepixPlan(snapshot.plan);
        const previous = data.imports[source] || { revision: 0, credits: 0 };
        if (revision <= previous.revision) return { persist: false, value: publicState(data) };
        // Some pre-credit records stored a future expiry alongside a world
        // credit or unknown plan. Import the credit/project only; a timestamp
        // never turns into a time pass without an exact time-plan identity.
        const importedUntil = importedPlan && PLAN_LIMITS[importedPlan].kind === "time"
          ? (+snapshot.premium_until_ms || 0) : 0;
        const delta = Math.max(0, (+snapshot.world_credits || 0) - (+previous.credits || 0));
        data.world_credits = (+data.world_credits || 0) + delta;
        if (importedUntil > +data.premium_until_ms) {
          data.premium_until_ms = importedUntil;
          data.plan = importedPlan;
        }
        (snapshot.world_projects || []).forEach((project) => {
          const id = String(project.id || "").slice(0, 120);
          if (id && +project.expires_at > Date.now() && !data.world_projects[id]) data.world_projects[id] = { expires_at: +project.expires_at, created_at: Date.now(), operations: {} };
        });
        data.imports[source] = { revision, credits: +snapshot.world_credits || 0 };
        data.revision = (+data.revision || 0) + 1;
        return { value: publicState(data) };
      });
      return json(result.value, result.status || 200);
    }

    if (["/checkout-begin", "/checkout-result", "/checkout-failed"].includes(url.pathname)) {
      const requestId = String(body.request_id || "").trim().slice(0, 100);
      const plan = normalizeDepixPlan(body.plan);
      const provider = ["abacate", "infinitepay"].includes(body.provider) ? body.provider : "depix";
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId) || !plan) return json({ error: "Invalid checkout identity." }, 400);
      const result = await run((data) => {
        const currentCheckout = data.checkouts[requestId];
        if (url.pathname === "/checkout-begin") {
          if (currentCheckout) {
            if (currentCheckout.plan !== plan || (currentCheckout.provider && currentCheckout.provider !== provider)) return { persist: false, status: 409, value: { error: "Checkout request ID was already used for another plan or provider." } };
            if (["creating", "ready"].includes(currentCheckout.status) && !checkoutIsPending(currentCheckout)) {
              return { persist: false, status: 409, value: { error: "O link anterior expirou. Vamos preparar uma nova tentativa.", code: "CHECKOUT_EXPIRED" } };
            }
            if (currentCheckout.status === "ready") return { persist: false, value: { create: false, result: currentCheckout.result, checkout_request_id: requestId } };
            if (currentCheckout.status === "creating" && provider === "infinitepay") return { persist: false, status: 409, value: { error: "Seu link está sendo preparado. Tente novamente em instantes para continuar o mesmo pedido.", code: "CHECKOUT_PREPARING", retry_after: 2, pending: true } };
            // DePix deduplicates POST /checkouts by idempotency_key. A retry
            // with this same request ID can safely recover the provider result.
            if (currentCheckout.status === "creating" && provider === "depix") return { persist: false, value: { create: true, retry: true } };
            return { persist: false, status: 409, value: { error: "Este checkout já foi iniciado ou está em verificação. Não será criada outra cobrança com o mesmo pedido.", pending: currentCheckout.status === "creating" } };
          }
          const pendingCheckout = Object.entries(data.checkouts).filter(([, checkout]) => checkoutIsPending(checkout) &&
            // Each InfinitePay product may have its own unpaid link. Reopening
            // reuses that product's order; changing products never charges a card.
            (provider !== "infinitepay" || (checkout.provider === provider && checkout.plan === plan)))
            .sort((a, b) => (+b[1].at || 0) - (+a[1].at || 0))[0];
          if (pendingCheckout) {
            const [pendingRequestId, pending] = pendingCheckout;
            if (pending.status === "ready" && pending.provider === provider && pending.plan === plan && (provider === "infinitepay" || (pending.result && pending.result.id))) {
              return { persist: false, value: { create: false, result: pending.result, duplicate: true, checkout_request_id: pendingRequestId } };
            }
            if (pending.status === "ready" && pending.provider === provider && pending.plan === plan && pending.result && pending.result.url) {
              return { persist: false, value: { create: false, result: pending.result, duplicate: true, checkout_request_id: pendingRequestId } };
            }
            if (pending.provider === provider && pending.plan === plan && pending.status === "creating") {
              pending.status = "failed";
              pending.error = "Checkout anterior não recebeu um link; nova tentativa autorizada.";
              pending.last_error_at = Date.now();
              return { value: { create: true, retry: true, retry_request_id: pendingRequestId } };
            }
            if (pending.status === "creating" && provider === "depix" && pending.provider === "depix" && pending.plan === plan) {
              return { persist: false, value: { create: true, retry: true, retry_request_id: pendingRequestId } };
            }
            if (provider === "infinitepay") return { persist: false, status: 409, value: { error: "Seu link está sendo preparado. Tente novamente em instantes para continuar o mesmo pedido.", code: "CHECKOUT_PREPARING", retry_after: 2, pending: true } };
            return { persist: false, status: 409, value: { error: "Já existe uma cobrança em andamento nesta conta. Confira o pagamento ou aguarde até 20 minutos antes de iniciar outra, para evitar uma cobrança duplicada.", pending: true, pending_plan: pending.plan } };
          }
          data.checkouts[requestId] = { plan, provider, status: "creating", at: Date.now() };
          return { value: { create: true } };
        }
        if (!currentCheckout || currentCheckout.plan !== plan) return { persist: false, status: 409, value: { error: "Checkout request not found." } };
        if (url.pathname === "/checkout-result") {
          if (currentCheckout.status === "paid") return { persist: false, value: { saved: true, paid: true } };
          if (currentCheckout.status === "ready") return { persist: false, value: { saved: true, duplicate: true } };
          const safeResult = body.result && typeof body.result === "object" ? {
            id: String(body.result.id || "").slice(0, 180), url: String(body.result.url || "").slice(0, 1000), plan,
            expires_at: timestampMs(body.result.expires_at)
          } : null;
          if (!safeResult || !safeResult.id || !/^https:\/\//i.test(safeResult.url)) return { persist: false, status: 400, value: { error: "Invalid checkout result." } };
          currentCheckout.status = "ready"; currentCheckout.result = safeResult; currentCheckout.ready_at = Date.now();
          return { value: { saved: true } };
        }
        // A provider timeout is ambiguous: it may already have created a
        // charge. Keep the account lock until checkout expiry to avoid a retry
        // creating a second payment.
        if (body.retryable === true && (currentCheckout.status === "creating" ||
            (currentCheckout.provider === "infinitepay" && currentCheckout.status === "ready" && (!currentCheckout.result || !currentCheckout.result.id || !isValidInfinitePayCheckoutUrl(currentCheckout.result.url))))) { delete data.checkouts[requestId]; return { value: { saved: true } }; }
        currentCheckout.error = String(body.error || "Checkout result uncertain.").slice(0, 200);
        currentCheckout.last_error_at = Date.now();
        return { value: { saved: true } };
      });
      return json(result.value, result.status || 200);
    }

    if (url.pathname === "/quota-state" || url.pathname === "/reserve-quota") {
      const tool = String(body.tool || "").trim().toLowerCase().slice(0, 40);
      const day = String(body.day || "").replace(/[^0-9-]/g, "").slice(0, 10);
      const operationId = String(body.operation_id || "").slice(0, 120);
      const reservationId = operationId ? operationId + ":quota:" + tool : "";
      const limit = Math.max(0, Math.min(100, Number(body.limit) || 0));
      if (!tool || !limit || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "Invalid quota." }, 400);
      const result = await run((data) => {
        const key = tool + ":" + day;
        const used = +data.quotas[key] || 0;
        const pending = Object.values(data.reservations).filter((r) => r.kind === "quota" && r.quota_key === key && +r.expires_at > Date.now()).length;
        if (url.pathname === "/reserve-quota" && operationId && data.completed_ops[operationId]) {
          return { persist: false, value: { allowed: true, used, remaining: Math.max(0, limit - used), duplicate: true } };
        }
        if (url.pathname === "/reserve-quota" && operationId && data.reservations[reservationId]) {
          return { persist: false, value: { allowed: true, used, remaining: Math.max(0, limit - used - pending), duplicate: true } };
        }
        if (used + pending >= limit) return { persist: false, value: { allowed: false, used, remaining: 0 } };
        if (url.pathname === "/reserve-quota") {
          if (!operationId) return { persist: false, value: { allowed: false, used, remaining: 0 } };
          data.reservations[reservationId] = { kind: "quota", operation_id: operationId, quota_key: key, expires_at: Date.now() + 3600000 };
        }
        return { value: { allowed: true, used, remaining: Math.max(0, limit - used - pending - (url.pathname === "/reserve-quota" ? 1 : 0)) } };
      });
      return json(result.value, result.value.allowed ? 200 : 402);
    }

    if (url.pathname === "/reserve-world") {
      const operationId = String(body.operation_id || "").slice(0, 120);
      const projectId = String(body.world_project_id || "").slice(0, 120);
      const fingerprintRaw = String(body.world_fingerprint || "").toLowerCase().slice(0, 64);
      const fingerprint = /^[a-f0-9]{64}$/.test(fingerprintRaw) ? fingerprintRaw : "";
      const candidateId = String(body.candidate_project_id || "").slice(0, 120);
      if (!operationId || !candidateId) return json({ error: "Invalid project reservation." }, 400);
      if (!fingerprint) return json({ error: "World fingerprint unavailable.", code: "WORLD_ID_UNAVAILABLE" }, 400);
      const result = await run((data) => {
        if (data.completed_ops[operationId]) {
          const completedProject = data.completed_ops[operationId].project_id;
          if (completedProject && (data.world_fingerprints[fingerprint] === completedProject || (data.world_projects[completedProject] && data.world_projects[completedProject].fingerprints && data.world_projects[completedProject].fingerprints[fingerprint]))) {
            return { persist: false, value: { allowed: true, world_project_id: completedProject, duplicate: true } };
          }
          return { persist: false, status: 409, value: { allowed: false, code: "OPERATION_ID_REUSED" } };
        }
        if (data.reservations[operationId]) {
          const prior = data.reservations[operationId];
          if (prior.fingerprint === fingerprint && (!projectId || !prior.project_id || projectId === prior.project_id)) return { persist: false, value: { allowed: true, world_project_id: prior.project_id, duplicate: true } };
          return { persist: false, status: 409, value: { allowed: false, code: "OPERATION_ID_REUSED" } };
        }
        let chosenId = projectId;
        if (!chosenId && fingerprint && data.world_fingerprints[fingerprint]) chosenId = data.world_fingerprints[fingerprint];
        const project = chosenId ? data.world_projects[chosenId] : null;
        if (chosenId && (!project || +project.expires_at <= Date.now())) return { persist: false, status: 409, value: { allowed: false, code: "WORLD_PROJECT_EXPIRED" } };
        if (project && projectId) {
          const knownFingerprints = project.fingerprints && typeof project.fingerprints === "object" ? project.fingerprints : {};
          const known = !!knownFingerprints[fingerprint] || data.world_fingerprints[fingerprint] === chosenId;
          if (!known && Object.keys(knownFingerprints).length) return { persist: false, status: 409, value: { allowed: false, code: "WORLD_MISMATCH" } };
          if (!known) {
            project.fingerprints = knownFingerprints;
            project.fingerprints[fingerprint] = true;
            data.world_fingerprints[fingerprint] = chosenId;
          }
        }
        let isNew = false;
        if (!project) {
          const pendingMatch = fingerprint && Object.values(data.reservations).find((r) => r.kind === "world" && r.fingerprint === fingerprint && +r.expires_at > Date.now());
          if (pendingMatch) { chosenId = pendingMatch.project_id; isNew = true; }
          else {
            const pendingIds = new Set(Object.values(data.reservations).filter((r) => r.kind === "world" && r.new_project && +r.expires_at > Date.now()).map((r) => r.project_id));
            if ((+data.world_credits || 0) <= pendingIds.size) return { persist: false, status: 409, value: { allowed: false, code: "WORLD_CREDIT_EXHAUSTED" } };
            chosenId = candidateId; isNew = true;
          }
        }
        data.reservations[operationId] = { kind: "world", project_id: chosenId, new_project: isNew, fingerprint, expires_at: Date.now() + 3600000 };
        return { value: { allowed: true, world_project_id: chosenId, new_project: isNew } };
      });
      return json(result.value, result.status || (result.value.allowed ? 200 : 409));
    }

    if (url.pathname === "/complete" || url.pathname === "/consume") {
      const operationId = String(body.operation_id || "").slice(0, 120);
      const outputFingerprintRaw = String(body.world_fingerprint || "").toLowerCase().slice(0, 64);
      const outputFingerprint = /^[a-f0-9]{64}$/.test(outputFingerprintRaw) ? outputFingerprintRaw : "";
      if (!operationId) return json({ error: "Missing operation id." }, 400);
      const result = await run((data) => {
        const previous = data.completed_ops[operationId];
        if (previous) return { persist: false, value: { completed: true, consumed: true, duplicate: true, credit_consumed: !!previous.credit_consumed, world_project_id: previous.project_id || "", world_credits: +data.world_credits || 0 } };
        const reservations = Object.entries(data.reservations).filter(([key, reservation]) => key === operationId || reservation.operation_id === operationId);
        if (!reservations.length) return { persist: false, status: 409, value: { error: "Operation authorization expired.", code: "RESERVATION_REQUIRED" } };
        const now = Date.now();
        let creditConsumed = false;
        let projectId = "";
        for (const [reservationId, reservation] of reservations) {
          if (+reservation.expires_at <= now) return { persist: false, status: 409, value: { error: "Operation authorization expired.", code: "RESERVATION_EXPIRED" } };
          if (reservation.kind === "quota") data.quotas[reservation.quota_key] = (+data.quotas[reservation.quota_key] || 0) + 1;
          else if (reservation.kind === "world") {
            const project = data.world_projects[reservation.project_id];
            if (reservation.new_project && !project) {
              if ((+data.world_credits || 0) < 1) return { persist: false, status: 409, value: { error: "World credit unavailable.", code: "WORLD_CREDIT_EXHAUSTED" } };
              data.world_credits -= 1;
              data.world_projects[reservation.project_id] = { created_at: now, expires_at: now + WORLD_PROJECT_WINDOW_MS, operations: {}, fingerprints: {} };
              creditConsumed = true;
            } else if (!project || +project.expires_at <= now) return { persist: false, status: 409, value: { error: "World session expired.", code: "WORLD_PROJECT_EXPIRED" } };
            else project.expires_at = now + WORLD_PROJECT_WINDOW_MS;
            const activeProject = data.world_projects[reservation.project_id];
            activeProject.fingerprints = activeProject.fingerprints && typeof activeProject.fingerprints === "object" ? activeProject.fingerprints : {};
            if (reservation.fingerprint) { activeProject.fingerprints[reservation.fingerprint] = true; data.world_fingerprints[reservation.fingerprint] = reservation.project_id; }
            if (outputFingerprint) { activeProject.fingerprints[outputFingerprint] = true; data.world_fingerprints[outputFingerprint] = reservation.project_id; }
            activeProject.operations[operationId] = now;
            data.consumed[operationId] = { worlds: 1, at: now, project_id: reservation.project_id };
            projectId = reservation.project_id;
          }
          delete data.reservations[reservationId];
        }
        data.completed_ops[operationId] = { at: now, kind: reservations.map(([, reservation]) => reservation.kind).join("+"), project_id: projectId, credit_consumed: creditConsumed };
        for (const [oldOp, record] of Object.entries(data.completed_ops)) if (now - (+record.at || 0) > 400 * 86400000) delete data.completed_ops[oldOp];
        if (creditConsumed) data.revision = (+data.revision || 0) + 1;
        return { value: { completed: true, consumed: true, credit_consumed: creditConsumed, world_project_id: projectId, world_credits: +data.world_credits || 0 } };
      });
      return json(result.value, result.status || (result.value.error ? 409 : 200));
    }

    if (url.pathname === "/release") {
      const operationId = String(body.operation_id || "").slice(0, 120);
      const result = await run((data) => {
        const reservations = Object.entries(data.reservations).filter(([key, reservation]) => key === operationId || reservation.operation_id === operationId);
        if (!reservations.length) return { persist: false, value: { released: true, duplicate: true, world_credits: +data.world_credits || 0 } };
        reservations.forEach(([reservationId]) => { delete data.reservations[reservationId]; });
        return { value: { released: true, world_credits: +data.world_credits || 0 } };
      });
      return json(result.value);
    }

    return json({ error: "Unknown entitlement route." }, 404);
  }
}
