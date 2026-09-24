import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const worker = await import(pathToFileURL(path.resolve("src/index.js")).href);
const rootWrangler = fs.readFileSync(path.resolve("../wrangler.toml"), "utf8");
assert.match(rootWrangler, /ABACATEPAY_PRODUCT_ID_WORLD1\s*=\s*""/, "production config leaves the legacy 24h product unavailable for World1");
assert.match(rootWrangler, /ABACATEPAY_PRODUCT_ID_24H\s*=\s*"prod_sfQEAQQcWr2P2UtJG4yqUsSq"/, "the existing provider product remains classified as legacy 24h");
const publicConfig = fs.readFileSync(path.resolve("../site/config.js"), "utf8");
assert.match(publicConfig, /KIWIFY_URL_WORLD1:\s*""/, "the old 24h Kiwify link is not offered as a World1 checkout");

class Storage {
  constructor() { this.map = new Map(); this.lock = Promise.resolve(); }
  async get(k, type) {
    const value = this.map.get(k);
    if (type === "json" && typeof value === "string") return JSON.parse(value);
    return value;
  }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
  async transaction(fn) {
    const previous = this.lock;
    let unlock;
    this.lock = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try { return await fn(this); }
    finally { unlock(); }
  }
}
class KV extends Storage {
  async list({ prefix = "", cursor = "", limit = 1000 } = {}) {
    const names = Array.from(this.map.keys()).filter((key) => key.startsWith(prefix)).sort();
    const start = cursor ? Math.max(0, Number(cursor) || 0) : 0;
    const selected = names.slice(start, start + limit);
    const next = start + selected.length;
    return { keys: selected.map((name) => ({ name })), list_complete: next >= names.length, cursor: next >= names.length ? "" : String(next) };
  }
}
class Namespace {
  constructor() { this.objects = new Map(); }
  idFromName(name) { return String(name); }
  get(id) {
    const name = String(id);
    if (!this.objects.has(name)) {
      const state = { storage: new Storage() };
      const instance = new worker.EntitlementDO(state);
      this.objects.set(name, { fetch: (input, init) => instance.fetch(input instanceof Request ? input : new Request(input, init)), state, instance });
    }
    return this.objects.get(name);
  }
}
function doReq(pathname, body) {
  return new Request("https://entitlements" + pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function json(response) { return response.json(); }
const now = Date.now();
const MB = 1024 * 1024;

// Free, time plans, and the one-world credit all derive from the Worker catalog.
assert.equal(worker.PLAN_LIMITS.free.max_file_bytes, 10 * MB);
assert.deepEqual([worker.PLAN_LIMITS.world1.credit_count, worker.PLAN_LIMITS.ouro.credit_count, worker.PLAN_LIMITS.diamante.credit_count], [1, 3, 5], "Worker catalog defines each credit balance");
assert.deepEqual([worker.PLAN_LIMITS.world1.price_cents, worker.PLAN_LIMITS.ouro.price_cents, worker.PLAN_LIMITS.diamante.price_cents], [599, 1499, 2290], "credit prices are server-owned");
assert.equal(worker.checkEntitlement({ plan: "free", premium_until_ms: 0 }, 1, 5 * MB, now).allowed, true, "free users may use a 5 MB world");
assert.equal(worker.checkEntitlement({ plan: "free", premium_until_ms: 0 }, 1, 11 * MB, now).code, "NO_ENTITLEMENT", "free users cannot use an 11 MB world");
assert.equal(worker.checkEntitlement({ plan: "free", premium_until_ms: 0 }, 1, 5 * MB, now, { tool: "chunks_restore", chunks_count: 9 }).code, "NO_ENTITLEMENT", "free chunk restore obeys the central free capability limit");
const freeBuilder = worker.checkEntitlement({ plan: "free", premium_until_ms: 0 }, 1, 5 * MB, now, { tool: "builder" });
assert.equal(freeBuilder.allowed, true, "the advertised beta builder is available inside free plan limits");
assert.equal(freeBuilder.free_quota_tools[0].limit, 3, "builder exports reserve the configured free daily quota");
const vip7 = { plan: "vip7", world_credits: 0, premium_until_ms: now + 7 * 86400000 };
const creditDO = new worker.EntitlementDO({ storage: new Storage() });
const grantGold = await json(await creditDO.fetch(doReq("/grant", { plan: "ouro", billing_id: "gold-bundle-payment" })));
assert.equal(grantGold.world_credits, 3, "Ouro grants three credits");
const duplicateGold = await json(await creditDO.fetch(doReq("/grant", { plan: "ouro", billing_id: "gold-bundle-payment" })));
assert.equal(duplicateGold.world_credits, 3, "duplicate webhook cannot grant a bundle twice");
const grantDiamond = await json(await creditDO.fetch(doReq("/grant", { plan: "diamante", billing_id: "diamond-bundle-payment" })));
assert.equal(grantDiamond.world_credits, 8, "Diamante adds five credits to the existing balance");

for (const size of [11, 100, 499]) assert.equal(worker.checkEntitlement(vip7, 1, size * MB, now).allowed, true, `VIP 7 must allow ${size} MB`);
assert.equal(worker.checkEntitlement(vip7, 1, 11 * MB, now, { tool: "player_basic" }).allowed, true, "paid player editing is explicitly included in the plan catalog");
assert.equal(worker.checkEntitlement(vip7, 1, 100 * MB, now, { tool: "builder" }).allowed, true, "the 3D builder uses the purchased file limit");
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 1, 100 * MB, now, { tool: "builder" }).requires_credit, true, "builder exports use World1 project reservations");
assert.equal(worker.checkEntitlement(vip7, 1, 11 * MB, now, { tool: "future_unlisted_tool" }).code, "TOOL_NOT_INCLUDED", "a future tool cannot inherit paid access until its plan catalog entry is added");
assert.equal(worker.checkEntitlement(vip7, 1, undefined, now).code, "INVALID_REQUEST", "a missing file size is not interpreted as a zero-byte free file");
assert.equal(worker.checkEntitlement(vip7, 1, 500 * MB, now).allowed, true, "VIP 7 allows exactly 500 MB");
assert.equal(worker.checkEntitlement(vip7, 1, 500 * MB + 1, now).code, "SIZE_LIMIT", "VIP 7 blocks files larger than 500 MB");
assert.equal(worker.checkEntitlement({ ...vip7, premium_until_ms: now - 1 }, 1, 11 * MB, now).code, "NO_ENTITLEMENT", "expired VIP is inactive");
assert.equal(worker.checkEntitlement({ plan: "vip30", premium_until_ms: now + 30 * 86400000 }, 1, 2 * 1024 * MB, now).allowed, true, "VIP 30 has no commercial file cap");
assert.equal(worker.checkEntitlement({ plan: "creator", premium_until_ms: now + 30 * 86400000 }, 20, 3 * 1024 * MB, now).allowed, true, "Creator plan permits its catalog batch and large files");
assert.equal(worker.checkEntitlement({ plan: "creator", premium_until_ms: now + 30 * 86400000 }, 21, 1, now).code, "BATCH_LIMIT");
assert.equal(worker.checkEntitlement({ plan: "unknown_paid_plan", premium_until_ms: now + 86400000 }, 1, 11 * MB, now).code, "PLAN_UNVERIFIED", "an active timestamp with an unknown plan cannot inherit VIP30 rights");
assert.equal(worker.normalizeDepixPlan("world1"), "world1");
assert.equal(worker.normalizeDepixPlan("vip24h"), "vip24h", "legacy 24h remains a time plan, not world1");
assert.equal(worker.normalizeDepixPlan("made_up"), "", "unknown plan IDs never fall back to VIP30");
assert.equal(worker.normalizeKiwifyPlan({ Product: { product_id: "legacy-24h" } }, { KIWIFY_PID_24H: "legacy-24h" }), "vip24h", "legacy 24h product IDs stay time passes");
assert.equal(worker.normalizeKiwifyPlan({ Product: { product_id: "world-credit" } }, { KIWIFY_PID_WORLD1: "world-credit", KIWIFY_PID_24H: "legacy-24h" }), "world1");
assert.equal(worker.normalizeKiwifyPlan({ Product: { product_id: "legacy-24h" } }, { KIWIFY_PID_WORLD1: "world-credit", KIWIFY_PID_24H: "legacy-24h" }), "vip24h", "world1 never aliases the old 24h product ID");
assert.equal(worker.isDepixReleasableStatus("pending"), false);
assert.equal(worker.isDepixReleasableStatus("processing"), false, "an in-progress provider state is not a paid confirmation");
assert.equal(worker.isDepixReleasableStatus("approved"), true);
assert.equal(worker.isDepixReleasableStatus("completed"), true);
assert.equal(worker.isPaidPaymentStatus("PAID"), true);
assert.equal(worker.isPaidPaymentStatus("unpaid"), false, "substring matches cannot treat UNPAID as confirmation");
assert.equal(worker.isPaidPaymentStatus("ACTIVE"), false, "an active non-payment state is not enough to grant a purchase");
assert.equal(worker.checkEntitlement({ plan: "creator", premium_until_ms: 0, world_credits: 0 }, 1, 1, now, { plan: "creator", max_file_mb: 5000, tool: "convert", mode: "creative" }).code, "NO_ENTITLEMENT", "client submitted plan and limits cannot grant rights");

