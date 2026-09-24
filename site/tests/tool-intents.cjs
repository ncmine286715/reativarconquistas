const assert = require("node:assert/strict");
const intents = require("../tool-intents.js");

assert.equal(intents.fromSearch("?tool=reativar%20conquistas").slug, "conquistas");
assert.equal(intents.fromSearch("?ferramenta=keep_inventory").targetId, "keepOpt");
assert.equal(intents.resolve("hardcore").targetId, "hardcoreOpt");
assert.equal(intents.resolve("builder").href, "builder-lab.html");
assert.equal(intents.resolve("unknown-tool"), null, "unknown values are ignored instead of becoming selectors or markup");

const mb = 1024 * 1024;
const catalog = {
  world1: { price_cents: 599, max_file_bytes: 150 * mb, max_batch: 1 },
  vip7: { price_cents: 799, max_file_bytes: 500 * mb, max_batch: 5 },
  vip30: { price_cents: 2490, max_file_bytes: null, max_batch: 10 },
  creator: { price_cents: 3990, max_file_bytes: null, max_batch: 20 }
};
assert.deepEqual(intents.eligiblePlanIds(["world1", "vip7", "vip30", "creator"], catalog, { world_size_bytes: 200 * mb, worlds: 1 }), ["vip7", "vip30", "creator"]);
assert.deepEqual(intents.eligiblePlanIds(["world1", "vip7", "vip30", "creator"], catalog, { world_size_bytes: 600 * mb, worlds: 15 }), ["creator"]);
assert.deepEqual(intents.eligiblePlanIds(catalog, { world_size_bytes: 200 * mb, worlds: 1 }), ["vip7", "vip30", "creator"], "default plan order remains supported");
assert.equal(intents.choosePlan(["vip7", "vip30"], "world1", catalog), "vip7", "selects the lowest-priced plan that can handle the file");
assert.equal(intents.returnHref("hardcore", true), "index.html?tool=hardcore&resume=1#converter");

console.log("PASS: video tool intents are allowlisted and plan choices respect server catalog limits.");
