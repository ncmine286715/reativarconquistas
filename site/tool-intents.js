/* Small, allowlisted helpers for video-to-tool links and relevant plan choices. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.RC_toolIntents = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var DEFINITIONS = {
    conquistas: { label: "Reativar conquistas", targetId: "operationActions" },
    hardcore: { label: "Recuperar mundo Hardcore", targetId: "hardcoreOpt" },
    criativo: { label: "Criativo com conquistas", targetId: "modeOpt" },
    "keep-inventory": { label: "Keep Inventory", targetId: "keepOpt" },
    jogador: { label: "Editor de inventário", targetId: "accPlayer" },
    addons: { label: "Gerenciar addons", targetId: "packOpt" },
    chunks: { label: "Restaurar chunks", targetId: "accChunks" },
    mundo: { label: "Ferramentas do mundo", targetId: "accFree" },
    upload: { label: "Selecionar mundo", targetId: "drop" },
    builder: { label: "Builder 3D", href: "builder-lab.html", targetId: "worldFile" }
  };
  var ALIASES = {
    achievements: "conquistas", achievement: "conquistas", "reactivate-achievements": "conquistas", "reativar-conquistas": "conquistas",
    creative: "criativo", "creative-mode": "criativo", "modo-criativo": "criativo",
    "keepinventory": "keep-inventory", "keep_inventory": "keep-inventory", inventario: "jogador", inventory: "jogador", player: "jogador",
    addon: "addons", packs: "addons", construction: "builder", construcao: "builder",
    world: "mundo", settings: "mundo", converter: "upload", conversor: "upload"
  };
  var PLAN_ORDER = ["world1", "vip7", "vip30", "creator"];

  function normalize(value) {
    var text = String(value == null ? "" : value).trim().toLowerCase();
    try { text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return text.replace(/[\s_]+/g, "-");
  }

  function resolve(value) {
    var key = normalize(value);
    key = ALIASES[key] || key;
    var definition = DEFINITIONS[key];
    return definition ? Object.assign({ slug: key }, definition) : null;
  }

  function fromSearch(search) {
    var params;
    try { params = new URLSearchParams(String(search || "")); } catch (e) { return null; }
    return resolve(params.get("tool") || params.get("ferramenta") || params.get("feature"));
  }

  function eligiblePlanIds(ids, catalog, context) {
    if (!Array.isArray(ids)) {
      context = catalog || {};
      catalog = ids || {};
      ids = PLAN_ORDER;
    }
    catalog = catalog || {};
    context = context || {};
    var size = Number(context.world_size_bytes || context.size_bytes || 0);
    var worlds = Math.max(1, Number(context.worlds || 1));
    return ids.filter(function (id) {
      var plan = catalog[id];
      if (!plan) return false;
      var maxBytes = plan.max_file_bytes;
      if (maxBytes === undefined && plan.max_file_mb !== null && plan.max_file_mb !== undefined) maxBytes = Number(plan.max_file_mb) * 1024 * 1024;
      if (size > 0 && maxBytes !== null && maxBytes !== undefined && size > Number(maxBytes)) return false;
      var maxBatch = Number(plan.max_batch || 1);
      return worlds <= maxBatch;
    });
  }

  function choosePlan(ids, selected, catalog) {
    if (!ids || !ids.length) return "";
    if (ids.indexOf(selected) >= 0) return selected;
    return ids.slice().sort(function (a, b) {
      return (Number(catalog[a] && catalog[a].price_cents) || 0) - (Number(catalog[b] && catalog[b].price_cents) || 0);
    })[0];
  }

  function returnHref(intent, resume) {
    intent = typeof intent === "string" ? resolve(intent) : intent;
    if (!intent) return "index.html#converter";
    if (intent.href) return intent.href;
    return "index.html?tool=" + encodeURIComponent(intent.slug) + (resume ? "&resume=1" : "") + "#converter";
  }

  return { resolve: resolve, fromSearch: fromSearch, eligiblePlanIds: eligiblePlanIds, choosePlan: choosePlan, returnHref: returnHref };
});