// SQLite Durable Object model: grants, world projects, quota reservations, and checkout IDs are atomic.
const objectState = { storage: new Storage() };
const dobj = new worker.EntitlementDO(objectState);
const legacyDO = new worker.EntitlementDO({ storage: new Storage() });
assert.equal((await legacyDO.fetch(doReq("/migrate", { premium_until_ms: now + 86400000, plan: "unknown_paid_plan" }))).status, 400, "legacy timestamps without a recognized plan are not migrated as VIP30");
assert.equal((await legacyDO.fetch(doReq("/migrate", { premium_until_ms: now + 86400000, plan: "world1" }))).status, 400, "a world credit cannot be migrated as a time pass");
const legacyImport = await legacyDO.fetch(doReq("/import", { source: "legacy-test", revision: 1, state: { premium_until_ms: now + 86400000, plan: "unknown_paid_plan" } }));
assert.equal(legacyImport.status, 400, "legacy imports with a timestamp but no exact time plan are rejected for manual reconciliation");
let result = await json(await dobj.fetch(doReq("/grant", { plan: "world1", billing_id: "depix:pay-world-1" })));
assert.equal(result.world_credits, 1);
result = await json(await dobj.fetch(doReq("/grant", { plan: "world1", billing_id: "depix:pay-world-1" })));
assert.equal(result.world_credits, 1, "a repeated payment ID grants one world credit once");
const timeBefore = Date.now();
const firstPass = await json(await dobj.fetch(doReq("/grant", { plan: "vip30", billing_id: "depix:pay-vip30" })));
const stackedPass = await json(await dobj.fetch(doReq("/grant", { plan: "vip7", billing_id: "depix:pay-vip7" })));
assert.equal(firstPass.plan, "vip30");
assert.equal(stackedPass.plan, "vip30", "a shorter new pass does not replace/downgrade the current plan");
assert.ok(stackedPass.premium_until_ms >= timeBefore + 37 * 86400000 - 1000, "time passes stack after the currently purchased period");
const delayedPaidAt = Date.now() - 90000;
const delayedDO = new worker.EntitlementDO({ storage: new Storage() });
const delayedGrant = await json(await delayedDO.fetch(doReq("/grant", { plan: "vip7", billing_id: "depix:paid-confirmed-earlier", paid_at: delayedPaidAt })));
assert.equal(delayedGrant.premium_until_ms, delayedPaidAt + 7 * 86400000, "a delayed entitlement reconciliation starts the pass at provider confirmation time");
const timeState = await json(await dobj.fetch(doReq("/state")));
assert.equal(timeState.plan, "vip30");
assert.equal(timeState.world_credits, 1, "time passes do not consume the world credit");
assert.ok(timeState.plan_expires_at < timeState.premium_until_ms, "the displayed current pass expiry stays separate from queued pass time");

// A failed premium world operation releases its reservation and preserves credit.
const failedReservation = await json(await dobj.fetch(doReq("/reserve-world", { operation_id: "failed-op", candidate_project_id: "project-failed", world_fingerprint: "c".repeat(64) })));
assert.equal(failedReservation.allowed, true);
await dobj.fetch(doReq("/release", { operation_id: "failed-op" }));
assert.equal((await json(await dobj.fetch(doReq("/state")))).world_credits, 1, "failed work does not consume a world credit");

