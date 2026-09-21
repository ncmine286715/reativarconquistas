import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const worker = await import(pathToFileURL(path.resolve("src/index.js")).href);

class Storage {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.get(k); }
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
const now = Date.now();
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 1, 150 * 1024 * 1024, now).allowed, true);
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 2, 10, now).code, "BATCH_LIMIT");
assert.equal(worker.checkEntitlement({ plan: "world1", world_credits: 1, premium_until_ms: 0 }, 1, 151 * 1024 * 1024, now).code, "SIZE_LIMIT");
assert.equal(worker.checkEntitlement({ plan: "vip7", world_credits: 0, premium_until_ms: now + 86400000 }, 5, 500 * 1024 * 1024, now).allowed, true);
assert.equal(worker.checkEntitlement({ plan: "vip7", world_credits: 0, premium_until_ms: now - 1 }, 1, 10, now).code, "NO_ENTITLEMENT");
console.log("PASS: one-world grant is idempotent and consumed exactly once.");
