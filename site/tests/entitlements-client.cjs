const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "entitlements.js"), "utf8");
let currentUser = { uid: "uid-a", email: "a@example.com" };
let entitlementReply = null;
let catalogReply = null;
let entitlementCalls = 0;
let catalogCalls = 0;
const context = {
  window: {},
  document: { addEventListener() {} },
  Promise, Date, Number, Array, Object, Error, String, Boolean, Math, setTimeout, clearTimeout,
  console: { error() {}, warn() {}, log() {} }
};
context.window.RC_auth = {
  ready: true,
  error: null,
  user: () => currentUser,
  onChange() {}
};
context.window.RC_pay = {
  entitlements: async () => { entitlementCalls++; if (entitlementReply instanceof Error) throw entitlementReply; return entitlementReply; },
  planCatalog: async () => { catalogCalls++; if (catalogReply instanceof Error) throw catalogReply; return catalogReply; },
  track() {},
  authorizeOperation: async (...args) => ({ args })
};
vm.runInNewContext(source, context, { filename: "entitlements.js" });

function serverEntitlement(plan, maxFileMb, maxBatch, extra = {}) {
  const maxFileBytes = maxFileMb === null ? null : maxFileMb * 1024 * 1024;
  return {
    authenticated: true, active: true, status: "active", plan, plan_label: plan,
    expires_at: "2026-10-01T00:00:00.000Z", premium_until_ms: Date.now() + 86400000,
    world_credits: 0, active_world_projects: 0, max_file_mb: maxFileMb,
    max_file_bytes: maxFileBytes, max_batch: maxBatch, allowed_tools: ["convert", "chunks_restore"],
    capabilities: { premium_features: true }, account_email: currentUser.email, ...extra
  };
}

(async function () {
  entitlementReply = serverEntitlement("vip7", 500, 5);
  let ent = await context.window.RC_entitlements.load();
  assert.equal(ent.status, "ready");
  assert.equal(ent.plan, "vip7");
  assert.equal(context.window.RC_entitlements.canUseFile([{ size: 11 * 1024 * 1024 }]).allowed, true);
  assert.equal(context.window.RC_entitlements.canUseFile([{ size: 499 * 1024 * 1024 }]).allowed, true);
  assert.equal(context.window.RC_entitlements.canUseFile([{ size: 500 * 1024 * 1024 + 1 }]).allowed, false);
  assert.equal(context.window.RC_entitlements.canUseFile(Array(6).fill({ size: 1 })).allowed, false);

  await context.window.RC_entitlements.refresh();
  assert.equal(entitlementCalls, 2, "explicit refresh reads the backend again");

  currentUser = { uid: "uid-b", email: "b@example.com" };
  assert.equal(context.window.RC_entitlements.state().status, "loading");
  assert.equal(context.window.RC_entitlements.state().max_file_bytes, null, "a new account cannot see the previous account's cached plan while loading");
  entitlementReply = serverEntitlement("vip30", null, 10);
  ent = await context.window.RC_entitlements.refresh();
  assert.equal(ent.plan, "vip30");

  entitlementReply = Object.assign(new Error("backend offline"), { status: 503 });
  await assert.rejects(context.window.RC_entitlements.refresh());
  ent = context.window.RC_entitlements.state();
  assert.equal(ent.status, "error");
  assert.equal(ent.plan, "", "network failure is never rewritten as the free plan");
  const unavailableFile = context.window.RC_entitlements.canUseFile([{ size: 1 }]);
  assert.equal(unavailableFile.status, "error");
  assert.equal(unavailableFile.allowed, false, "an unavailable entitlement is not evaluated as a free plan");
  assert.match(context.window.RC_entitlements.messageForError(entitlementReply), /Nenhuma nova compra/);

  entitlementReply = serverEntitlement("free", 10, 2, { active: false, pending_payment: { plan: "vip7", plan_label: "Passe 7 dias", status: "pending" } });
  await context.window.RC_entitlements.refresh();
  assert.match(context.window.RC_entitlements.messageForPending(context.window.RC_entitlements.state().pending_payment), /não faça outra compra/);

  entitlementReply = Object.assign(new Error("expired"), { status: 401 });
  await assert.rejects(context.window.RC_entitlements.refresh());
  assert.equal(context.window.RC_entitlements.state().status, "session_expired");

  entitlementReply = { authenticated: true, plan: "vip7", max_file_bytes: "invalid" };
  await assert.rejects(context.window.RC_entitlements.refresh());
  assert.equal(context.window.RC_entitlements.state().status, "error", "malformed server responses fail closed without claiming free status");

  currentUser = null;
  catalogReply = { free: { id: "free",
    label: "Plano gratuito", max_file_mb: 10, max_file_bytes: 10 * 1024 * 1024,
    max_batch: 2, allowed_tools: ["convert"], capabilities: { convert: { daily_operations: 3 } }
  } };
  ent = await context.window.RC_entitlements.refresh();
  assert.equal(ent.status, "unauthenticated");
  assert.equal(ent.plan, "free");
  assert.equal(context.window.RC_entitlements.canUseFile([{ size: 5 * 1024 * 1024 }]).allowed, true);
  assert.equal(context.window.RC_entitlements.canUseFile([{ size: 11 * 1024 * 1024 }]).allowed, false);
  assert.equal(catalogCalls, 1);
  console.log("PASS: entitlement client separates active, free, network, expired, and invalid-response states.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