// One purchased world supports repeat edits in the same project without repeated debit.
const fp = "a".repeat(64);
const reserveOne = await json(await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-first", candidate_project_id: "project-world-first", world_fingerprint: fp })));
assert.equal(reserveOne.new_project, true);
const reserveRetry = await json(await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-first", candidate_project_id: "another-candidate", world_fingerprint: fp })));
assert.equal(reserveRetry.duplicate, true, "same operation reservation is idempotent");
const outputFingerprint = "e".repeat(64);
let completed = await json(await dobj.fetch(doReq("/complete", { operation_id: "op-world-first", world_fingerprint: outputFingerprint })));
assert.equal(completed.credit_consumed, true);
assert.equal(completed.world_credits, 0);
completed = await json(await dobj.fetch(doReq("/complete", { operation_id: "op-world-first" })));
assert.equal(completed.duplicate, true);
assert.equal(completed.world_credits, 0, "repeating completion cannot decrement twice");
const projectId = reserveOne.world_project_id;
const firstProjectExpiry = (await json(await dobj.fetch(doReq("/state")))).world_projects.find((item) => item.id === projectId).expires_at;
const repeatEdit = await json(await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-second", world_project_id: projectId, world_fingerprint: fp, candidate_project_id: "unused" })));
assert.equal(repeatEdit.allowed, true, "the same project supports more than one edit");
assert.equal((await json(await dobj.fetch(doReq("/complete", { operation_id: "op-world-second" })))).credit_consumed, false);
assert.equal((await json(await dobj.fetch(doReq("/state")))).world_projects.find((item) => item.id === projectId).expires_at, firstProjectExpiry, "reediting does not extend the 30-day window after first use");
const fingerprintEdit = await json(await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-third", world_fingerprint: fp, candidate_project_id: "unused-2" })));
assert.equal(fingerprintEdit.world_project_id, projectId, "the same original world fingerprint reconnects to its project");
await dobj.fetch(doReq("/complete", { operation_id: "op-world-third" }));
const outputEdit = await json(await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-output", world_project_id: projectId, world_fingerprint: outputFingerprint, candidate_project_id: "unused-3" })));
assert.equal(outputEdit.allowed, true, "the fingerprint of a completed output keeps the same world project");
await dobj.fetch(doReq("/complete", { operation_id: "op-world-output" }));
const copiedMarker = await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-forged-marker", world_project_id: projectId, world_fingerprint: "f".repeat(64), candidate_project_id: "unused-4" }));
assert.equal(copiedMarker.status, 409, "copying a project marker onto a different world cannot reuse the credit");
const wrongWorld = await dobj.fetch(doReq("/reserve-world", { operation_id: "op-world-other", world_fingerprint: "b".repeat(64), candidate_project_id: "different-world" }));
assert.equal(wrongWorld.status, 409, "another world cannot use the spent credit");

// Concurrent work on one file with one credit converges to one project and one debit.
const raceState = { storage: new Storage() };
const raceDO = new worker.EntitlementDO(raceState);
await raceDO.fetch(doReq("/grant", { plan: "world1", billing_id: "race-payment" }));
const raceFingerprint = "c".repeat(64);
const raceReservations = await Promise.all(["race-op-a", "race-op-b"].map((operation_id, i) => raceDO.fetch(doReq("/reserve-world", { operation_id, candidate_project_id: "race-project-" + i, world_fingerprint: raceFingerprint }))));
const raceResults = await Promise.all(raceReservations.map((response) => response.json()));
assert.equal(raceResults[0].world_project_id, raceResults[1].world_project_id, "simultaneous same-world requests share one project");
await Promise.all(["race-op-a", "race-op-b"].map((operation_id) => raceDO.fetch(doReq("/complete", { operation_id }))));
const raceFinal = await json(await raceDO.fetch(doReq("/state")));
assert.equal(raceFinal.world_credits, 0, "concurrent completion consumes exactly one credit");
assert.equal(raceFinal.world_projects.length, 1);

// Free quota reservations are idempotent and counted only on successful completion.
const quotaDO = new worker.EntitlementDO({ storage: new Storage() });
const day = new Date().toISOString().slice(0, 10);
const quotaReservation = { operation_id: "quota-op-1", tool: "convert", limit: 3, day };
assert.equal((await json(await quotaDO.fetch(doReq("/reserve-quota", quotaReservation)))).allowed, true);
await quotaDO.fetch(doReq("/release", { operation_id: "quota-op-1" }));
assert.equal((await json(await quotaDO.fetch(doReq("/quota-state", { tool: "convert", limit: 3, day })))).used, 0, "failed operations do not count against quota");
for (const id of ["quota-a", "quota-b", "quota-c"]) {
  await quotaDO.fetch(doReq("/reserve-quota", { ...quotaReservation, operation_id: id }));
  await quotaDO.fetch(doReq("/complete", { operation_id: id }));
}
const exhaustedQuota = await quotaDO.fetch(doReq("/reserve-quota", { ...quotaReservation, operation_id: "quota-d" }));
assert.equal(exhaustedQuota.status, 402);
await quotaDO.fetch(doReq("/reserve-quota", { ...quotaReservation, operation_id: "quota-a" }));
assert.equal((await json(await quotaDO.fetch(doReq("/quota-state", { tool: "convert", limit: 3, day })))).used, 3, "retrying a completed operation cannot create another quota reservation");
const exhaustedQuotaDisplay = await quotaDO.fetch(doReq("/free-quota", { day, consume: false }));
assert.equal(exhaustedQuotaDisplay.status, 200, "a read-only quota display returns its zero balance without being treated as a network failure");
assert.equal((await json(exhaustedQuotaDisplay)).remaining, 0);

// A request ID protects both payment providers from duplicate checkout creation.
const checkoutDO = new worker.EntitlementDO({ storage: new Storage() });
const requestId = "checkout-request-123456789";
assert.equal((await json(await checkoutDO.fetch(doReq("/checkout-begin", { request_id: requestId, plan: "vip7" })))).create, true);
assert.equal((await json(await checkoutDO.fetch(doReq("/checkout-begin", { request_id: requestId, plan: "vip7" })))).retry, true, "a DePix retry reuses the same provider idempotency key");
const reopenedUncertain = await json(await checkoutDO.fetch(doReq("/checkout-begin", { request_id: "checkout-request-same-plan-123", plan: "vip7" })));
assert.equal(reopenedUncertain.retry_request_id, requestId, "a new browser request can resume the same uncertain DePix checkout");
assert.equal((await checkoutDO.fetch(doReq("/checkout-begin", { request_id: "checkout-request-other-123", plan: "vip30" }))).status, 409, "another plan cannot create a second checkout while one is pending");
await checkoutDO.fetch(doReq("/checkout-result", { request_id: requestId, plan: "vip7", result: { id: "chk-1", url: "https://pay.example/chk-1", plan: "vip7" } }));
const recoveredCheckout = await json(await checkoutDO.fetch(doReq("/checkout-begin", { request_id: requestId, plan: "vip7" })));
assert.equal(recoveredCheckout.create, false);
assert.equal(recoveredCheckout.result.id, "chk-1", "retry returns the same checkout, not a new one");
const reopenedSamePlan = await json(await checkoutDO.fetch(doReq("/checkout-begin", { request_id: "checkout-request-reopen-123", plan: "vip7" })));
assert.equal(reopenedSamePlan.result.id, "chk-1", "reopening a checkout for the same pending plan reuses its payment link");

// Provider integration: pending payment grants nothing; UID-bound paid status/webhook races grant once.
const kv = new KV();
const namespace = new Namespace();
const env = {
  PREMIUM_KV: kv, ENTITLEMENTS: namespace,
  FIREBASE_WEB_API_KEY: "firebase-test-key", DEPIX_API_KEY: "sk_test_worker",
  DEPIX_WEBHOOK_SECRET: "webhook-secret", KIWIFY_SECRET: "kiwify-test-secret",
  ALLOWED_ORIGINS: "https://app.example", PUBLIC_BASE_URL: "https://app.example"
};
const catalogResponse = await worker.default.fetch(apiRequest("/api/config", { token: "" }), env);
const publicCatalog = await catalogResponse.json();
assert.equal(publicCatalog.plans.vip24h, undefined, "legacy 24h is not offered as a new plan");
assert.deepEqual([publicCatalog.plans.world1.credit_count, publicCatalog.plans.ouro.credit_count, publicCatalog.plans.diamante.credit_count], [1, 3, 5], "public checkout catalog advertises exact credit counts");
assert.deepEqual([publicCatalog.plans.world1.price_cents, publicCatalog.plans.ouro.price_cents, publicCatalog.plans.diamante.price_cents], [599, 1499, 2290], "public checkout catalog advertises the server-authoritative prices");
assert.deepEqual([publicCatalog.plans.world1.label, publicCatalog.plans.ouro.label, publicCatalog.plans.diamante.label], ["Ferro · 1 crédito", "Ouro · 3 créditos", "Diamante · 5 créditos"], "checkout labels distinguish the tier from the account credit balance");
const testCpf = "52998224725";
const testEmail = "private-test@example.com";
await worker.default.fetch(apiRequest("/api/client-log", { method: "POST", token: "", body: { step: "depix-create", message: "CPF " + testCpf + " failed for " + testEmail, href: "https://app.example/sucesso.html?checkout_id=private-payment-id" } }), env);
const clientLogText = JSON.stringify(await kv.get("clog", "json"));
assert.ok(!clientLogText.includes(testCpf) && !clientLogText.includes(testEmail) && !clientLogText.includes("private-payment-id"), "client diagnostic logs remove CPF, email, and query identifiers");
await worker.default.fetch(apiRequest("/api/telemetry", { method: "POST", token: "", body: { event: "entitlement_load_error", plan: "creator", source: testEmail, reason: testCpf, error_type: testEmail } }), env);
await worker.default.fetch(apiRequest("/api/telemetry", { method: "POST", token: "", body: { event: "file_selected", source: "tool_hardcore" } }), env);
await worker.default.fetch(apiRequest("/api/telemetry", { method: "POST", token: "", body: { event: "kiwify_checkout_redirect", plan: "world1", source: "tool_hardcore" } }), env);
await worker.default.fetch(apiRequest("/api/telemetry", { method: "POST", token: "", body: { event: "download_started", source: "tool_hardcore" } }), env);
await worker.default.fetch(apiRequest("/api/telemetry", { method: "POST", token: "", body: { event: "operation_failed", source: "tool_hardcore" } }), env);
const analyticsText = JSON.stringify(await kv.get("analytics:" + new Date().toISOString().slice(0, 10), "json"));
assert.ok(!analyticsText.includes(testCpf) && !analyticsText.includes(testEmail), "telemetry accepts only safe dimensions, never personal values");
assert.ok(analyticsText.includes("tool_hardcore"), "the allowlisted tool source is recorded for funnel attribution");
assert.ok(analyticsText.includes("kiwify_checkout_redirect"), "Kiwify contextual checkout redirects are recorded for funnel attribution");
assert.ok(analyticsText.includes("download_started"), "the download handoff is recorded in the funnel");
assert.ok(analyticsText.includes("operation_failed"), "operation failures are recorded in the funnel");
env.ABACATEPAY_API_KEY = "abacate-test";
env.ABACATEPAY_PRODUCT_ID_24H = "legacy-24h-product";
const world1WrongProduct = await worker.default.fetch(apiRequest("/api/abacate/create", { method: "POST", body: { plan: "world1", request_id: "abacate-world1-request-0001" } }), env);
assert.equal(world1WrongProduct.status, 502, "the legacy 24h Abacate product cannot be used to create a world1 checkout");
delete env.ABACATEPAY_API_KEY;
const identities = {
  tokenA: { localId: "firebase-uid-a", email: "buyer-a@example.com", displayName: "Buyer A" },
  tokenB: { localId: "firebase-uid-b", email: "buyer-b@example.com", displayName: "Buyer B" },
  tokenC: { localId: "firebase-uid-c", email: "buyer-c@example.com", displayName: "Buyer C" },
  tokenD: { localId: "firebase-uid-d", email: "buyer-d@example.com", displayName: "Buyer D" },
  tokenE: { localId: "firebase-uid-e", email: "buyer-e@example.com", displayName: "Buyer E" },
  tokenF: { localId: "firebase-uid-f", email: "buyer-f@example.com", displayName: "Buyer F" },
  tokenG: { localId: "firebase-uid-g", email: "buyer-g@example.com", displayName: "Buyer G" },
  tokenH: { localId: "firebase-uid-h", email: "buyer-h@example.com", displayName: "Buyer H" }
};
const checkoutRecords = new Map();
const abacateRecords = new Map();
const reconcileFixtures = [];
const reconcileStatusCalls = [];
let checkoutCount = 0;
let depixCreateCalls = 0;
const depixIdempotency = new Map();
let loseNextDepixResponse = false;
let lostDepixCheckoutId = "";
let abacateCheckoutCount = 0;
let depixStatusCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  const address = String(url);
  if (address.includes("identitytoolkit.googleapis.com")) {
    const body = JSON.parse(options.body || "{}");
    if (body.idToken === "expired-token") return new Response(JSON.stringify({ error: "INVALID_ID_TOKEN" }), { status: 400 });
    if (body.idToken === "network-token") return new Response("unavailable", { status: 503 });
    const user = identities[body.idToken];
    return user ? new Response(JSON.stringify({ users: [user] }), { status: 200 }) : new Response("invalid", { status: 400 });
  }
  if (address.includes("api.depixapp.com/api/checkouts?status=")) {
    reconcileStatusCalls.push(new URL(address).searchParams.get("status"));
    return new Response(JSON.stringify({ checkouts: reconcileFixtures }), { status: 200 });
  }
  if (address === "https://api.abacatepay.com/v2/checkouts/create" && options.method === "POST") {
    const body = JSON.parse(options.body || "{}");
    const id = "aba-test-" + (++abacateCheckoutCount);
    abacateRecords.set(id, { data: { id, status: "PENDING", metadata: body.metadata, customer: { email: body.metadata.email } } });
    return new Response(JSON.stringify({ data: { id, url: "https://pay.example/" + id } }), { status: 200 });
  }
  if (address.startsWith("https://api.abacatepay.com/v2/checkouts/get?id=")) {
    const id = new URL(address).searchParams.get("id");
    const record = abacateRecords.get(id);
    return record ? new Response(JSON.stringify(record), { status: 200 }) : new Response("missing", { status: 404 });
  }
  if (address.startsWith("https://api.abacatepay.com/v1/billing/get?id=")) return new Response("missing", { status: 404 });
  if (address === "https://api.depixapp.com/api/checkouts" && options.method === "POST") {
    depixCreateCalls += 1;
    const body = JSON.parse(options.body || "{}");
    let id = depixIdempotency.get(body.idempotency_key);
    if (!id) {
      id = "chk-test-" + (++checkoutCount);
      depixIdempotency.set(body.idempotency_key, id);
      checkoutRecords.set(id, { checkout: { status: "pending", amount: body.amount, metadata: body.metadata, idempotency_key: body.idempotency_key } });
    }
    if (loseNextDepixResponse) {
      loseNextDepixResponse = false;
      lostDepixCheckoutId = id;
      return new Response("upstream connection closed after creating checkout", { status: 503 });
    }
    return new Response(JSON.stringify({ id, payment_url: "https://pay.example/" + id }), { status: 200 });
  }
  if (/api\.depixapp\.com\/api\/checkouts\//.test(address)) {
    depixStatusCalls += 1;
    const id = decodeURIComponent(address.split("/").pop());
    const record = checkoutRecords.get(id);
    if (record && record.checkout.status === "unavailable") return new Response("temporarily unavailable", { status: 503 });
    return record ? new Response(JSON.stringify(record), { status: 200 }) : new Response("missing", { status: 404 });
  }
  return new Response("not mocked", { status: 500 });
};
function apiRequest(pathname, { method = "GET", token = "tokenA", body, ip = "192.0.2.10" } = {}) {
  return new Request("https://api.example" + pathname, {
    method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": "text/plain", "CF-Connecting-IP": ip, Origin: "https://app.example" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
const paidCreateBody = { plan: "vip7", payer_tax_number: "52998224725", payer_email: "buyer-a@example.com", source: "tool_hardcore", terms_accepted: true, terms_version: "test", request_id: "client-request-unique-123" };
const missingPlan = await worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: { ...paidCreateBody, plan: undefined } }), env);
assert.equal(missingPlan.status, 400, "a missing plan never defaults to the more expensive VIP30 checkout");
const legacyPlanCheckout = await worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: { ...paidCreateBody, plan: "vip24h" } }), env);
assert.equal(legacyPlanCheckout.status, 400, "legacy 24h remains recognizable for old receipts but cannot create new checkouts");
const createResponses = await Promise.all([
  worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: paidCreateBody }), env),
  worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: paidCreateBody }), env)
]);
assert.equal(checkoutCount, 1, "one request ID creates at most one Depix checkout under concurrent clicks");
const successfulCreate = createResponses.find((response) => response.ok);
assert.ok(successfulCreate, "one concurrent checkout request should receive the created checkout");
const created = await successfulCreate.json();
assert.equal(created.plan, "vip7");
assert.equal(checkoutRecords.get(created.id).checkout.idempotency_key, paidCreateBody.request_id, "DePix receives the stable request ID as its idempotency key");
const duplicateNewRequest = await worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: { ...paidCreateBody, request_id: "client-request-reopen-same-plan" } }), env);
assert.equal((await duplicateNewRequest.json()).id, created.id, "a reopened same-plan checkout reuses the unresolved Pix URL");
assert.equal(checkoutCount, 1, "reopening the payment modal does not create a second Pix charge");
const conflictingPendingPlan = await worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: { ...paidCreateBody, plan: "vip30", request_id: "client-request-reopen-other-plan" } }), env);
assert.equal(conflictingPendingPlan.status, 409, "a pending Pix checkout blocks a second plan checkout");
let pendingResponse = await worker.default.fetch(apiRequest("/api/depix/status?id=" + encodeURIComponent(created.id)), env);
assert.equal((await pendingResponse.json()).paid, false, "pending payment does not grant an entitlement");
let entResponse = await worker.default.fetch(apiRequest("/api/entitlements"), env);
const pendingEntitlement = await entResponse.json();
assert.equal(pendingEntitlement.plan, "free");
assert.equal(pendingEntitlement.pending_payment.plan, "vip7", "a pending payment remains visible across sessions without granting access");
assert.match(pendingEntitlement.pending_payment.checkout_url, /^https:\/\/pay\.example\//, "the owner can reopen the existing pending checkout from account settings");
const blockedPendingCheckout = await worker.default.fetch(apiRequest("/api/entitlements/check", { method: "POST", token: "tokenA", body: { worlds: 1, size_bytes: 11 * MB, operation_id: "pending-paid-operation", features: { tool: "convert", mode: "keep" } } }), env);
assert.equal((await blockedPendingCheckout.json()).code, "PAYMENT_PENDING", "a pending checkout cannot trigger a misleading buy-again paywall");

// The same payment belongs only to UID A; another Firebase account cannot claim it.
const wrongOwner = await worker.default.fetch(apiRequest("/api/depix/status?id=" + encodeURIComponent(created.id), { token: "tokenB" }), env);
assert.equal(wrongOwner.status, 403, "payment linked to one UID is denied to another UID");

// Expired and unavailable Firebase tokens are distinct: 401 versus retryable 503.
assert.equal((await worker.default.fetch(apiRequest("/api/entitlements", { token: "expired-token" }), env)).status, 401);
assert.equal((await worker.default.fetch(apiRequest("/api/entitlements", { token: "network-token" }), env)).status, 503);

// Mark paid, then hit status polling and webhook simultaneously. Durable idempotency wins.
checkoutRecords.get(created.id).checkout.status = "approved";
checkoutRecords.get(created.id).checkout.paid_at = Date.now() - 60000;
const webhookBody = JSON.stringify({ type: "checkout.updated", data: { id: created.id, status: "approved" } });
async function signedWebhook() {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.DEPIX_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + webhookBody));
  const hex = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://api.example/api/depix/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-DePix-Signature": "t=" + timestamp + ",v1=" + hex }, body: webhookBody });
}
const simultaneous = await Promise.all([
  worker.default.fetch(apiRequest("/api/depix/status?id=" + encodeURIComponent(created.id)), env),
  signedWebhook().then((request) => worker.default.fetch(request, env))
]);
assert.ok(simultaneous.every((response) => response.ok), "status and signed webhook can race safely");
const paidEntitlement = await worker.getUserEntitlements(env, "firebase-uid-a", identities.tokenA);
assert.equal(paidEntitlement.plan, "vip7");
assert.equal(paidEntitlement.active, true);
assert.equal(paidEntitlement.max_file_mb, 500);
assert.equal(paidEntitlement.world_credits, 0, "time passes do not consume world credits");
assert.ok(paidEntitlement.expires_at);
assert.ok(Date.parse(paidEntitlement.expires_at) <= checkoutRecords.get(created.id).checkout.paid_at + 7 * 86400000 + 100, "VIP7 expiry follows payment confirmation time during status/webhook reconciliation");
const confirmedFunnel = await kv.get("analytics:" + new Date().toISOString().slice(0, 10), "json");
assert.equal(confirmedFunnel.sources.tool_hardcore.payment_paid, 1, "server-confirmed payment keeps the tool source and is counted once");

