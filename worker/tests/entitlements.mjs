import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const worker = await import(pathToFileURL(path.resolve("src/index.js")).href);

class Storage {
  constructor() { this.map = new Map(); }
  async get(k, type) {
    const value = this.map.get(k);
    return type === "json" && typeof value === "string" ? JSON.parse(value) : value;
  }
  async put(k, v) { this.map.set(k, v); }
}
function req(pathname, body) {
  return new Request("https://entitlements" + pathname, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function json(res) { return res.json(); }

const state = { storage: new Storage() };
const dobj = new worker.EntitlementDO(state);
let r = await json(await dobj.fetch(req("/grant", { plan: "world1", billing_id: "pay-1" })));
assert.equal(r.world_credits, 1);
r = await json(await dobj.fetch(req("/grant", { plan: "world1", billing_id: "pay-1" })));
assert.equal(r.world_credits, 1, "webhook/status duplicate must not add a second credit");
r = await json(await dobj.fetch(req("/consume", { operation_id: "op-1", worlds: 1 })));
assert.equal(r.consumed, true);
r = await json(await dobj.fetch(req("/consume", { operation_id: "op-1", worlds: 1 })));
assert.equal(r.duplicate, true, "retry after successful processing must be idempotent");
const exhausted = await dobj.fetch(req("/consume", { operation_id: "op-2", worlds: 1 }));
assert.equal(exhausted.status, 409, "a second world must be rejected");
let fq = await json(await dobj.fetch(req("/free-quota", { day: "2026-09-21" })));
assert.equal(fq.remaining, 3);
for (let i = 0; i < 3; i++) await dobj.fetch(req("/free-quota", { day: "2026-09-21", consume: true }));
const freeExhausted = await dobj.fetch(req("/free-quota", { day: "2026-09-21", consume: true }));
assert.equal(freeExhausted.status, 402, "free quota must be atomic and capped");
const now = Date.now();
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 1, 150 * 1024 * 1024, now).allowed, true);
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 2, 10, now).code, "BATCH_LIMIT");
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 1, 151 * 1024 * 1024, now).code, "SIZE_LIMIT");
assert.equal(worker.checkEntitlement({ plan: "vip7", world_credits: 0, premium_until_ms: now + 86400000 }, 5, 500 * 1024 * 1024, now).allowed, true);
assert.equal(worker.checkEntitlement({ plan: "vip7", world_credits: 0, premium_until_ms: now - 1 }, 1, 10, now).code, "NO_ENTITLEMENT");
assert.equal(worker.checkEntitlement({ plan: "", world_credits: 0, premium_until_ms: 0 }, 1, 10, now, { mode: "creative" }).code, "NO_ENTITLEMENT");
assert.equal(worker.checkEntitlement({ plan: "vip7", world_credits: 0, premium_until_ms: now + 86400000 }, 1, 10, now, { mode: "keep", advanced_rules: true }).allowed, true);
assert.equal(worker.isSecurityResearcherReward({ SECURITY_REWARD_EMAIL: "Researcher@Example.com" }, "researcher@example.com"), true);
assert.equal(worker.isSecurityResearcherReward({ SECURITY_REWARD_EMAIL: "Researcher@Example.com" }, "other@example.com"), false);
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "1 MUNDO" } }, {}), "world1");
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "Passe 7 dias" } }, {}), "vip7");
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "VIP 30 DIAS" } }, {}), "vip30");
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "Criador" } }, {}), "creator");
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "Outro produto" } }, {}), "", "unknown Kiwify products must not become VIP30");
assert.equal(worker.normalizeKiwifyPlan({ order_status: "paid", Product: { product_name: "Outro Resolver de Mundos" } }, {}), "", "product matching must use known product names only");
const kiwifyKv = new Storage();
const kiwifyEnv = { PREMIUM_KV: kiwifyKv, KIWIFY_SECRET: "test-secret", ALLOWED_ORIGINS: "https://app.example" };
const kwReq = (body, secret = "test-secret") => new Request("https://api.example/api/kiwify/webhook?secret=" + secret, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});
const kwBody = { order_status: "paid", webhook_event_type: "order_approved", order_id: "kw-1", Product: { product_name: "VIP 30 DIAS" }, Customer: { email: "buyer@example.com" } };
let kw = await json(await worker.default.fetch(kwReq(kwBody), kiwifyEnv));
assert.equal(kw.granted, true);
assert.equal(kw.plan, "vip30");
kw = await json(await worker.default.fetch(kwReq(kwBody), kiwifyEnv));
assert.equal(kw.duplicate, true, "replayed Kiwify webhooks must not grant twice");
kw = await json(await worker.default.fetch(kwReq({ ...kwBody, order_id: "kw-unknown", Product: { product_name: "Produto fora do ReativaConquistas" } }), kiwifyEnv));
assert.equal(kw.granted, false, "unknown Kiwify products must be ignored");
const nullOrigin = worker.corsHeaders(new Request("https://api.example", { headers: { Origin: "null" } }), { ALLOWED_ORIGINS: "https://app.example" });
assert.equal(nullOrigin["Access-Control-Allow-Origin"], undefined, "Origin null must not receive wildcard CORS");
const allowedOrigin = worker.corsHeaders(new Request("https://api.example", { headers: { Origin: "https://app.example" } }), { ALLOWED_ORIGINS: "https://app.example" });
assert.equal(allowedOrigin["Access-Control-Allow-Origin"], "https://app.example");
console.log("PASS: one-world grant is idempotent and consumed exactly once.");