// A provider response can be lost after it created a Pix checkout. The durable
// request lock exposes an uncertain state and the provider idempotency key
// lets a retry recover the same charge without creating another one.
loseNextDepixResponse = true;
const lostRequestBody = { ...paidCreateBody, payer_email: "buyer-g@example.com", request_id: "client-request-lost-response-1" };
const lostFirstResponse = await worker.default.fetch(apiRequest("/api/depix/create", { token: "tokenG", method: "POST", body: lostRequestBody }), env);
assert.equal(lostFirstResponse.status, 502, "the test provider simulates a response lost after checkout creation");
const uncertainG = await worker.default.fetch(apiRequest("/api/entitlements", { token: "tokenG" }), env);
const uncertainGEntitlement = await uncertainG.json();
assert.equal(uncertainGEntitlement.pending_payment.status, "checkout_creation_uncertain", "the account shows an unresolved checkout instead of a free paywall");
const blockedSecondCharge = await worker.default.fetch(apiRequest("/api/depix/create", { token: "tokenG", method: "POST", body: { ...lostRequestBody, plan: "vip30", request_id: "client-request-lost-new-id-1" } }), env);
assert.equal(blockedSecondCharge.status, 409, "an ambiguous checkout blocks creation of a second charge");
const recoveredPix = await worker.default.fetch(apiRequest("/api/depix/create", { token: "tokenG", method: "POST", body: { ...lostRequestBody, request_id: "client-request-lost-reopen-1" } }), env);
assert.equal((await recoveredPix.json()).id, lostDepixCheckoutId, "retry with the same idempotency key recovers the original Pix checkout");
assert.equal(checkoutCount, 2, "the lost-response retry creates exactly one provider checkout");

// Scheduled payment recovery must ignore processing items even if a provider list is stale.
reconcileFixtures.push(
  { id: "processing-world-credit", status: "processing", metadata: { firebase_uid: "firebase-uid-d", email: "buyer-d@example.com", plan: "world1" } },
  { id: "approved-vip7", status: "approved", paid_at: Date.now(), metadata: { firebase_uid: "firebase-uid-d", email: "buyer-d@example.com", plan: "vip7" } }
);
const reconciliation = await worker.reconcileRecentDepixCheckouts(env);
assert.equal(reconciliation.recovered, 1, "scheduled reconciliation grants only explicitly confirmed payments");
assert.deepEqual(reconcileStatusCalls, ["approved", "completed"], "scheduled reconciliation does not request the processing bucket");
const reconciledD = await worker.getUserEntitlements(env, "firebase-uid-d", identities.tokenD);
assert.equal(reconciledD.plan, "vip7");
assert.equal(reconciledD.world_credits, 0, "a processing one-world payment cannot grant a credit");
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-b", identities.tokenB)).plan, "free", "UID B does not receive UID A's payment");
const afterRefresh = await worker.default.fetch(apiRequest("/api/entitlements"), env);
assert.equal((await afterRefresh.json()).plan, "vip7", "fresh session on the same Firebase UID sees the purchased pass");

// A paid checkout with a missed webhook is recovered on the next account load on any device.
const autoCreate = await worker.default.fetch(apiRequest("/api/depix/create", { token: "tokenD", method: "POST", body: { ...paidCreateBody, payer_email: "buyer-d@example.com", request_id: "client-request-auto-reconcile-1" } }), env);
assert.equal(autoCreate.status, 200);
const autoCheckout = await autoCreate.json();
checkoutRecords.get(autoCheckout.id).checkout.status = "completed";
checkoutRecords.get(autoCheckout.id).checkout.paid_at = Date.now() - 120000;
const autoRecovered = await worker.default.fetch(apiRequest("/api/entitlements", { token: "tokenD" }), env);
const recoveredEntitlement = await autoRecovered.json();
assert.equal(recoveredEntitlement.plan, "vip7", "the entitlement endpoint reconciles an approved pending checkout without waiting for a webhook");
assert.equal(recoveredEntitlement.pending_payment, null);
assert.equal(recoveredEntitlement.world_credits, 0);
const uncertainCreate = await worker.default.fetch(apiRequest("/api/depix/create", { token: "tokenE", method: "POST", body: { ...paidCreateBody, payer_email: "buyer-e@example.com", request_id: "client-request-provider-error-1" } }), env);
const uncertainCheckout = await uncertainCreate.json();
checkoutRecords.get(uncertainCheckout.id).checkout.status = "unavailable";
const uncertainEntitlement = await worker.default.fetch(apiRequest("/api/entitlements", { token: "tokenE" }), env);
assert.equal(uncertainEntitlement.status, 503, "an unavailable payment provider does not turn an unresolved paid checkout into free access");

const mismatchedUidCreate = await worker.default.fetch(apiRequest("/api/depix/create", { method: "POST", body: { ...paidCreateBody, request_id: "client-request-uid-mismatch-1" } }), env);
const mismatchedUidCheckout = await mismatchedUidCreate.json();
checkoutRecords.get(mismatchedUidCheckout.id).checkout.metadata.firebase_uid = "firebase-uid-b";
checkoutRecords.get(mismatchedUidCheckout.id).checkout.status = "approved";
const mismatchedUidStatus = await worker.default.fetch(apiRequest("/api/depix/status?id=" + encodeURIComponent(mismatchedUidCheckout.id), { token: "tokenA" }), env);
assert.equal(mismatchedUidStatus.status, 403, "provider UID and UID recorded when checkout was created must agree");
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-b", identities.tokenB)).plan, "free", "conflicting payment metadata cannot grant the provider's different UID");

// Abacate fallback preserves exact plan and Firebase ownership, including if its KV mirror is missing.
env.ABACATEPAY_API_KEY = "abacate-test-key";
env.ABACATEPAY_PRODUCT_ID_WORLD1 = "world1-dedicated-product";
env.WEBHOOK_SECRET = "abacate-webhook-secret";
const abacateCreated = await worker.default.fetch(apiRequest("/api/abacate/create", {
  token: "tokenF", method: "POST", body: { plan: "world1", request_id: "abacate-world1-request-0001", source: "tool_keep_inventory", terms_accepted: true }
}), env);
assert.equal(abacateCreated.status, 200);
const abacateCheckout = await abacateCreated.json();
const duplicateAbacate = await worker.default.fetch(apiRequest("/api/abacate/create", {
  token: "tokenF", method: "POST", body: { plan: "world1", request_id: "abacate-world1-reopen-0001", terms_accepted: true }
}), env);
assert.equal((await duplicateAbacate.json()).id, abacateCheckout.id, "reopening the fallback checkout reuses the pending provider link");
assert.equal(abacateCheckoutCount, 1, "reopening AbacatePay cannot create a duplicate charge");
const pendingAbacate = await worker.default.fetch(apiRequest("/api/abacate/status?id=" + encodeURIComponent(abacateCheckout.id), { token: "tokenF" }), env);
assert.equal((await pendingAbacate.json()).paid, false, "Abacate pending checkout does not grant the purchased plan");
const wrongAbacateOwner = await worker.default.fetch(apiRequest("/api/abacate/status?id=" + encodeURIComponent(abacateCheckout.id), { token: "tokenA" }), env);
assert.equal(wrongAbacateOwner.status, 403, "Abacate status is private to the checkout Firebase UID, even before payment");
abacateRecords.get(abacateCheckout.id).data.status = "UNPAID";
assert.equal((await (await worker.default.fetch(apiRequest("/api/abacate/status?id=" + encodeURIComponent(abacateCheckout.id), { token: "tokenF" }), env)).json()).paid, false, "UNPAID is not accepted as a paid state");
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-f", identities.tokenF)).world_credits, 0);

abacateRecords.get(abacateCheckout.id).data.status = "PAID";
await kv.delete("pend:" + abacateCheckout.id); // provider metadata and the UID-bound checkout record remain authoritative
const abacateWebhook = new Request("https://api.example/api/abacate/webhook?secret=" + env.WEBHOOK_SECRET, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { billing: { id: abacateCheckout.id } } })
});
const abacateRace = await Promise.all([
  worker.default.fetch(apiRequest("/api/abacate/status?id=" + encodeURIComponent(abacateCheckout.id), { token: "tokenF" }), env),
  worker.default.fetch(abacateWebhook, env)
]);
assert.ok(abacateRace.every((response) => response.ok), "Abacate status and webhook can race without duplicating a grant");
const abacateEntitlement = await worker.getUserEntitlements(env, "firebase-uid-f", identities.tokenF);
assert.equal(abacateEntitlement.plan, "world1", "the provider metadata grants the exact World1 plan when the KV mirror is missing");
assert.equal(abacateEntitlement.world_credits, 1);
assert.equal(abacateEntitlement.premium_until_ms, 0, "World1 never turns into a time pass");
const abacateFunnel = await kv.get("analytics:" + new Date().toISOString().slice(0, 10), "json");
assert.equal(abacateFunnel.sources.tool_keep_inventory.payment_paid, 1, "Abacate keeps the contextual tool source through the paid confirmation");
const orphanAbacate = "aba-orphan-paid-without-plan";
abacateRecords.set(orphanAbacate, { data: { id: orphanAbacate, status: "PAID", metadata: { firebase_uid: "firebase-uid-f", email: "buyer-f@example.com" } } });
const missingAbacatePlan = await worker.default.fetch(apiRequest("/api/abacate/status?id=" + encodeURIComponent(orphanAbacate), { token: "tokenF" }), env);
assert.equal(missingAbacatePlan.status, 409, "confirmed provider metadata without a plan is never guessed as VIP30");
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-f", identities.tokenF)).premium_until_ms, 0);

// The authoritative route allows repeated VIP operations, and never trusts plan/max-size from the browser.
async function check(token, body) {
  return worker.default.fetch(apiRequest("/api/entitlements/check", { method: "POST", token, body }), env);
}
for (const [i, size] of [11, 100, 499].entries()) {
  const response = await check("tokenA", { worlds: 1, size_bytes: size * MB, operation_id: "vip7-op-" + i, features: { tool: "convert", mode: "keep" } });
  assert.equal(response.status, 200, "VIP7 can repeat operations after refresh");
  const decision = await response.json();
  assert.equal(decision.plan, "vip7");
  assert.equal(decision.requires_completion, false, "time passes do not use world-credit completion semantics");
}
assert.equal((await check("tokenA", { worlds: 1, size_bytes: 500 * MB + 1, operation_id: "vip7-too-big", features: { tool: "convert", mode: "keep" } })).status, 403);
const forged = await check("tokenB", { worlds: 1, size_bytes: 11 * MB, operation_id: "forged-plan", plan: "creator", max_file_mb: 99999, features: { tool: "convert", mode: "keep" } });
assert.equal((await forged.json()).code, "NO_ENTITLEMENT", "client-supplied creator plan and file cap do not grant access");
const unknownTool = await check("tokenA", { worlds: 1, size_bytes: 11 * MB, operation_id: "unknown-paid-tool", features: { tool: "future_unlisted_tool" } });
assert.equal((await unknownTool.json()).code, "TOOL_NOT_INCLUDED", "paid accounts cannot authorize tools absent from their plan catalog");
const missingSize = await check("tokenA", { worlds: 1, operation_id: "missing-size", features: { tool: "convert" } });
assert.equal(missingSize.status, 400, "the entitlement API rejects file checks with a missing size");

// world1 project authorization: failures release, retries are idempotent, same-world edits do not spend again.
const uidBStub = namespace.get(namespace.idFromName("firebase-uid-b"));
await uidBStub.fetch(doReq("/grant", { plan: "world1", billing_id: "test-world-credit" }));
const worldFingerprint = "d".repeat(64);
const noOperationId = await check("tokenB", { worlds: 1, size_bytes: 100 * MB, world_fingerprint: worldFingerprint, features: { tool: "convert", mode: "keep" } });
assert.equal(noOperationId.status, 400, "world-credit authorization requires a reservation ID");
let worldAuth = await check("tokenB", { worlds: 1, size_bytes: 100 * MB, operation_id: "route-world-failed", world_fingerprint: worldFingerprint, features: { tool: "convert", mode: "keep" } });
assert.equal(worldAuth.status, 200);
let worldDecision = await worldAuth.json();
assert.equal(worldDecision.requires_completion, true);
await worker.default.fetch(apiRequest("/api/entitlements/release", { method: "POST", token: "tokenB", body: { operation_id: "route-world-failed" } }), env);
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-b", identities.tokenB)).world_credits, 1, "failed operation does not consume the credit");

worldAuth = await check("tokenB", { worlds: 1, size_bytes: 100 * MB, operation_id: "route-world-success", world_fingerprint: worldFingerprint, features: { tool: "convert", mode: "keep" } });
worldDecision = await worldAuth.json();
const worldId = worldDecision.world_project_id;
const completeRequest = () => apiRequest("/api/entitlements/complete", { method: "POST", token: "tokenB", body: { operation_id: "route-world-success" } });
const completions = await Promise.all([worker.default.fetch(completeRequest(), env), worker.default.fetch(completeRequest(), env)]);
assert.ok(completions.every((response) => response.ok));
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-b", identities.tokenB)).world_credits, 0, "completion retries spend exactly one credit");
worldAuth = await check("tokenB", { worlds: 1, size_bytes: 100 * MB, operation_id: "route-world-repeat", world_fingerprint: worldFingerprint, features: { tool: "convert", mode: "keep" } });
worldDecision = await worldAuth.json();
assert.equal(worldDecision.world_project_id, worldId, "the same original world fingerprint keeps its project across sessions");
const repeatComplete = await worker.default.fetch(apiRequest("/api/entitlements/complete", { method: "POST", token: "tokenB", body: { operation_id: "route-world-repeat" } }), env);
assert.equal((await repeatComplete.json()).credit_consumed, false, "a second edit to the same project does not consume a second credit");
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-b", identities.tokenB)).active, true, "active world project remains usable after page refresh");

// Free requests from an anonymous session still use server quota and file limits.
const missingFreeOperationId = await worker.default.fetch(apiRequest("/api/entitlements/check", { method: "POST", token: "", ip: "192.0.2.44", body: { worlds: 1, size_bytes: 5 * MB, features: { tool: "convert", mode: "keep" } } }), env);
assert.equal(missingFreeOperationId.status, 400, "free quota checks require an operation ID so completion can be counted");
const anonymousFive = await worker.default.fetch(apiRequest("/api/entitlements/check", { method: "POST", token: "", ip: "192.0.2.44", body: { worlds: 1, size_bytes: 5 * MB, operation_id: "anonymous-five", features: { tool: "convert", mode: "keep" } } }), env);
assert.equal(anonymousFive.status, 200);
await worker.default.fetch(apiRequest("/api/entitlements/complete", { method: "POST", token: "", ip: "192.0.2.44", body: { operation_id: "anonymous-five" } }), env);
const anonymousEleven = await worker.default.fetch(apiRequest("/api/entitlements/check", { method: "POST", token: "", ip: "192.0.2.44", body: { worlds: 1, size_bytes: 11 * MB, operation_id: "anonymous-eleven", features: { tool: "convert", mode: "keep" } } }), env);
assert.equal((await anonymousEleven.json()).code, "NO_ENTITLEMENT");
const anonymousBuilder = await worker.default.fetch(apiRequest("/api/entitlements/check", { method: "POST", token: "", ip: "192.0.2.55", body: { worlds: 1, size_bytes: 5 * MB, operation_id: "anonymous-builder", features: { tool: "builder" } } }), env);
assert.equal(anonymousBuilder.status, 200, "free beta builder operations use the same entitlement API");
assert.equal((await anonymousBuilder.json()).free_quota_remaining[0].tool, "builder");
await worker.default.fetch(apiRequest("/api/entitlements/complete", { method: "POST", token: "", ip: "192.0.2.55", body: { operation_id: "anonymous-builder" } }), env);

// Kiwify callback is email-receipt based until the verified Google email claims it.
const activeKiwifyBody = { order_status: "active", order_id: "kw-active-not-paid", Product: { product_name: "Criador" }, Customer: { email: "buyer-c@example.com" } };
const activeKiwifyResponse = await worker.default.fetch(new Request("https://api.example/api/kiwify/webhook?secret=" + env.KIWIFY_SECRET, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(activeKiwifyBody)
}), env);
assert.equal((await activeKiwifyResponse.json()).granted, false, "an active subscription state without a paid event is not a confirmed purchase");
assert.ok(!(await kv.get("payrec:email:buyer-c%40example.com:kiwify:kw-active-not-paid")), "an active subscription state creates no payment receipt");
assert.equal((await worker.getUserEntitlements(env, "firebase-uid-c", identities.tokenC)).plan, "free", "an active subscription state grants no entitlement");
const kiwifyBody = { order_status: "paid", webhook_event_type: "order_approved", order_id: "kw-creator-1", Product: { product_name: "Criador" }, Customer: { email: "buyer-c@example.com" } };
const kiwifyRequest = new Request("https://api.example/api/kiwify/webhook?secret=" + env.KIWIFY_SECRET, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kiwifyBody) });
let kiwifyResponse = await worker.default.fetch(kiwifyRequest, env);
assert.equal((await kiwifyResponse.json()).paid, true);
const claimedCreator = await worker.getUserEntitlements(env, "firebase-uid-c", identities.tokenC);
assert.equal(claimedCreator.plan, "creator", "verified same-email Google login claims the Kiwify entitlement");
assert.equal(claimedCreator.max_batch, 20);
assert.equal(claimedCreator.max_file_bytes, null);
const kiwifyAdminPurchase = (await kv.get("admin:purchases", "json")).find((item) => item.id === "kiwify:kw-creator-1");
assert.equal(kiwifyAdminPurchase.uid, "firebase-uid-c", "claim reconciliation attaches the verified UID to the payment-ID audit record");
assert.equal(kiwifyAdminPurchase.provider, "kiwify");
kiwifyResponse = await worker.default.fetch(new Request("https://api.example/api/kiwify/webhook?secret=" + env.KIWIFY_SECRET, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kiwifyBody) }), env);
assert.equal((await kiwifyResponse.json()).duplicate, true, "duplicate Kiwify webhook does not grant twice");

// Unknown products and unsafe origins do not create access.
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "Outro produto" } }, {}), "");
const nullOrigin = worker.corsHeaders(new Request("https://api.example", { headers: { Origin: "null" } }), { ALLOWED_ORIGINS: "https://app.example" });
assert.equal(nullOrigin["Access-Control-Allow-Origin"], undefined);
assert.equal(worker.corsHeaders(new Request("https://api.example", { headers: { Origin: "https://app.example" } }), { ALLOWED_ORIGINS: "https://app.example" })["Access-Control-Allow-Origin"], "https://app.example");
// The package checkout accepts the new SKU and charges its server catalog amount.
const ouroCheckout = await worker.default.fetch(apiRequest("/api/depix/create", {
  token: "tokenH", method: "POST", ip: "192.0.2.18",
  body: { plan: "ouro", payer_tax_number: "52998224725", payer_email: "buyer-h@example.com", source: "pricing_card", terms_accepted: true, terms_version: "test", request_id: "bundle-order-ouro-001" }
}), env);
assert.equal(ouroCheckout.status, 200, "Ouro package can create a Depix checkout");
const ouroCheckoutBody = await ouroCheckout.json();
assert.equal(ouroCheckoutBody.plan, "ouro");
assert.equal(checkoutRecords.get(ouroCheckoutBody.id).checkout.amount, 1499, "Depix amount comes from the server catalog and cannot be replaced by a client price");
assert.equal(checkoutRecords.get(ouroCheckoutBody.id).checkout.metadata.plan, "ouro");
assert.ok(depixStatusCalls > 0, "status lookup reached the payment provider");
console.log("Entitlement/payment tests passed.");
