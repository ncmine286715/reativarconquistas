/* ReativaConquistas — frontend (conversão 100% local + conta + AbacatePay).
   Limites e recursos vêm do catálogo público do Worker.
   O pagamento entra quando o usuário precisa de mais volume, tamanho ou uma operação avançada.
*/
(function () {
  "use strict";

  var CFG = window.RC_CONFIG || {};

  /* ---------- quota grátis: N conversões por dia (VIP = ilimitado) ---------- */
  function freeDay() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function freeUsed() {
    return 0;
  }
  function freeLeft() {
    return serverFreeQuota.ready ? Math.max(0, serverFreeQuota.remaining) : freeDailyLimit();
  }
  function freeDailyLimit() {
    var caps = serverEntitlement.capabilities || {};
    var daily = caps.convert && +caps.convert.daily_operations;
    return Number.isFinite(daily) && daily > 0 ? daily : 0;
  }
  function consumeFree() {
    // The authoritative counter is maintained by /api/free-quota.
  }

  /* ---------- tema claro/escuro (sem flash: <head> já aplicou) ---------- */
  function applyThemeBtn() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    document.querySelectorAll(".theme-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", dark ? "true" : "false");
      b.title = dark ? "Mudar para modo claro" : "Mudar para modo escuro";
    });
  }
  function cycleTheme() {
    var root = document.documentElement;
    var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("rc_theme", next); } catch (e) {}
    applyThemeBtn();
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".theme-btn") : null;
    if (b) { e.preventDefault(); cycleTheme(); }
  });
  applyThemeBtn();

  /* ---------- barra fixa: aparece depois do conversor, some nos planos ---------- */
  (function sticky() {
    var bar = $("stickyCta"), x = $("stickyX");
    if (!bar) return;
    var dead = false;
    if (x) x.addEventListener("click", function () { dead = true; bar.hidden = true; });
    function tick() {
      if (dead) return;
      if (selected) { bar.hidden = true; return; }
      var conv = $("converter"), plans = $("planos");
      var c = conv ? conv.getBoundingClientRect() : null;
      var p = plans ? plans.getBoundingClientRect() : null;
      var pastConv = !!c && c.bottom < 0;
      var atPlans = !!p && p.top < window.innerHeight * 0.7 && p.bottom > window.innerHeight * 0.3;
      bar.hidden = !(pastConv && !atPlans);
    }
    window.addEventListener("scroll", tick, { passive: true });
    tick();
  })();

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var form = $("form"), input = $("file"), drop = $("drop"),
      fileName = $("fileName"), submit = $("submit"),
      accept = $("accept"), status = $("status"),
      quotaBar = $("quotaBar"), quotaText = $("quotaText"),
      wantIcon = $("wantIcon"), iconFile = $("iconFile"), iconBtn = $("iconBtn"),
      iconPreview = $("iconPreview"), iconName = $("iconName"),
      wantRename = $("wantRename"), renameInput = $("renameInput"),
      keepSel = $("keepinv"), coordSel = $("showcoords"), immediateSel = $("immediaterespawn"), mobGriefSel = $("mobgriefing"), naturalRegenSel = $("naturalregeneration"),
      daySel = $("daycycle"), weatherSel = $("weather"),
      badgeFile = $("badgeFile"), recoverHardcore = $("recoverHardcore");

  var selected = null, selectedIconBytes = null, selectedList = [], iconPreset = null, presetBytes = null;
  var lastWorldPassport = null, lastWorldReport = null;
  var toolIntentApi = window.RC_toolIntents || null;
  var resumeKey = "rc_checkout_resume", intentKey = "rc_tool_intent";
  var resumeRecord = readResumeRecord();
  var resumeMode = false, activeToolIntent = null;
  try { resumeMode = new URLSearchParams(location.search).get("resume") === "1"; } catch (e) {}
  try { activeToolIntent = toolIntentApi && toolIntentApi.fromSearch(location.search); } catch (e2) {}
  if (!activeToolIntent && resumeMode && resumeRecord && toolIntentApi) activeToolIntent = toolIntentApi.resolve(resumeRecord.tool);
  var toolIntentBox = $("toolIntent"), toolIntentRouted = false;
  var fileAccessReady = false, worldDiagnosisReady = false, activeWorldDiagnosis = null;
  var awaitingContextCheckout = false, entitlementRefreshInFlight = false, lastContextRefreshAt = 0, checkoutEntitlementBaseline = null;
  if (activeToolIntent) rememberToolIntent(activeToolIntent);
  if (resumeMode && resumeRecord) restoreResumeSettings(resumeRecord);
  renderToolIntent(resumeMode && !!resumeRecord);
  var compareInput = $("compareFile"), compareRunButton = $("compareRun"), compareDownloadButton = $("compareDownload"), compareStatus = $("compareStatus"), compareResults = $("compareResults");

  function readResumeRecord() {
    try {
      var value = JSON.parse(sessionStorage.getItem("rc_checkout_resume") || "null");
      if (!value || value.version !== 1 || !value.created_at || Date.now() - +value.created_at > 2 * 60 * 60 * 1000) return null;
      return value;
    } catch (e) { return null; }
  }
  function rememberToolIntent(intent) {
    if (!intent || !intent.slug) return;
    activeToolIntent = intent;
    try { sessionStorage.setItem(intentKey, intent.slug); } catch (e) {}
  }
  function renderToolIntent(resumed) {
    if (!toolIntentBox || !activeToolIntent) return;
    toolIntentBox.textContent = "";
    toolIntentBox.hidden = false;
    if (activeToolIntent.href) {
      toolIntentBox.appendChild(document.createTextNode("Você veio pelo " + activeToolIntent.label + ". O Builder tem seleção de mundo própria."));
      var builderLink = document.createElement("a");
      builderLink.href = activeToolIntent.href;
      builderLink.textContent = " Abrir Builder 3D";
      toolIntentBox.appendChild(builderLink);
      return;
    }
    toolIntentBox.textContent = resumed
      ? (selected
        ? "Retomando " + activeToolIntent.label + ". Seu mundo e suas preferências continuam nesta aba."
        : "Retomando " + activeToolIntent.label + ". As preferências foram recuperadas; selecione o mundo novamente. O arquivo não é guardado pelo site.")
      : "Você veio para " + activeToolIntent.label + ". Selecione seu mundo; depois da análise, abriremos essa ferramenta.";
  }
  function restoreResumeSettings(record) {
    var settings = record && record.settings || {};
    Object.keys(settings).forEach(function (id) {
      var control = $(id), saved = settings[id];
      if (!control || !saved) return;
      if (control.type === "checkbox") control.checked = saved.checked === true;
      else if (typeof saved.value === "string") control.value = saved.value;
    });
  }
  function snapshotSettings() {
    var ids = ["gamemode", "difficulty", "showcoords", "keepinv", "immediaterespawn", "mobgriefing", "naturalregeneration", "daycycle", "weather", "renameInput", "wantRename", "recoverHardcore", "stripPacks"];
    var result = {};
    ids.forEach(function (id) {
      var control = $(id);
      if (!control) return;
      result[id] = control.type === "checkbox" ? { checked: !!control.checked } : { value: String(control.value || "").slice(0, 80) };
    });
    return result;
  }
  function clearCheckoutResume() {
    try { sessionStorage.removeItem(resumeKey); sessionStorage.removeItem("rc_pending_checkout_context"); } catch (e) {}
  }
  function currentToolSlug() {
    if (recoverHardcore && recoverHardcore.checked) return "hardcore";
    var modeControl = $("gamemode");
    if (modeControl && modeControl.value === "creative") return "criativo";
    if (keepSel && keepSel.value !== "-1") return "keep-inventory";
    var strip = $("stripPacks");
    if ((strip && strip.checked) || (typeof selectedPacks !== "undefined" && selectedPacks.length)) return "addons";
    try { if (window.RC_reset && window.RC_reset.selCount() > 0) return "chunks"; } catch (e) {}
    try { if (window.RC_player && window.RC_player.hasEdits()) return "jogador"; } catch (e2) {}
    return activeToolIntent ? activeToolIntent.slug : "";
  }
  function sourceForTool(slug) {
    var intent = toolIntentApi && toolIntentApi.resolve(slug);
    return intent ? "tool_" + intent.slug.replace(/-/g, "_") : "";
  }
  function checkoutContext(extra) {
    var context = Object.assign({}, extra || {});
    var slug = context.tool || currentToolSlug() || (context.source === "feature_paywall" ? "conquistas" : "");
    var intent = toolIntentApi && toolIntentApi.resolve(slug);
    if (intent) {
      context.tool = intent.slug;
      context.source = "tool_" + intent.slug.replace(/-/g, "_");
    }
    context.preserve_context = true;
    try {
      sessionStorage.setItem(resumeKey, JSON.stringify({
        version: 1, created_at: Date.now(), tool: intent ? intent.slug : "upload",
        settings: snapshotSettings()
      }));
    } catch (e) {}
    if (intent) rememberToolIntent(intent);
    return context;
  }
  function maybeRouteToToolIntent() {
    if (!activeToolIntent || activeToolIntent.slug === "upload" || activeToolIntent.href || !activeToolIntent.targetId || !fileAccessReady || !worldDiagnosisReady || toolIntentRouted || !selected) return;
    var targetId = activeToolIntent.targetId;
    var blockedByPacks = activeToolIntent.slug === "conquistas" && activeWorldDiagnosis && packCount(activeWorldDiagnosis) > 0;
    if (blockedByPacks) targetId = "accPacks";
    var target = $(targetId);
    if (!target) return;
    var detail = target.closest ? target.closest("details.acc") : null;
    if (detail) detail.open = true;
    toolIntentRouted = true;
    if (blockedByPacks) {
      setStatus("ok", "Encontramos " + packCount(activeWorldDiagnosis) + " addon(s) que podem bloquear conquistas. A seção Addons foi aberta para revisão.");
    } else {
      setStatus("ok", "Análise concluída. Abrimos " + escapeHtml(activeToolIntent.label) + ". Revise as opções e confirme antes de gerar a cópia.");
    }
    window.setTimeout(function () {
      try { target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch (e) { target.scrollIntoView(); }
    }, 80);
  }
  function beginContextCheckout() {
    awaitingContextCheckout = true;
    var current = window.RC_entitlements && window.RC_entitlements.state
      ? window.RC_entitlements.state()
      : (window.RC_entitlementState || {});
    checkoutEntitlementBaseline = {
      plan: String(current.plan || ""), active: current.active === true,
      premium_until_ms: +current.premium_until_ms || 0,
      world_credits: +current.world_credits || 0,
      active_world_projects: +current.active_world_projects || 0
    };
  }
  function contextBenefitsIncreased(entitlement) {
    var baseline = checkoutEntitlementBaseline;
    if (!baseline || !entitlement || entitlement.active !== true) return false;
    return (!baseline.active && entitlement.active === true) ||
      (String(entitlement.plan || "") !== baseline.plan) ||
      (+entitlement.premium_until_ms || 0) > baseline.premium_until_ms + 1000 ||
      (+entitlement.world_credits || 0) > baseline.world_credits ||
      (+entitlement.active_world_projects || 0) > baseline.active_world_projects;
  }

  var toolNavTargets = { accFile: "upload", operationActions: "conquistas", accFree: "mundo", accPrem: "mundo", accPacks: "addons", accPlayer: "jogador" };
  Array.prototype.forEach.call(document.querySelectorAll(".editor-categories a"), function (link) {
    link.addEventListener("click", function () {
      var target = link.hash && document.getElementById(link.hash.slice(1));
      var section = target && target.closest && target.closest("details.acc");
      if (section) section.open = true;
      var slug = link.href.indexOf("builder-lab.html") >= 0 ? "builder" : link.href.indexOf("chunks.html") >= 0 ? "chunks" : toolNavTargets[String(link.hash || "").slice(1)];
      var intent = toolIntentApi && toolIntentApi.resolve(slug);
      if (intent) {
        rememberToolIntent(intent);
        try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("converter_view", { source: "tool_" + intent.slug.replace(/-/g, "_") }); } catch (e) {}
      }
    });
  });
  document.addEventListener("rc-pay-ready", function () {
    if (activeToolIntent && window.RC_pay && window.RC_pay.track) {
      window.RC_pay.track("converter_view", { source: "tool_" + activeToolIntent.slug.replace(/-/g, "_") });
    }
  });
  var comparisonFile = null, lastComparison = null;
  function canonicalCompareValue(value) {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "—";
    if (typeof value === "object") {
      var ordered = {};
      Object.keys(value).sort().forEach(function (key) { ordered[key] = value[key]; });
      return JSON.stringify(ordered);
    }
    return String(value);
  }
  function compareSnapshot(file, rep) {
    return {
      file: { name: file.name, size_bytes: file.size },
      world_name: rep.worldName && rep.worldName[0] || null,
      seed: rep.seed && rep.seed[0] || null,
      game_mode: rep.gameType || [],
      difficulty: rep.difficulty || [],
      spawn: rep.spawn || null,
      gamerules: rep.gamerules || {},
      achievements_flags_clean: !!rep.alreadyClean,
      locked: rep.locked || {},
      active_behavior_packs: rep.behaviorPacks || { active: 0, folders: [] }
    };
  }
  function renderComparison(result) {
    if (!compareResults) return;
    compareResults.textContent = "";
    var table = document.createElement("table"); table.className = "compare-table";
    var thead = document.createElement("thead"), head = document.createElement("tr");
    ["Campo", result.original.file.name, result.other.file.name, "Resultado"].forEach(function (name) { var th = document.createElement("th"); th.textContent = name; head.appendChild(th); });
    thead.appendChild(head); table.appendChild(thead);
    var body = document.createElement("tbody");
    result.fields.forEach(function (field) {
      var row = document.createElement("tr"), values = [field.label, canonicalCompareValue(field.original), canonicalCompareValue(field.other)];
      values.forEach(function (value) { var td = document.createElement("td"); td.textContent = value; row.appendChild(td); });
      var stateCell = document.createElement("td"); stateCell.textContent = field.changed ? "Diferente" : "Igual"; stateCell.className = field.changed ? "diff-changed" : "diff-same"; row.appendChild(stateCell); body.appendChild(row);
    });
    table.appendChild(body); compareResults.appendChild(table);
  }
  function clearComparison() {
    lastComparison = null;
    if (compareDownloadButton) compareDownloadButton.disabled = true;
    if (compareResults) compareResults.textContent = "";
    if (compareStatus) compareStatus.textContent = comparisonFile ? "Pronto para comparar as duas cópias." : "Selecione uma segunda cópia.";
  }
  if (compareInput) compareInput.addEventListener("change", async function () {
    var file = compareInput.files && compareInput.files[0] || null;
    var errorMessage = "";
    try { comparisonFile = file && await window.RC_worldFormat.normalize(file); }
    catch (error) { comparisonFile = null; errorMessage = error.message || String(error); }
    if (compareRunButton) compareRunButton.disabled = !comparisonFile || !selected;
    clearComparison();
    if (errorMessage && compareStatus) compareStatus.textContent = errorMessage;
  });
  if (compareRunButton) compareRunButton.addEventListener("click", function () {
    if (!selected || !comparisonFile || !window.RC_local) return;
    var primaryFile = selected, otherFile = comparisonFile;
    compareRunButton.disabled = true;
    if (compareDownloadButton) compareDownloadButton.disabled = true;
    if (compareStatus) compareStatus.textContent = "Lendo as duas cópias localmente…";
    Promise.all([primaryFile.arrayBuffer(), otherFile.arrayBuffer()]).then(function (buffers) {
      return Promise.all([window.RC_local.diagnoseAny(buffers[0], primaryFile.name), window.RC_local.diagnoseAny(buffers[1], otherFile.name)]);
    }).then(function (reports) {
      if (selected !== primaryFile || comparisonFile !== otherFile) return;
      if (!reports[0].ok || !reports[1].ok) throw new Error("Uma das cópias não pôde ser lida como mundo Bedrock.");
      var original = compareSnapshot(primaryFile, reports[0]), other = compareSnapshot(otherFile, reports[1]);
      var labels = { world_name: "Nome do mundo", seed: "Seed", game_mode: "Modo", difficulty: "Dificuldade", spawn: "Spawn", gamerules: "Regras", achievements_flags_clean: "Flags de conquistas limpas", locked: "Travas de conquistas", active_behavior_packs: "Behavior packs" };
      var fields = Object.keys(labels).map(function (key) { return { key: key, label: labels[key], original: original[key], other: other[key], changed: canonicalCompareValue(original[key]) !== canonicalCompareValue(other[key]) }; });
      lastComparison = { format: "reativaconquistas-world-compare-v1", compared_at: new Date().toISOString(), original: original, other: other, fields: fields, limitations: ["Este comparador cobre metadados de level.dat e referências de Behavior Packs; não compara inventários de jogadores nem dados de chunks."] };
      renderComparison(lastComparison);
      if (compareStatus) compareStatus.textContent = fields.filter(function (f) { return f.changed; }).length + " diferença(s) nos campos comparados. Arquivos analisados no navegador.";
      if (compareDownloadButton) compareDownloadButton.disabled = false;
    }).catch(function (error) {
      if (selected !== primaryFile || comparisonFile !== otherFile) return;
      if (compareStatus) compareStatus.textContent = error.message || "Não foi possível comparar os mundos.";
    }).then(function () { if (selected === primaryFile && comparisonFile === otherFile) compareRunButton.disabled = !selected || !comparisonFile; });
  });
  if (compareDownloadButton) compareDownloadButton.addEventListener("click", function () {
    if (!lastComparison) return;
    var base = (selected && selected.name || "mundo").replace(/\.(mcworld|zip|dat)$/i, "");
    downloadLocalBlob(new Blob([JSON.stringify(lastComparison, null, 2)], { type: "application/json;charset=utf-8" }), base + "-comparacao.json");
  });

  var RULE_PRESETS = {
    calm: { label: "Sobrevivência tranquila", values: { difficulty: "1", keepinv: "1", showcoords: "1", daycycle: "1", weather: "1", immediaterespawn: "1", mobgriefing: "0", naturalregeneration: "1" } },
    hard: { label: "Difícil", values: { difficulty: "3", keepinv: "0", showcoords: "1", daycycle: "1", weather: "1", immediaterespawn: "0", mobgriefing: "1", naturalregeneration: "1" } },
    build: { label: "Construção", values: { difficulty: "0", keepinv: "1", showcoords: "1", daycycle: "1", weather: "1", immediaterespawn: "1", mobgriefing: "0", naturalregeneration: "1" } },
    access: { label: "Acessibilidade tranquila", values: { difficulty: "0", keepinv: "1", showcoords: "1", daycycle: "0", weather: "0", immediaterespawn: "1", mobgriefing: "0", naturalregeneration: "1" } },
    day: { label: "Congelar horário e clima atuais", values: { daycycle: "0", weather: "0" } },
    challenge: { label: "Desafio", values: { difficulty: "3", keepinv: "0", showcoords: "1", daycycle: "1", weather: "1", immediaterespawn: "0", mobgriefing: "1", naturalregeneration: "0" } }
  };
  var rulePresetSelect = $("rulePreset"), rulePresetButton = $("applyRulePreset"), rulePresetHint = $("rulePresetHint");
  if (rulePresetButton) rulePresetButton.addEventListener("click", function () {
    var preset = rulePresetSelect && RULE_PRESETS[rulePresetSelect.value];
    if (!preset) { if (rulePresetHint) rulePresetHint.textContent = "Escolha um preset primeiro."; return; }
    Object.keys(preset.values).forEach(function (id) {
      var control = $(id);
      if (!control) return;
      control.value = preset.values[id];
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (rulePresetHint) rulePresetHint.textContent = "Preset aplicado: " + preset.label + ". Confira cada regra antes de converter.";
  });

  // localStorage is not an authority. It may contain stale UI data, but only
  // a fresh entitlement response from the Worker can enable a paid operation.
  var serverEntitlement = { ready: false, status: "loading", active: false, until: 0, world_credits: 0, plan: "", email: "", max_file_mb: null, max_file_bytes: null, max_batch: 0, capabilities: {} };
  window.RC_entitlementState = serverEntitlement;
  var serverFreeQuota = { ready: false, remaining: 0 };

  /* ---------- addons: pacotes de comportamento bloqueiam conquistas ---------- */
  function packCount(rep) {
    if (!rep || !rep.behaviorPacks) return 0;
    return rep.behaviorPacks.active || (rep.behaviorPacks.folders || []).length;
  }
  function packNames(rep) {
    if (!rep || !rep.behaviorPacks) return "";
    return (rep.behaviorPacks.folders || []).slice(0, 4).join(", ");
  }

  /* ---------- menu hambúrguer / drawer ---------- */
  (function drawer() {
    var hamb = $("hamb"), dr = $("drawer"), bg = $("drawerBg"), x = $("drawerClose");
    if (!hamb || !dr) return;
    function open(o) {
      dr.classList.toggle("open", o);
      dr.setAttribute("aria-hidden", o ? "false" : "true");
      hamb.setAttribute("aria-expanded", o ? "true" : "false");
      if (bg) bg.hidden = !o;
      if (o) { var f = dr.querySelector("a"); if (f) f.focus(); }
      else hamb.focus();
    }
    hamb.addEventListener("click", function () { open(!dr.classList.contains("open")); });
    if (x) x.addEventListener("click", function () { open(false); });
    if (bg) bg.addEventListener("click", function () { open(false); });
    dr.addEventListener("click", function (e) { if (e.target.tagName === "A") open(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && dr.classList.contains("open")) open(false); });
  })();

  function setBadge() {
    if (!badgeFile) return;
    if (selectedList.length > 1) { badgeFile.textContent = selectedList.length + " arquivos"; }
    else if (selected) { badgeFile.textContent = "arquivo ok"; }
    else { badgeFile.textContent = "aguardando arquivo"; }
  }
  function paintPresets() {
    try {
      var row = $("presetRow");
      if (!row || !window.RC_icons) return;
      row.innerHTML = "";
      window.RC_icons.list.forEach(function (it) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn-ghost";
        b.title = it.name;
        b.style.padding = "6px";
        var cv = document.createElement("canvas");
        cv.style.width = "48px"; cv.style.height = "48px";
        cv.style.imageRendering = "pixelated";
        window.RC_icons.preview(cv, it.id);
        b.appendChild(cv);
        var lb = document.createElement("div");
        lb.style.fontSize = "11px";
        lb.textContent = it.name;
        b.appendChild(lb);
        b.addEventListener("click", function () {
          // Presets de ícone também fazem parte da demonstração gratuita.
          iconPreset = it.id;
          presetBytes = null;
          selectedIconBytes = null;
          wantIcon.checked = true;
          iconName.textContent = "Gerando " + it.name + "…";
          window.RC_icons.make(it.id).then(function (bytes) {
            presetBytes = bytes;
            selectedIconBytes = null;
            iconName.textContent = "Ícone pronto: " + it.name + " (JPEG)";
            showIconPreview(new Blob([bytes], { type: "image/jpeg" }));
            setStatus(null);
          }).catch(function (err) {
            iconName.textContent = "";
            setStatus("err", "Não deu para gerar o ícone: " + escapeHtml((err && err.message) || err));
          });
        });
        row.appendChild(b);
      });
    } catch (e) {}
  }
  var diagBtn = $("diagnose");

  /* ---------- contato / operador (rodapé) ---------- */
  function paintContact() {
    if (CFG.SUPPORT_EMAIL) {
      document.querySelectorAll('a[href^="mailto:"]').forEach(function (a) {
        if (a.id !== "supEmail") a.href = "mailto:" + CFG.SUPPORT_EMAIL;
      });
      var se = $("supEmail");
      if (se) se.textContent = CFG.SUPPORT_EMAIL;
    }
    if (CFG.OPERATOR_CITY_UF) { var oc = $("opCity"); if (oc) oc.textContent = CFG.OPERATOR_CITY_UF; }
  }

  /* ---------- Benefícios da conta consultados no Worker ---------- */
  function googleEmail() {
    try {
      var u = (window.RC_auth && window.RC_auth.user()) || null;
      return ((u && u.email) || "").trim().toLowerCase();
    } catch (e) { return ""; }
  }
  function remotePremUntil() {
    return serverEntitlement.ready ? (+serverEntitlement.until || 0) : 0;
  }
  function remotePremEmail() {
    return serverEntitlement.ready ? String(serverEntitlement.email || "") : "";
  }
  function remotePlan() {
    return serverEntitlement.ready ? (serverEntitlement.plan || "free") : "";
  }
  function remoteWorldCredits() {
    return serverEntitlement.ready ? Math.max(0, +serverEntitlement.world_credits || 0) : 0;
  }
  function paidSizeLimitMB() {
    if (!remotePremOk()) return freeLimitMB();
    return serverEntitlement.max_file_mb === null ? Infinity : (+serverEntitlement.max_file_mb || freeLimitMB());
  }
  function remotePremOk() {
    return !!serverEntitlement.ready && !!serverEntitlement.active;
  }
  function isPremiumAny() { return remotePremOk(); }
  // Consulta os benefícios vinculados ao UID da sessão Firebase atual.
  function refreshRemotePrem(force) {
    if (!window.RC_entitlements) return Promise.reject(new Error("Entitlement service unavailable."));
    serverEntitlement = Object.assign({}, serverEntitlement, { ready: false, status: "loading" });
    window.RC_entitlementState = serverEntitlement;
    paintQuota();
    return (force ? window.RC_entitlements.refresh() : window.RC_entitlements.load()).then(function (e) {
      serverEntitlement = Object.assign({}, e, { ready: e.status === "ready", until: +e.premium_until_ms || 0, email: e.account_email || googleEmail() });
      window.RC_entitlementState = serverEntitlement;
      paintQuota();
      return serverEntitlement;
    }).catch(function (err) {
      serverEntitlement = Object.assign({}, serverEntitlement, window.RC_entitlements.state(), { ready: false });
      window.RC_entitlementState = serverEntitlement;
      paintQuota();
      throw err;
    });
  }
  function refreshFreeQuota() {
    if (!window.RC_pay || !window.RC_pay.freeQuota) return;
    window.RC_pay.freeQuota(false).then(function (q) {
      serverFreeQuota = { ready: true, remaining: Math.max(0, +q.remaining || 0) };
      paintQuota();
    }).catch(function () {
      // Keep the local display only as a fallback for a temporary outage;
      // submit() still attempts the server gate before processing.
      serverFreeQuota = { ready: false, remaining: freeDailyLimit() };
      paintQuota();
    });
  }
  function paintQuota() {
    if (serverEntitlement.status === "loading") {
      quotaBar.classList.remove("premium");
      quotaText.textContent = "Verificando seu plano...";
      updateSubmit();
      return;
    }
    if (serverEntitlement.status === "error" || serverEntitlement.status === "session_expired") {
      quotaBar.classList.remove("premium");
      quotaText.textContent = serverEntitlement.status === "session_expired" ? "Sua sessão Google expirou. Entre novamente para verificar seus benefícios." : "Não foi possível verificar seu plano agora. Tente novamente.";
      updateSubmit();
      return;
    }
    var vip = remotePremOk();
    if (vip) {
      quotaBar.classList.add("premium");
      var activePlan = serverEntitlement.plan_label || serverEntitlement.plan || "Plano pago";
      var planState = serverEntitlement.plan === "world1"
        ? " · <strong>" + (+serverEntitlement.world_credits || 0) + " crédito(s) de mundo</strong> · " + (+serverEntitlement.active_world_projects || 0) + " projeto(s) ativo(s)"
        : " até <strong>" + new Date(serverEntitlement.expires_at || remotePremUntil()).toLocaleDateString("pt-BR") + "</strong>";
      quotaText.innerHTML = "<strong>" + escapeHtml(activePlan) + " ativo</strong>" +
        (remotePremEmail() ? " em <strong>" + escapeHtml(remotePremEmail()) + "</strong>" : "") + planState +
        " — benefícios desbloqueados. " +
        "<a href='minha-conta.html'>Minha conta</a> · " +
        "<a href='#' id='vipRefresh'>Verificar de novo</a>";
    } else {
      quotaBar.classList.remove("premium");
      if (serverEntitlement.pending_payment) {
        var pendingMessage = window.RC_entitlements && window.RC_entitlements.messageForPending
          ? window.RC_entitlements.messageForPending(serverEntitlement.pending_payment)
          : "Seu pagamento ainda está em confirmação. Não faça outra compra.";
        quotaText.innerHTML = escapeHtml(pendingMessage) + " <a href='minha-conta.html'><b>Minha conta</b></a> · " +
          "<a href='#' id='vipRefresh'><b>Atualizar benefícios</b></a>";
      } else {
        var fl = freeLeft();
        var lim = freeLimitMB();
        quotaText.innerHTML = "Mundos de até <strong>" + lim + " MB: grátis</strong> (<b>" + fl + " de " + freeDailyLimit() + " hoje</b>)" +
          (fl <= 0 ? " — <b>limite de hoje usado</b>, <a href='#planos'><b>libere o uso extra com um plano</b></a>"
            : ". Mundos maiores que " + lim + " MB — <a href='#planos'><b>ver planos</b></a>") + "<br>" +
          "<span style='font-size:12.5px'>Pagou e continua bloqueado? <a href='#' id='vipRefresh'><b>Verificar de novo</b></a>. Use a mesma conta Google da compra.</span>";
      }
    }
    // Desbloqueio visual: sem VIP os blocos seguem tracejados; com VIP ficam normais
    var r1 = $("vipRefresh");
    if (r1) r1.addEventListener("click", function (e) { e.preventDefault(); refreshRemotePrem(true); });
    updateSubmit();
  }

  /* ---------- status ---------- */
  function setStatus(kind, html) {
    if (!kind) { status.hidden = true; status.className = "status"; status.textContent = ""; return; }
    status.hidden = false;
    status.className = "status " + kind;
    status.innerHTML = html;
  }
  function refreshAfterContextCheckout() {
    if (!awaitingContextCheckout || document.visibilityState === "hidden" || entitlementRefreshInFlight || Date.now() - lastContextRefreshAt < 2500) return;
    if (!window.RC_entitlements || typeof window.RC_entitlements.refresh !== "function") return;
    lastContextRefreshAt = Date.now();
    entitlementRefreshInFlight = true;
    window.RC_entitlements.refresh().then(function (ent) {
      entitlementRefreshInFlight = false;
      if (!ent || ent.status !== "ready") {
        setStatus("err", "Não consegui atualizar os benefícios. Mantenha esta aba aberta e verifique novamente em Minha conta.");
        return;
      }
      serverEntitlement = Object.assign({}, ent, { ready: true, until: +ent.premium_until_ms || 0, email: ent.account_email || googleEmail() });
      window.RC_entitlementState = serverEntitlement;
      paintQuota();
      refreshFreeQuota();
      if (ent.pending_payment) {
        var pendingText = window.RC_entitlements.messageForPending ? window.RC_entitlements.messageForPending(ent.pending_payment) : "O pagamento ainda está em confirmação. Não inicie outra compra.";
        setStatus("ok", escapeHtml(pendingText) + " <a href='minha-conta.html'>Minha conta</a>");
        return;
      }
      if (ent.active) {
        resumeRecord = readResumeRecord();
        if (resumeRecord) {
          var resumedIntent = toolIntentApi && toolIntentApi.resolve(resumeRecord.tool);
          if (resumedIntent) { rememberToolIntent(resumedIntent); renderToolIntent(true); }
          restoreResumeSettings(resumeRecord);
        }
        if (selected && selectedList.length && window.RC_entitlements.canUseFile) {
          var fileDecision = window.RC_entitlements.canUseFile(selectedList);
          fileAccessReady = fileDecision.allowed === true;
        }
        if (!contextBenefitsIncreased(ent)) {
          setStatus("ok", "Aguardamos a confirmacao dos novos beneficios pelo servidor. Seu mundo e suas escolhas continuam nesta aba; se ja pagou, aguarde e verifique novamente. Nao inicie outra compra.");
          return;
        }
        if (selected && selectedList.length && !fileAccessReady) {
          awaitingContextCheckout = false;
          checkoutEntitlementBaseline = null;
          setStatus("err", "A compra foi confirmada pelo servidor, mas o limite atualizado ainda nao cobre o arquivo selecionado. Confira os limites em Minha conta antes de tentar novamente.");
          return;
        }
        maybeRouteToToolIntent();
        awaitingContextCheckout = false;
        checkoutEntitlementBaseline = null;
        setStatus("ok", "Benefícios confirmados pelo servidor. Seu mundo e suas configurações continuam nesta aba; revise e toque em Gerar para executar.");
        return;
      }
      setStatus("ok", "Ainda não há confirmação dos benefícios. Seu mundo e suas escolhas continuam nesta aba; aguarde a confirmação e verifique novamente. Não inicie outra compra.");
    }).catch(function () {
      entitlementRefreshInFlight = false;
      setStatus("err", "Não foi possível atualizar os benefícios agora. O mundo continua nesta aba; tente verificar novamente em instantes.");
    });
  }
  window.addEventListener("rc-context-checkout-started", function () {
    beginContextCheckout();
    setStatus("ok", "Checkout aberto em outra aba. Depois da confirmação, volte para esta aba; o mundo e as configurações ficam abertos aqui.");
  });
  window.addEventListener("focus", refreshAfterContextCheckout);
  document.addEventListener("visibilitychange", refreshAfterContextCheckout);
  function loggedIn() {
    try { return !!((window.RC_auth && window.RC_auth.user()) || null); } catch (e) { return false; }
  }
  // Recursos pagos só são oferecidos depois de carregar o estado do Worker.
  function lockedHint(msg, plan, context) {
    context = context || {};
    var entitlement = window.RC_entitlements && window.RC_entitlements.state ? window.RC_entitlements.state() : (window.RC_entitlementState || {});
    if (entitlement.status === "loading") {
      setStatus("ok", "Verificando seu plano...");
      return;
    }
    if (entitlement.status === "error" || entitlement.status === "session_expired") {
      setStatus("err", entitlement.status === "session_expired"
        ? "Sua sessão Google expirou. Entre novamente para verificar seus benefícios."
        : "Não foi possível verificar seu plano agora. Tente novamente. Nenhuma nova compra é necessária para verificar um plano existente.");
      return;
    }
    if (entitlement.pending_payment) {
      var pendingMessage = window.RC_entitlements && window.RC_entitlements.messageForPending
        ? window.RC_entitlements.messageForPending(entitlement.pending_payment)
        : "Seu pagamento ainda está em confirmação. Confira os benefícios em Minha conta; não faça outra compra.";
      setStatus("err", escapeHtml(pendingMessage) + " <a href='minha-conta.html'>Minha conta</a>");
      return;
    }
    if (entitlement.status === "ready" && entitlement.active && context.allow_active_purchase !== true) {
      serverEntitlement = Object.assign({}, entitlement, { ready: true, until: +entitlement.premium_until_ms || 0, email: entitlement.account_email || googleEmail() });
      window.RC_entitlementState = serverEntitlement;
      paintQuota();
      setStatus("ok", "Seu plano foi atualizado. Tente a operação novamente.");
      return;
    }
    context = Object.assign({ source: "feature_paywall" }, context || {});
    context = checkoutContext(context);
    try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("paywall_shown", Object.assign({ plan: plan || "", source: context.source || "feature_paywall" }, context)); } catch (e0) {}
    // Com Kiwify ligada: aviso + link direto de liberação (sem sair sozinho).
    // Sem Kiwify: abre o modal AbacatePay como antes.
    var kw = "";
    try { if (window.RC_pay && window.RC_pay.kiwifyUrl) kw = window.RC_pay.kiwifyUrl(plan) || ""; } catch (e) {}
    if (kw) {
      setStatus("", escapeHtml(msg) + ' <a id="contextKiwifyCheckout" href="' + escapeHtml(kw) + '" target="_blank" rel="noopener"><b>Abrir checkout em nova aba</b></a>. Use o mesmo e-mail Google e volte a esta aba para continuar. · <a href="#planos">Ver planos</a>');
      var contextKiwifyLink = $("contextKiwifyCheckout");
      if (contextKiwifyLink) contextKiwifyLink.addEventListener("click", function () {
        try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("kiwify_checkout_redirect", { plan: plan || "", tool: context.tool || "", source: context.source || "feature_paywall" }); } catch (e) {}
        beginContextCheckout();
        window.setTimeout(function () { setStatus("ok", "Checkout aberto em outra aba. Depois da confirmação, volte para esta aba; o mundo e as configurações ficam abertos aqui."); }, 0);
      });
      return;
    }
    setStatus("", escapeHtml(msg) + ' <a href="#planos"><b>Ver planos</b></a> · <a href="minha-conta.html"><b>Minha conta</b></a>');
    try { if (window.RC_pay && !window.RC_pay.kiwifyUrl(plan) && window.RC_pay.enabled()) window.RC_pay.openPayModal(msg, plan, context); } catch (e) {}
  }

  /* ---------- arquivo ---------- */
  function showFilePaywall(worlds, sizeBytes, message) {
    if (!window.RC_pay || !window.RC_pay.planCatalog) {
      setStatus("err", escapeHtml(message) + " <a href='#planos'>Ver planos</a>");
      return;
    }
    window.RC_pay.planCatalog().then(function (catalog) {
      var oneWorld = catalog && catalog.world1;
      if (!oneWorld) throw new Error("Plan catalog unavailable.");
      var exceedsWorldCredit = oneWorld.max_file_bytes !== null && sizeBytes > +oneWorld.max_file_bytes;
      var exceedsWorldBatch = +worlds > +oneWorld.max_batch;
      var requirement = { worlds: worlds, world_size_mb: +(sizeBytes / 1048576).toFixed(1), world_size_bytes: sizeBytes };
      var eligible = toolIntentApi ? toolIntentApi.eligiblePlanIds(["world1", "vip7", "vip30", "creator"], catalog, requirement) : ["world1", "vip7", "vip30", "creator"];
      if (!eligible.length) {
        setStatus("err", escapeHtml(message) + " Nenhum produto atual cobre este tamanho e quantidade de mundos. Divida o lote ou exporte um arquivo menor.");
        return;
      }
      var preferred = exceedsWorldCredit || exceedsWorldBatch ? "vip7" : "world1";
      var suggested = toolIntentApi ? toolIntentApi.choosePlan(eligible, preferred, catalog) : preferred;
      lockedHint(message, suggested, Object.assign({ source: "world_size_paywall", allow_active_purchase: true }, requirement));
    }).catch(function () {
      setStatus("err", escapeHtml(message) + " Não foi possível consultar os planos agora. Tente novamente; não é necessário pagar outra vez por um plano já ativo. <a href='minha-conta.html'>Minha conta</a>");
    });
  }

  function friendlyFileErr(err) {
    var m = String((err && err.message) || err || "");
    var code = String(err && err.payload && err.payload.code || err && err.code || "");
    if (err && (err.status === 401 || code === "AUTH_EXPIRED")) return "Sua sessão Google expirou. Entre novamente para verificar seus benefícios.";
    if (err && (err.status === 503 || err.status >= 500 || /failed to fetch|networkerror|load failed/i.test(m))) return "Não foi possível verificar seu plano ou iniciar a operação agora. Tente novamente. Nenhuma nova compra é necessária.";
    if (code === "SIZE_LIMIT") {
      var maxFileMb = err.payload && Object.prototype.hasOwnProperty.call(err.payload, "max_file_mb") ? err.payload.max_file_mb : serverEntitlement.max_file_mb;
      return maxFileMb === null ? "Seu mundo excede a capacidade comercial deste plano." : "Seu mundo excede o limite do plano " + escapeHtml(serverEntitlement.plan_label || serverEntitlement.plan) + ". Limite: " + escapeHtml(maxFileMb) + " MB.";
    }
    if (code === "BATCH_LIMIT") return "Seu plano permite até " + escapeHtml((err.payload && err.payload.max_batch) || serverEntitlement.max_batch || 1) + " mundo(s) por lote.";
    if (code === "WORLD_CREDIT_EXHAUSTED") return "Seu crédito de 1 mundo já foi utilizado. Reenvie o mundo marcado para continuar editando o mesmo projeto ou adquira outro crédito.";
    if (code === "TOOL_QUOTA_EXCEEDED") return "O limite gratuito diário desta ferramenta foi atingido. Seu arquivo original permanece intacto.";
    if (code === "NO_ENTITLEMENT") return "Este recurso exige um plano pago. Seus benefícios foram verificados agora.";
    if (/FREE_QUOTA_EXCEEDED|QUOTA_EXCEEDED/i.test(m)) return "Você usou as conversões grátis disponíveis hoje. O plano pago libera operações premium.";
    if (/level\.dat n(o|ã)o encontrado/i.test(m)) return "Esse arquivo <b>não parece um mundo válido</b> (falta o level.dat dentro). Exporte de novo pelo jogo — veja <a href='#faq'><b>onde achar o .mcworld</b></a>.";
    if (/NBT|truncado|inválido|root não é|bytes sobrando|não é Compound/i.test(m)) return "Não consegui ler esse mundo (arquivo <b>corrompido ou incompleto</b>). Exporte/baixe de novo e tente.";
    if (/JSZip|central directory|corrupt|encrypted|senha/i.test(m)) return "Esse <b>.zip não abre</b> (corrompido ou com senha). Compacte de novo, sem senha.";
    return "Não deu certo: " + escapeHtml(m);
  }

  function presentOperationFailure(err) {
    var code = String(err && err.payload && err.payload.code || "");
    if (code !== "PAYMENT_PENDING" && code !== "NO_ENTITLEMENT") {
      try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("operation_failed", { source: sourceForTool(currentToolSlug() || "conquistas") }); } catch (e0) {}
    }
    if (code === "PAYMENT_PENDING") {
      setStatus("err", friendlyFileErr(err) + " <a href='minha-conta.html'>Minha conta</a>");
      return;
    }
    if (code === "NO_ENTITLEMENT") {
      showFilePaywall(selectedList.length || 1, selected && selected.size || 0, "Este recurso exige um plano pago. Seus benefícios foram consultados agora.");
      return;
    }
    setStatus("err", friendlyFileErr(err));
  }
  function freeLimitMB() {
    if ((serverEntitlement.status === "ready" || serverEntitlement.status === "unauthenticated") && serverEntitlement.plan === "free") return +serverEntitlement.max_file_mb || 0;
    return 0;
  }
  function freeAddPacksLimit() {
    var caps = serverEntitlement.capabilities || {};
    return Number.isFinite(+caps.add_behavior_packs) ? +caps.add_behavior_packs : 0;
  }
  function freeChunksLimit() {
    var caps = serverEntitlement.capabilities || {};
    var chunks = caps.chunks_restore || {};
    return Number.isFinite(+chunks.max_chunks) ? +chunks.max_chunks : 0;
  }
  function sizeLimitMB() { return remotePremOk() ? paidSizeLimitMB() : freeLimitMB(); }
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function worldProjectInfo(file) {
    return window.RC_entitlements ? window.RC_entitlements.worldProjectInfo(file) : Promise.resolve({ project_id: "", fingerprint: "" });
  }
  function attachWorldProject(blob, projectId) {
    return window.RC_entitlements ? window.RC_entitlements.markWorld(blob, projectId) : Promise.resolve(blob);
  }
  function baseName(name) { return name.replace(/\.(mcworld|zip)$/i, "") + "-conquistas.mcworld"; }
  function downloadLocalBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  var ACCEPT = /\.(mcworld|mctemplate|zip|dat)$/i;

  var GM_NAMES = ["Sobrevivência", "Criativo", "Aventura"];
  function gmName(v) { return GM_NAMES[v] || ("modo " + v); }
  function paintWorldInfo(rep, multi) {
    var box = $("worldInfo");
    if (!box) return;
    if (!rep || !rep.ok) {
      box.hidden = true; lastWorldPassport = null; lastWorldReport = null;
      var reportButton = $("reportDownload"), integrityBox = $("wiIntegrity");
      if (reportButton) reportButton.disabled = true;
      if (integrityBox) integrityBox.textContent = "Verificação estrutural ainda não iniciada.";
      return;
    }
    box.hidden = false;
    var sourceFile = selectedList.length ? selectedList[0] : selected;
    var packTotal = packCount(rep);
    activeWorldDiagnosis = rep;
    var diagnostic = $("wiDiagnostic"), diagnosticText = $("wiDiagnosticText");
    if (diagnostic && diagnosticText) {
      diagnostic.hidden = packTotal <= 0;
      diagnosticText.textContent = packTotal > 0
        ? packTotal + " addon(s) de comportamento detectados; eles podem bloquear conquistas."
        : "";
    }
    var sizeLabel = $("wiSize");
    if (sizeLabel) sizeLabel.textContent = sourceFile ? fmtSize(sourceFile.size) : "—";
    lastWorldPassport = {
      format: "reativaconquistas-world-passport-v1",
      generated_at: new Date().toISOString(),
      file: { name: sourceFile && sourceFile.name || "", size_bytes: sourceFile && sourceFile.size || null },
      world: {
        name: rep.worldName && rep.worldName[0] || "",
        seed: rep.seed && rep.seed[0] || null,
        game_modes: (rep.gameType || []).map(gmName),
        difficulties: (rep.difficulty || []).map(diffName),
        spawn: rep.spawn && rep.spawn[0] !== null && rep.spawn[0] !== undefined ? rep.spawn : null,
        gamerules: rep.gamerules || {}
      },
      diagnosis: {
        flag_status: rep.alreadyClean ? "nenhuma alteração de flags detectada" : "ajustes pendentes",
        pending_adjustments: rep.wouldChange || [],
        active_behavior_pack_count: packTotal,
        behavior_pack_folders: rep.behaviorPacks && rep.behaviorPacks.folders || [],
        locked: rep.locked || {}
      },
      notes: packTotal ? ["Há Behavior Packs detectados. Confira a compatibilidade e o estado de conquistas dentro do Minecraft."] : []
    };
    lastWorldReport = {
      format: "reativaconquistas-world-report-v1",
      generated_at: new Date().toISOString(),
      file: lastWorldPassport.file,
      diagnosis: lastWorldPassport.diagnosis,
      world: lastWorldPassport.world,
      integrity: null,
      operation: null,
      preserved: ["O arquivo original selecionado não foi sobrescrito."],
      limitations: ["A leitura de level.dat não confirma todos os registros internos do LevelDB."]
    };
    $("wiName").textContent = (rep.worldName && rep.worldName[0]) || "(sem nome no level.dat)";
    var seed = (rep.seed && rep.seed[0]) || null;
    $("wiSeed").textContent = seed || "—";
    var cp = $("seedCopy");
    if (cp) {
      cp.hidden = !seed;
      cp.onclick = function () {
        var done = function () { cp.textContent = "Copiado!"; setTimeout(function () { cp.textContent = "Copiar"; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(seed).then(done, done);
        else {
          var ta = document.createElement("textarea");
          ta.value = seed; document.body.appendChild(ta); ta.select();
          try { document.execCommand("copy"); } catch (e) {}
          ta.remove(); done();
        }
      };
    }
    $("wiMode").textContent = rep.gameType.length ? rep.gameType.map(gmName).join(", ") : "—";
    $("wiDiff").textContent = (rep.difficulty && rep.difficulty.length === 1) ? diffName(rep.difficulty[0]) : "—";
    $("wiSpawn").textContent = (rep.spawn && rep.spawn[0] !== null && rep.spawn[0] !== undefined) ? rep.spawn.join(", ") : "—";
    var st = rep.alreadyClean ? "pronto p/ conquistas" : (rep.wouldChange.length + " ajuste(s) pendente(s)");
    if (rep.locked && (rep.locked.hasLockedBehaviorPack || []).indexOf(1) >= 0) st += " · pack travado!";
    var pc = packCount(rep);
    if (pc > 0) st += " · " + pc + " addon(s) — bloqueiam conquistas!";
    if (multi) st += " (1º de " + multi + ")";
    $("wiStatus").textContent = st;
  }
  var passportButton = $("passportDownload"), originalButton = $("originalDownload"), reportDownloadButton = $("reportDownload");
  if (passportButton) passportButton.addEventListener("click", function () {
    if (!lastWorldPassport) return;
    var base = (lastWorldPassport.file.name || "mundo").replace(/\.(mcworld|zip|dat)$/i, "").replace(/[\\/:*?\"<>|]+/g, "-");
    downloadLocalBlob(new Blob([JSON.stringify(lastWorldPassport, null, 2)], { type: "application/json;charset=utf-8" }), base + "-passaporte.json");
  });
  if (originalButton) originalButton.addEventListener("click", function () {
    var sourceFile = selectedList.length ? selectedList[0] : selected;
    if (sourceFile) downloadLocalBlob(sourceFile, (sourceFile.name || "mundo-original.mcworld").replace(/\.zip$/i, ".mcworld"));
  });
  if (reportDownloadButton) reportDownloadButton.addEventListener("click", function () {
    if (!lastWorldReport) return;
    var base = (lastWorldReport.file.name || "mundo").replace(/\.(mcworld|zip|dat)$/i, "").replace(/[\\/:*?"<>|]+/g, "-");
    downloadLocalBlob(new Blob([JSON.stringify(lastWorldReport, null, 2)], { type: "application/json;charset=utf-8" }), base + "-relatorio.json");
  });
  var raioXSeq = 0;
  function raioX() {
    var box = $("filex");
    setBadge();
    if (!box) return;
    if (!selected || typeof window.RC_local === "undefined") { box.hidden = true; paintWorldInfo(null); return; }
    var my = ++raioXSeq;
    worldDiagnosisReady = false;
    activeWorldDiagnosis = null;
    var f = selectedList.length > 1 ? selectedList[0] : selected;
    box.hidden = false;
    box.textContent = "Lendo mundo…";
    paintWorldInfo(null);
    var integrityBox = $("wiIntegrity"), reportButton = $("reportDownload");
    var analysisBuffer = null;
    if (integrityBox) integrityBox.textContent = "Analisando arquivos e manifests localmente…";
    if (reportButton) reportButton.disabled = true;
    clearComparison();
    try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("world_analysis_started", { worlds: selectedList.length || 1, source: sourceForTool(currentToolSlug()) || "tool_upload" }); } catch (e0) {}
    f.arrayBuffer().then(function (ab) { analysisBuffer = ab; return window.RC_local.diagnoseAny(ab, f.name); }).then(function (rep) {
      if (my !== raioXSeq) return;
      if (!rep.ok) { box.hidden = true; paintWorldInfo(null); return; }
      try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("world_analyzed", { worlds: selectedList.length || 1, world_size_mb: +(f.size / 1048576).toFixed(1), addons: packCount(rep), source: sourceForTool(currentToolSlug()) || "tool_upload" }); } catch (e0) {}
      paintWorldInfo(rep, selectedList.length > 1 ? selectedList.length : 0);
      activeWorldDiagnosis = rep;
      worldDiagnosisReady = true;
      maybeRouteToToolIntent();
      if (window.RC_local.inspectWorld) {
        window.RC_local.inspectWorld(analysisBuffer, f.name, rep).then(function (integrity) {
          if (my !== raioXSeq || !lastWorldReport) return;
          lastWorldReport.integrity = integrity;
          if (reportButton) reportButton.disabled = false;
          if (integrityBox) {
            var errors = integrity.checks.filter(function (c) { return c.status === "error"; }).length;
            var warnings = integrity.checks.filter(function (c) { return c.status === "warning"; }).length;
            var unknown = integrity.checks.filter(function (c) { return c.status === "unknown"; }).length;
            integrityBox.textContent = "Estrutura: " + errors + " erro(s), " + warnings + " aviso(s)" + (unknown ? ", " + unknown + " item(ns) não verificáveis" : "") + ". " + integrity.checks.map(function (c) { return c.message; }).join(" ");
          }
          lastWorldPassport.integrity_summary = integrity.checks.map(function (c) { return { id: c.id, status: c.status, message: c.message }; });
        }).catch(function (integrityError) {
          if (my !== raioXSeq) return;
          if (reportButton) reportButton.disabled = false;
          if (lastWorldReport) lastWorldReport.integrity_error = String(integrityError && integrityError.message || integrityError);
          if (integrityBox) integrityBox.textContent = "Verificação incompleta: " + String(integrityError && integrityError.message || integrityError) + ". O restante do diagnóstico continua disponível.";
        });
      }
      var df = (rep.difficulty && rep.difficulty.length === 1) ? diffName(rep.difficulty[0]) : null;
      var t = "Raio-X: " + (rep.alreadyClean ? "já limpo" : (rep.wouldChange.length + " ajustes pendentes"));
      if (df) t += " · dificuldade " + df;
      if (rep.seed && rep.seed.length) t += " · seed " + rep.seed[0];
      if (rep.spawn && rep.spawn[0] !== null && rep.spawn[0] !== undefined) t += " · spawn (" + rep.spawn.join(", ") + ")";
      var pc0 = packCount(rep);
      if (pc0 > 0) t += " · " + pc0 + " addon(s) ativo(s) — BLOQUEIAM conquistas!";
      if (selectedList.length > 1) t += " (1º de " + selectedList.length + ")";
      box.textContent = t;
    }).catch(function () { if (my === raioXSeq) { box.hidden = true; paintWorldInfo(null); } });
  }
  var pickRequest = 0;
  async function pick(list) {
    var request = ++pickRequest;
    if (!list || !list.length) return;
    var bx0 = $("filex"); if (bx0) bx0.hidden = true; // usuário cancelou a janela: mantém seleção
    var files = Array.prototype.slice.call(list || []);
    files = files.filter(function (f) { return ACCEPT.test(f.name || ""); });
    if (!files.length) {
      var got = Array.prototype.slice.call(list || []).map(function (f) { return f.name || "?"; }).slice(0, 3).join(", ");
      selected = null; selectedList = [];
      if (compareRunButton) compareRunButton.disabled = true;
      clearComparison();
      fileName.hidden = true; paintWorldInfo(null); setBadge(); updateSubmit();
      setStatus("err", "Formato não suportado" + (got ? " (<b>" + escapeHtml(got) + "</b>)" : "") + ". Envie <b>.mcworld</b>, <b>.mctemplate</b>, <b>.zip</b> do mundo ou <b>level.dat</b> — foto, .mcpack e .mcaddon <b>não são mundo</b>. Veja <a href='#faq'><b>onde achar o .mcworld</b></a>.");
      return;
    }
    var empty = files.filter(function (f) { return !f.size; });
    if (empty.length) {
      selected = null; selectedList = [];
      if (compareRunButton) compareRunButton.disabled = true;
      clearComparison();
      fileName.hidden = true; paintWorldInfo(null); setBadge(); updateSubmit();
      setStatus("err", "O arquivo <b>" + escapeHtml(empty[0].name) + "</b> está <b>vazio</b> (0 bytes). Exporte o mundo de novo.");
      return;
    }
    try {
      files = await Promise.all(files.map(function (f) { return window.RC_worldFormat.normalize(f); }));
    } catch (error) {
      if (request !== pickRequest) return;
      selected = null; selectedList = []; updateSubmit();
      setStatus("err", "Não consegui abrir o modelo: " + escapeHtml(error.message || String(error)));
      return;
    }
    if (request !== pickRequest) return;
    selectedList = files;
    selected = files[0];
    fileAccessReady = false;
    worldDiagnosisReady = false;
    activeWorldDiagnosis = null;
    toolIntentRouted = false;
    if (compareRunButton) compareRunButton.disabled = !comparisonFile;
    var big = [];
    try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("file_selected", { worlds: files.length, world_size_mb: +(selected.size / 1048576).toFixed(1), source: sourceForTool(currentToolSlug()) || "tool_upload" }); } catch (e0) {}
    if (files.length > 1) {
      fileName.textContent = files.length + " arquivos selecionados (lote)";
      fileName.hidden = false;
      setStatus(null);
    } else if (selected) {
      fileName.textContent = selected.name + "  (" + fmtSize(selected.size) + ")";
      fileName.hidden = false;
      setStatus(null);
    }
    raioX();
    // O Worker decide o limite antes de qualquer mensagem de compra.
    setStatus("ok", "Verificando seu plano e o limite deste arquivo...");
    var selection = selected;
    Promise.resolve(window.RC_entitlements ? window.RC_entitlements.load() : null).then(function (ent) {
      if (selected !== selection) return;
      if (!ent || (ent.status !== "ready" && ent.status !== "unauthenticated")) throw new Error("Entitlement unavailable");
      serverEntitlement = Object.assign({}, ent, { ready: true, until: +ent.premium_until_ms || 0, email: ent.account_email || googleEmail() });
      window.RC_entitlementState = serverEntitlement;
      paintQuota();
      var fileDecision = window.RC_entitlements.canUseFile(files);
      if (fileDecision.status !== "ready" && fileDecision.status !== "unauthenticated") throw new Error("Entitlement unavailable");
      var maxBytes = fileDecision.max_file_bytes;
      var maxBatch = fileDecision.max_batch;
      big = fileDecision.too_large || [];
      try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track(big.length ? "file_too_large" : "file_valid", { worlds: files.length, world_size_mb: +(selected.size / 1048576).toFixed(1), plan: ent.plan, source: sourceForTool(currentToolSlug()) || "tool_upload" }); } catch (e0) {}
      if (files.length > maxBatch) {
        var batchPlan = ent.status === "ready" ? (ent.plan_label || ent.plan) : "Plano gratuito";
        setStatus("err", "Este plano permite até " + maxBatch + " mundo(s) por lote; você selecionou " + files.length + ". Plano detectado: <b>" + escapeHtml(batchPlan) + "</b>.");
        if (ent.pending_payment) setStatus("err", "Seu pagamento do plano <b>" + escapeHtml(ent.pending_payment.plan_label || ent.pending_payment.plan) + "</b> ainda está em confirmação. Atualize os benefícios em <a href='minha-conta.html'>Minha conta</a>; não faça outra compra.");
        else showFilePaywall(files.length, selected.size, "Seu plano " + batchPlan + " permite até " + maxBatch + " mundo(s) por lote; você selecionou " + files.length + ".");
        return;
      }
      if (big.length) {
        var mb = (big[0].size / 1048576).toFixed(1);
        var limit = maxBytes === null ? "sem limite comercial" : (+(maxBytes / 1048576).toFixed(1) + " MB");
        if (ent.status === "ready" && ent.active) showFilePaywall(files.length, big[0].size, "Seu mundo excede o limite atual de " + limit + ".");
        if (ent.status === "ready" && ent.active) setStatus("err", "Seu mundo tem <b>" + mb + " MB</b>. Seu plano <b>" + escapeHtml(ent.plan_label || ent.plan) + "</b> permite até <b>" + limit + "</b>.");
        else {
          setStatus("err", "Seu mundo tem <b>" + mb + " MB</b>. O plano gratuito permite até <b>" + limit + "</b>.");
          if (ent.pending_payment) setStatus("err", "Seu mundo tem <b>" + mb + " MB</b>. O pagamento do plano <b>" + escapeHtml(ent.pending_payment.plan_label || ent.pending_payment.plan) + "</b> ainda está em confirmação. Atualize os benefícios em <a href='minha-conta.html'>Minha conta</a>; não faça outra compra.");
          else showFilePaywall(files.length, big[0].size, "Seu mundo tem " + mb + " MB. O plano gratuito permite até " + limit + ".");
        }
        return;
      }
      setStatus("ok", "Mundo detectado: <b>" + (selected.size / 1048576).toFixed(1) + " MB</b><br>Seu plano: <b>" + escapeHtml(ent.plan_label || (ent.status === "ready" ? ent.plan : "Plano gratuito")) + "</b><br>Limite do seu plano: <b>" + (maxBytes === null ? "sem limite comercial" : limit) + "</b><br>✓ Arquivo permitido");
      fileAccessReady = true;
      maybeRouteToToolIntent();
    }).catch(function () {
      if (selected !== selection) return;
      setStatus("err", "Não foi possível verificar seu plano agora. Tente novamente. Nenhuma nova compra é necessária para verificar uma assinatura existente.");
    });
    updateSubmit();
  }

  function updateSubmit() {
    submit.disabled = checkingEntitlement || !(selected && accept.checked);
    if (diagBtn) diagBtn.disabled = !selected;
  }

  input.addEventListener("change", function () { pick(input.files); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { pick(e.dataTransfer.files); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  accept.addEventListener("change", updateSubmit);

  var gameSel = $("gamemode");
  if (gameSel) gameSel.addEventListener("change", function () {
    // Any explicit mode change is a paid operation. `keep` is the no-op/free
    // choice and remains available so the rest of the free tools work.
    if (gameSel.value !== "keep" && !(gameSel.value === "survival" && $('reactivateAchievements') && $('reactivateAchievements').checked) && !remotePremOk()) {
      lockedHint("Alterar o modo de jogo é uma função paga.", "world1", { tool: gameSel.value === "creative" ? "criativo" : "mundo" });
      gameSel.value = "keep";
    }
  });
  if (wantIcon) wantIcon.addEventListener("change", function () {
    // A foto do mundo é uma ferramenta simples e permanece gratuita.
  });
  var stripCb = $("stripPacks");
  if (wantRename) wantRename.addEventListener("change", function () {
    if (wantRename.checked) renameInput.focus();
  });
  function showIconPreview(blob) {
    try {
      var url = URL.createObjectURL(blob);
      iconPreview.src = url;
      iconPreview.style.display = "block";
    } catch (e) {}
  }
  // O mundo Bedrock usa world_icon.jpeg (JPEG). Converte qualquer upload
  // (PNG/JPG/WebP) para JPEG quadrado 512px via canvas — antes o site
  // enviava o PNG cru como pack_icon.png e o jogo ignorava a foto.
  function fileToJpegBytes(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          URL.revokeObjectURL(url);
          var S = 512;
          var c = document.createElement("canvas");
          c.width = S; c.height = S;
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, S, S);
          var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
          var sc = Math.max(S / iw, S / ih); // cover: preenche o quadrado
          var dw = iw * sc, dh = ih * sc;
          ctx.drawImage(img, (S - dw) / 2, (S - dh) / 2, dw, dh);
          c.toBlob(function (blob) {
            if (!blob) { reject(new Error("Falha ao converter a imagem.")); return; }
            blob.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, reject);
          }, "image/jpeg", 0.92);
        } catch (e) { reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Não consegui ler essa imagem.")); };
      img.src = url;
    });
  }
  if (iconBtn) iconBtn.addEventListener("click", function () {
    // Foto do mundo é gratuita; não interromper a seleção.
    iconFile.click();
  });
  if (iconFile) iconFile.addEventListener("change", function () {
    var f = iconFile.files && iconFile.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type || "")) { setStatus("err", "Foto: envie <b>PNG, JPG ou WebP</b> (vira JPEG sozinha)."); return; }
    if (f.size > 8 * 1024 * 1024) { setStatus("err", "Foto grande demais (máx. <b>8 MB</b>)."); return; }
    iconName.textContent = "Convertendo para JPEG…";
    fileToJpegBytes(f).then(function (bytes) {
      selectedIconBytes = bytes;
      presetBytes = null;
      iconPreset = null;
      wantIcon.checked = true;
      iconName.textContent = f.name + " → world_icon.jpeg (" + fmtSize(bytes.length) + ")";
      showIconPreview(new Blob([bytes], { type: "image/jpeg" }));
      setStatus(null);
    }).catch(function (err) {
      setStatus("err", "Foto: " + escapeHtml((err && err.message) || err));
    });
  });

  /* ---------- instalar addons (.mcpack/.zip -> behavior/resource_packs) ---------- */
  var packInput = $("packFiles"), packBtn = $("packBtn"), packListEl = $("packList");
  var achievementsCb = $("reactivateAchievements"), stripPacksCb = $("stripPacks");
  var selectedPacks = [];
  function syncPackOptions() {
    var hasSelectedPacks = selectedPacks.length > 0;
    if (hasSelectedPacks) {
      if (achievementsCb) achievementsCb.checked = false;
      if (stripPacksCb) stripPacksCb.checked = false;
    }
    if (achievementsCb) achievementsCb.disabled = hasSelectedPacks;
    if (stripPacksCb) stripPacksCb.disabled = hasSelectedPacks;
    var hint = $("packCompatibilityHint");
    if (hint) hint.textContent = hasSelectedPacks
      ? "Pacote selecionado: reativação e remoção de addons desmarcadas. Behavior packs podem bloquear conquistas no Minecraft."
      : "Pacotes de textura e comportamento de um .mcaddon são adicionados juntos. Behavior packs podem bloquear conquistas no Minecraft.";
  }
  function sanitizeFolder(s) {
    var t = String(s || "pack").toLowerCase();
    try { t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    t = t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    return t || "pack";
  }
  function revokePackIcons() {
    selectedPacks.forEach(function (p) {
      try { if (p.iconUrl) URL.revokeObjectURL(p.iconUrl); } catch (e) {}
    });
  }
  function paintPacks() {
    if (!packListEl) return;
    if (!selectedPacks.length) { packListEl.textContent = ""; return; }
    packListEl.innerHTML = selectedPacks.map(function (p, i) {
      var img = p.iconUrl ? '<img class="pack-icon" src="' + p.iconUrl + '" alt="" aria-hidden="true">' : '<span class="pack-icon pack-icon-none" aria-hidden="true">📦</span>';
      return '<span class="pack-chip">' + img + '<span class="pack-tx"><b>' + escapeHtml(p.pack.name) + "</b><em>" + (p.kind === "resource" ? "textura" : "comportamento") + " · v" + p.pack.version.join(".") + '</em></span><button type="button" class="pack-x" data-i="' + i + '" aria-label="Remover pacote">×</button></span>';
    }).join("") + ' <a href="#" id="packClear">limpar tudo</a>';
    Array.prototype.forEach.call(packListEl.querySelectorAll(".pack-x"), function (b) {
      b.addEventListener("click", function () {
        var i = +b.getAttribute("data-i");
        try { if (selectedPacks[i] && selectedPacks[i].iconUrl) URL.revokeObjectURL(selectedPacks[i].iconUrl); } catch (e) {}
        selectedPacks.splice(i, 1);
        if (!selectedPacks.length && packInput) packInput.value = "";
        syncPackOptions();
        paintPacks();
      });
    });
    var c = $("packClear");
    if (c) c.addEventListener("click", function (e) {
      e.preventDefault();
      revokePackIcons();
      selectedPacks = [];
      if (packInput) packInput.value = "";
      syncPackOptions();
      paintPacks();
    });
  }
  function parseManifestJson(txt) {
    try { return JSON.parse(String(txt || "").replace(/^\uFEFF/, "")); }
    catch (e) { throw new Error("manifest.json inválido"); }
  }
  function packFromZip(z, f, manRel) {
    return z.file(manRel).async("string").then(function (txt) {
      var man = parseManifestJson(txt);
      var h = man.header || {};
      var pid = h.pack_id || h.uuid;
      if (!pid) throw new Error("manifest sem uuid/pack_id");
      var ver = Array.isArray(h.version) ? h.version.slice(0, 3).map(Number) : [1, 0, 0];
      while (ver.length < 3) ver.push(0);
      if (ver.some(function (n) { return !isFinite(n); })) throw new Error("versão do manifest inválida");
      var mods = man.modules || [];
      var hasData = mods.some(function (m) { return /^(data|script)$/i.test(m.type || ""); });
      var hasRes = mods.some(function (m) { return /^resources$/i.test(m.type || ""); });
      var kind = hasData ? "behavior" : (hasRes ? "resource" : "behavior");
      var base = manRel.indexOf("/") >= 0 ? manRel.slice(0, manRel.lastIndexOf("/") + 1) : "";
      var files = {}, jobs = [];
      z.forEach(function (rel, e) {
        if (e.dir) return;
        if (rel.slice(0, base.length) !== base) return; // fora da pasta do pack: ignora
        jobs.push(e.async("uint8array").then(function (u8) { files[rel.slice(base.length) || "manifest.json"] = new Uint8Array(u8); }));
      });
      return Promise.all(jobs).then(function () {
        var iconUrl = null;
        try {
          var iconKey = Object.keys(files).filter(function (k) { return /(^|\/)pack_icon\.(png|jpg|jpeg)$/i.test(k); })[0];
          if (iconKey) {
            var mime = /\.png$/i.test(iconKey) ? "image/png" : "image/jpeg";
            iconUrl = URL.createObjectURL(new Blob([files[iconKey]], { type: mime }));
          }
        } catch (e) {}
        return { file: f, folder: sanitizeFolder(h.name || f.name), kind: kind, pack: { pack_id: String(pid), version: ver, name: String(h.name || f.name).slice(0, 80) }, files: files, iconUrl: iconUrl };
      });
    });
  }
  // Sempre resolve para ARRAY de pacotes (um .mcaddon pode conter vários).
  function readPackFile(f, depth) {
    depth = depth || 0;
    return f.arrayBuffer().then(function (ab) {
      if (typeof JSZip === "undefined") throw new Error("JSZip não carregou. Recarregue a página.");
      if (f.size > 50 * 1024 * 1024) throw new Error("pacote maior que 50 MB");
      return JSZip.loadAsync(ab);
    }).then(function (z) {
      var manifests = [];
      z.forEach(function (rel, e) {
        if (!e.dir && /(^|\/)manifest\.json$/i.test(rel)) manifests.push(rel);
      });
      if (manifests.length) {
        if (manifests.length > 10) throw new Error("mcaddon com pacotes demais (máx. 10)");
        // .mcaddon pode conter behavior/resource packs em pastas irmãs.
        var roots = manifests.filter(function (rel) {
          var dir = rel.slice(0, rel.lastIndexOf("/") + 1);
          return !manifests.some(function (other) {
            if (other === rel) return false;
            var otherDir = other.slice(0, other.lastIndexOf("/") + 1);
            return otherDir !== dir && dir.indexOf(otherDir) === 0;
          });
        });
        return Promise.all(roots.map(function (rel) { return packFromZip(z, f, rel); }));
      }
      // sem manifest: pode ser .mcaddon (zip com .mcpack dentro)
      if (depth > 0) throw new Error("não é addon válido (sem manifest.json)");
      var inners = [];
      z.forEach(function (rel, e) {
        if (!e.dir && /\.mcpack$/i.test(rel)) inners.push(rel);
      });
      if (!inners.length) throw new Error("não é addon válido (sem manifest.json)");
      if (inners.length > 10) throw new Error("mcaddon com pacotes demais (máx. 10)");
      var jobs = inners.map(function (rel) {
        return z.file(rel).async("blob").then(function (b) {
          var nm = rel.split("/").pop() || "pack.mcpack";
          var like = { name: nm, size: b.size, arrayBuffer: function () { return b.arrayBuffer(); } };
          return readPackFile(like, depth + 1);
        });
      });
      return Promise.all(jobs).then(function (lists) {
        var flat = [];
        lists.forEach(function (l) { flat = flat.concat(l); });
        if (!flat.length) throw new Error("mcaddon vazio");
        return flat;
      });
    });
  }
  if (packBtn) packBtn.addEventListener("click", function () { if (packInput) packInput.click(); });
  if (packInput) packInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(packInput.files || []);
    files = files.filter(function (f) { return /\.(mcpack|mcaddon|zip)$/i.test(f.name || ""); });
    if (!files.length) { setStatus("err", "Envie <b>.mcpack</b>, <b>.mcaddon</b> ou <b>.zip</b> de addon."); return; }
    setStatus("", '<span class="spin"></span> Lendo pacote(s)…');
    Promise.all(files.map(function (f) {
      return readPackFile(f).catch(function (err) { throw new Error(escapeHtml(f.name) + ": " + escapeHtml((err && err.message) || err)); });
    })).then(function (lists) {
      revokePackIcons();
      selectedPacks = [];
      lists.forEach(function (l) { selectedPacks = selectedPacks.concat(l); });
      syncPackOptions();
      paintPacks();
      setStatus(null);
    }).catch(function (err) {
      setStatus("err", "Pacote inválido: " + (err && err.message));
    });
  });

  // Inventário, tempo e clima são ferramentas simples e ficam livres.

  /* ---------- conversão local ---------- */
  function selRule(el) {
    if (!el) return null;
    var v = parseInt(el.value, 10);
    return (v === 0 || v === 1) ? v : null;
  }
  function batchLimit() {
    return serverEntitlement.status === "ready" || serverEntitlement.status === "unauthenticated" ? Math.max(1, +serverEntitlement.max_batch || 1) : 0;
  }
  var checkingEntitlement = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (checkingEntitlement || !selected || !accept.checked) return;
    if (!window.RC_entitlements) { setStatus("err", "Não foi possível verificar seu plano agora. Tente novamente."); return; }
    checkingEntitlement = true;
    updateSubmit();
    setStatus("ok", "Verificando seu plano...");
    window.RC_entitlements.load().then(function (ent) {
      if (ent.status !== "ready" && ent.status !== "unauthenticated") throw new Error("ENTITLEMENT_UNAVAILABLE");
      serverEntitlement = Object.assign({}, ent, { ready: ent.status === "ready", until: +ent.premium_until_ms || 0, email: ent.account_email || "" });
      window.RC_entitlementState = serverEntitlement;
      checkingEntitlement = false;
      paintQuota();
      try { runConversion(); } catch (error) { presentOperationFailure(error); updateSubmit(); }
    }).catch(function (err) {
      checkingEntitlement = false;
      updateSubmit();
      var expired = err && (err.entitlement_status === "session_expired" || err.status === 401);
      setStatus("err", expired ? "Sua sessão Google expirou. Entre novamente e atualize seus benefícios." : "Não foi possível verificar seu plano agora. Tente novamente. Nenhuma nova compra é necessária para verificar um plano existente.");
    });
  });
  function runConversion() {
    try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("operation_started", { worlds: selectedList.length || 1, source: sourceForTool(currentToolSlug() || "conquistas") }); } catch (e0) {}
    if (!selected || submit.disabled) return;
    if (!accept.checked) { setStatus("err", "Para converter, você precisa <b>aceitar os Termos</b> marcando a caixinha acima."); return; }

    var prem = remotePremOk();
    var premUnlimited = isPremiumAny(); // Premium da conta (AbacatePay)
    var batch = selectedList.length > 1;
    var reactivateAchievements = !!($('reactivateAchievements') && $('reactivateAchievements').checked);
    var mode = "survival";
    try {
      var gs = $("gamemode");
      if (gs && ["survival", "creative", "adventure", "keep"].indexOf(gs.value) >= 0) mode = gs.value;
    } catch (e2) { mode = "survival"; }
    if (reactivateAchievements) mode = "survival";
    if (mode !== "keep" && !(reactivateAchievements && mode === "survival") && !prem) {
      lockedHint("Alterar o modo de jogo é uma função paga. O plano grátis pode manter o modo atual.", "world1", { tool: mode === "creative" ? "criativo" : "mundo" });
      return;
    }
    var rules = {
      keepinventory: selRule(keepSel),
      showcoordinates: selRule(coordSel),
      dodaylightcycle: null,
      doweathercycle: null,
      doimmediaterespawn: selRule(immediateSel),
      mobgriefing: selRule(mobGriefSel),
      naturalregeneration: selRule(naturalRegenSel)
    };
    var dv = selRule(daySel);
    if (dv !== null) rules.dodaylightcycle = dv === 0 ? 0 : 1; // travar = dodaylightcycle 0
    var wv = selRule(weatherSel);
    if (wv !== null) rules.doweathercycle = wv === 0 ? 0 : 1;
    var wantsTime = rules.dodaylightcycle !== null || rules.doweathercycle !== null;
    var wantsKeep = rules.keepinventory !== null;
    var iconBytes = (wantIcon.checked && (selectedIconBytes || presetBytes)) || null;
    var wantsPrem = false;
    var wantsHardcore = !!(recoverHardcore && recoverHardcore.checked);
    wantsPrem = wantsPrem || wantsHardcore;
    if (wantsPrem && !prem) {
      if (!loggedIn()) {
        setStatus("err", "Essa função é paga. <a href='minha-conta.html'><b>Entre com a mesma conta Google usada na compra</b></a> primeiro.");
        var cl = $("claimLink");
        try { if (window.RC_auth) window.RC_auth.openModal(); } catch (e3) {}
        return;
      }
      lockedHint("Essa função é VIP.", batch ? "vip30" : undefined);
      return;
    }
    var diffSel = $("difficulty");
    var difficulty = diffSel ? parseInt(diffSel.value, 10) : -1;
    if (!(difficulty >= 0 && difficulty <= 3)) difficulty = null; // conquistas exigem Sobrevivência
    // Foto, tempo, clima e inventário são liberados no plano gratuito.
    if (wantsHardcore && !prem) { lockedHint("Recuperar mundo Hardcore é um recurso VIP.", "vip30"); return; }
    var newName = wantRename && wantRename.checked ? (renameInput.value || "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    var stripEl = $("stripPacks");
    var stripPacks = !!(stripEl && stripEl.checked);
    stripPacks = stripPacks || reactivateAchievements;
    var addPacks = selectedPacks.filter(function () { return !reactivateAchievements; }).map(function (p) { return { folder: p.folder, kind: p.kind, files: p.files, pack: p.pack }; });
    if (addPacks.length && !prem && addPacks.length > freeAddPacksLimit()) {
      lockedHint("Grátis: até " + freeAddPacksLimit() + " pacotes por mundo (" + addPacks.length + " escolhidos). O VIP instala quantos precisar.", "vip30");
      return;
    }

    if (batch && selectedList.length > batchLimit()) {
      lockedHint("Seu acesso permite até " + batchLimit() + " mundos por lote. Escolha um plano maior para processar mais arquivos.", remotePlan() === "vip7" ? "vip30" : "creator");
      return;
    }
    // tamanho vale na hora do clique (o VIP pode ter expirado depois da seleção)
    var maxB = sizeLimitMB() * 1024 * 1024;
    var tooBig = selectedList.filter(function (f) { return f.size > maxB; });
    if (tooBig.length) {
      if (!remotePremOk()) lockedHint("Esse mundo passa de " + sizeLimitMB() + " MB (" + tooBig[0].name + "). Seu plano pago define o limite de arquivo e libera os recursos avançados.");
      else setStatus("err", "Arquivo acima do limite deste plano (máx. <b>" + paidSizeLimitMB() + " MB</b>): " + escapeHtml(tooBig[0].name));
      return;
    }
    if (typeof window.RC_convert === "undefined" || ((batch || /\.dat$/i.test(selected.name || "")) && typeof window.RC_local === "undefined")) {
      setStatus("err", "Conversor ainda carregando (JSZip). Aguarde 5s e tente de novo.");
      return;
    }
    // Limite leve do grátis: N conversões por dia (VIP = ilimitado).
    if (!prem && serverFreeQuota.ready && serverFreeQuota.remaining <= 0) {
      lockedHint("Você usou as " + freeDailyLimit() + " conversões grátis de hoje. O VIP é ilimitado, sem espera.", "vip30");
      return;
    }
    // Botão único: chunks + player entram no MESMO arquivo, se marcados
    var wantChunks = !!(window.RC_reset && window.RC_reset.selCount() > 0);
    var wantPlayer = !!(window.RC_player && window.RC_player.hasEdits());
    // Resolver 1 mundo is a single-world entitlement, so any generated world
    // consumes it. Time-based plans only need this gate for premium features.
    var playerAdvanced = !!(wantPlayer && window.RC_player && window.RC_player.requiresPremium && window.RC_player.requiresPremium());
    var featureTools = ["convert"];
    if (wantChunks) featureTools.push("chunks_restore");
    if (wantPlayer) featureTools.push("player_basic");
    var premiumRequested = remotePlan() === "world1" || (mode !== "keep" && !reactivateAchievements) || wantsHardcore ||
      addPacks.length > freeAddPacksLimit() || selectedList.some(function (f) { return f.size > freeLimitMB() * 1024 * 1024; }) ||
      (wantChunks && window.RC_reset.selCount() > freeChunksLimit()) || playerAdvanced;
    var operationId = "";
    try { operationId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); } catch (eop) { operationId = String(Date.now()) + Math.random(); }
    var operationDecision = null;
    var worldInfo = { project_id: "", fingerprint: "" };
    var worldInfoPromise = batch || /\.dat$/i.test(selected.name || "") ? Promise.resolve(worldInfo) : worldProjectInfo(selected).then(function (info) { worldInfo = info; return info; });
    var entitlementCheck = null;
    if (premiumRequested) {
      if (!loggedIn() || !window.RC_pay || !window.RC_pay.authorizeOperation) {
        setStatus("err", "Esta operação exige uma autorização válida da conta Google. Entre novamente e tente de novo.");
        return;
      }
      if (remotePlan() === "world1" && /\.dat$/i.test(selected.name || "")) {
        setStatus("err", "O crédito de 1 mundo precisa de um arquivo <b>.mcworld</b> completo. O arquivo <b>level.dat</b> avulso não identifica o mundo.");
        return;
      }
      entitlementCheck = function () { return worldInfoPromise.then(function (info) { return window.RC_pay.authorizeOperation(
        selectedList.length,
        Math.max.apply(null, selectedList.map(function (f) { return f.size || 0; })),
        { mode: mode, hardcore: wantsHardcore, advanced_rules: wantsKeep || wantsTime,
          tools: featureTools, chunks_count: wantChunks ? window.RC_reset.selCount() : 0, player_advanced: playerAdvanced,
          remove_behavior_packs: stripPacks, reactivate_achievements: reactivateAchievements,
          add_packs: addPacks.length, rename: false, icon: !!(wantIcon && wantIcon.checked), tool: "convert" },
        operationId,
        info.project_id,
        info.fingerprint
      ); }).then(function (decision) {
        operationDecision = decision;
        if (!operationDecision.world_project_id && worldInfo.project_id) operationDecision.world_project_id = worldInfo.project_id;
        return decision;
      }).catch(function (err) { throw err; }); };
    }
    if (!premiumRequested) {
      if (!window.RC_pay || !window.RC_pay.authorizeOperation) { setStatus("err", "Não foi possível validar a operação no servidor. Tente novamente."); return; }
      entitlementCheck = function () { return worldInfoPromise.then(function (info) { return window.RC_pay.authorizeOperation(
        selectedList.length, Math.max.apply(null, selectedList.map(function (f) { return f.size || 0; })),
        { mode: mode, tools: featureTools, chunks_count: wantChunks ? window.RC_reset.selCount() : 0, player_advanced: playerAdvanced, remove_behavior_packs: stripPacks, reactivate_achievements: reactivateAchievements },
        operationId, info.project_id, info.fingerprint
      ); }).then(function (decision) { operationDecision = decision; return decision; }); };
    }
    if ((wantChunks || wantPlayer) && (batch || /\.dat$/i.test(selected.name || ""))) {
      setStatus("err", "Reset de chunks e player gemado funcionam com <b>1 .mcworld por vez</b> (não no lote nem em level.dat avulso).");
      return;
    }
    if (wantChunks) {
      var cerr = window.RC_reset.preflight();
      if (cerr) { setStatus("err", cerr); return; }
    }
    if (wantPlayer) {
      var perr = window.RC_player.preflight();
      if (perr) { setStatus("err", perr); return; }
    }
    if (batch && ((wantIcon.checked && iconBytes) || newName)) {
      setStatus("err", "No lote, <b>foto e nome único</b> não se aplicam — um por vez para usá-los.");
      return;
    }
    var operationGate = Promise.all([entitlementCheck(), worldInfoPromise]);
    function packLimitOf(err) {
      var g = /^PACK_LIMIT\|(\d+)\|(\d+)/.exec(String((err && err.message) || err || ""));
      return g ? { packs: +g[1], limit: +g[2] } : null;
    }
    function packLimitHint(err) {
      var pl = packLimitOf(err);
      if (!pl) return false;
      lockedHint("Este mundo tem " + pl.packs + " addons — o grátis remove até " + pl.limit + " por mundo. O VIP remove quantos precisar, sem limite.", "vip30");
      submit.disabled = false;
      return true;
    }

    setStatus("", '<span class="spin"></span> Corrigindo <b>no seu PC</b>, aguarde… (arquivo não é enviado)');
    submit.disabled = true;

    var iconPromise = Promise.resolve(wantIcon.checked ? iconBytes : null);

    function downloadBlob(blob, name) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("download_started", { source: sourceForTool(currentToolSlug() || "conquistas") }); } catch (e) {}
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    var DIFFS = ["Pacífico", "Fácil", "Normal", "Difícil"];
  function diffName(v) { return DIFFS[v] || ("nível " + v); }
  function summarizeChanges(changes) {
    var list = changes || [];
    var out = [];
    var flags = list.filter(function (c) { return /^byte /.test(c); }).length;
    if (flags) out.push("conquistas liberadas (" + flags + " ajustes)");
    var gm = null;
    list.forEach(function (c) {
      var g2 = /\(GameType\) = \d+ -> (\d)/.exec(c);
      if (g2) gm = +g2[1];
    });
    var GMN = ["Sobrevivência", "Criativo", "Aventura"];
    out.push(gm === null ? "modo Sobrevivência confirmado" : ("modo " + (GMN[gm] || gm) + " aplicado"));
      var RULE_TXT = { keepinventory: "manter inventário", showcoordinates: "coordenadas na tela", dodaylightcycle: "ciclo dia/noite", doweathercycle: "clima", doimmediaterespawn: "renascimento imediato", mobgriefing: "dano de mobs ao cenário", naturalregeneration: "regeneração natural" };
    list.forEach(function (c) {
      var dm = /\(Difficulty\) = \d+ -> (\d)/.exec(c);
      if (dm) { out.push("dificuldade " + diffName(+dm[1])); return; }
      var rl = /\((keepinventory|showcoordinates|dodaylightcycle|doweathercycle|doimmediaterespawn|mobgriefing|naturalregeneration)\) = \d+ -> (\d)/.exec(c);
      if (rl) { out.push((RULE_TXT[rl[1]] || rl[1]) + (rl[2] === "1" ? " ligado" : " desligado")); return; }
      if (/foto do mundo|world_icon/.test(c)) { out.push("foto do mundo atualizada"); return; }
      if (/addons de comportamento removidos/.test(c)) { out.push(c); return; }
      if (/addon instalado/.test(c)) { out.push(c.replace(/^addon instalado \(([^)]+)\)/, "pacote $1 instalado")); return; }
      if (/nome alterado/.test(c)) { out.push("mundo renomeado"); return; }
      if (/levelname\.txt/.test(c)) { out.push("nome em levelname.txt"); return; }
    });
    return out.join(" · ");
  }

    function finishSingle(outName, f, res, iconBytes, extras) {
      var projectId = (operationDecision && operationDecision.world_project_id) || worldInfo.project_id;
      var prepareOutput = operationDecision && operationDecision.requires_credit && window.RC_entitlements
        ? window.RC_entitlements.markWorldForCompletion(res.blob, projectId).then(function (finalized) { res.blob = finalized.blob; return finalized; })
        : attachWorldProject(res.blob, projectId).then(function (blob) { res.blob = blob; return { blob: blob, fingerprint: "" }; });
      var consumeFreeRemote = Promise.resolve(null);
      return prepareOutput.then(function (finalized) {
        if (operationDecision && operationDecision.requires_completion && window.RC_entitlements) return window.RC_entitlements.complete(operationId, finalized.fingerprint);
        return null;
      }).then(function (completed) {
        if (completed && completed.credit_consumed && window.RC_entitlements) {
          return window.RC_entitlements.refresh().then(function (ent) {
            serverEntitlement = Object.assign({}, ent, { ready: ent.status === "ready", until: +ent.premium_until_ms || 0, email: ent.account_email || "" });
            window.RC_entitlementState = serverEntitlement;
            paintQuota();
          }).catch(function () {});
        }
      }).then(function () { return consumeFreeRemote; }).then(function () {
        if (lastWorldReport) lastWorldReport.operation = { completed_at: new Date().toISOString(), output_file: outName, changes: res.changes || [], warnings: res.warnings || [], additional_operations: extras || [], original_preserved: true };
        downloadBlob(res.blob, outName);
        if (!premUnlimited && window.RC_pay && window.RC_pay.freeQuota) {
          window.RC_pay.freeQuota(false).then(function (q) { serverFreeQuota = { ready: true, remaining: Math.max(0, +q.remaining || 0) }; paintQuota(); }).catch(function () {});
        }
        try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("operation_completed", { worlds: 1, source: sourceForTool(currentToolSlug() || "conquistas") }); } catch (e0) {}
        clearCheckoutResume();
      // gatilho pós-valor: só aparece DEPOIS da conversão grátis dar certo
      var nudge = isPremiumAny() ? "" : "<br><span style='font-size:13px'>Curtiu? O <a href='#planos'><b>VIP</b></a> libera mundos gigantes, foto e modo de jogo.</span>";
      var warn = "";
      (res.warnings || []).forEach(function (w) {
        warn += "<br><span style='font-size:13px'>Atenção: <b>" + escapeHtml(w) + "</b></span>";
      });
      if (addPacks.some(function (p) { return p.kind !== "resource"; })) {
        warn += "<br><span style='font-size:13px'>Behavior packs podem bloquear conquistas no Minecraft. Para reativá-las, remova os pacotes escolhidos e converta novamente.</span>";
      }
      var extraTxt = (extras && extras.length) ? "<br>" + extras.map(function (x) { return "· " + escapeHtml(x); }).join(" ") : "";
      setStatus("ok", "Pronto. Download iniciado: <b>" + escapeHtml(outName) +
        "</b><br>" + escapeHtml(summarizeChanges(res.changes)) + extraTxt +
        ". Abra em <b>Sobrevivência</b>, com cheats <b>desligados</b>. <b>Guarde o original</b>." + warn + nudge);
      submit.disabled = false;
      });
    }

    // level.dat direto (1 arquivo): foto não existe avulsa,
    // mas nome e regras ficam dentro do NBT e aplicam.
    if (!batch && /\.dat$/i.test(selected.name || "")) {
      selected.arrayBuffer().then(function (ab) {
        return operationGate.then(function () { return window.RC_local.patchLevelDat(ab, mode, difficulty, { rules: rules, worldName: newName, recoverHardcore: wantsHardcore, paidEntitlement: prem, reactivateAchievements: reactivateAchievements }); });
      }).then(function (res) {
        return finishSingle(selected.name.replace(/\.dat$/i, "") + "-conquistas.dat", selected, res, null);
      }).catch(function (err) {
        if (operationId && window.RC_entitlements) window.RC_entitlements.release(operationId).catch(function () {});
        presentOperationFailure(err);
        submit.disabled = false;
      });
      return;
    }

    // lote VIP: vale modo + regras (foto/nome: um por vez)
    if (batch) {
      operationGate.then(function () { return window.RC_local.convertBatch(selectedList, { gameMode: mode, difficulty: difficulty, rules: rules, recoverHardcore: wantsHardcore, paidEntitlement: prem, reactivateAchievements: reactivateAchievements, stripBehaviorPacks: stripPacks, addPacks: addPacks }); }).then(function (results) {
        if (operationDecision && operationDecision.requires_completion && window.RC_entitlements) return window.RC_entitlements.complete(operationId).then(function () { return results; });
        return results;
      }).then(function (results) {
        if (lastWorldReport) lastWorldReport.operations = results.map(function (r) { return { output_file: r.outName, changes: r.changes || [], warnings: r.warnings || [], original_preserved: true }; });
        results.forEach(function (r) {
          downloadBlob(r.blob, r.outName);
        });
        paintQuota();
        var bwarn = "";
        var bpacks = results.filter(function (r) { return (r.warnings || []).length; }).length;
        if (bpacks > 0 && !stripPacks) bwarn = "<br><span style='font-size:13px'>Atenção: <b>" + bpacks + " arquivo(s) têm addons (pacotes de comportamento)</b> que bloqueiam conquistas no jogo. Marque <b>“Remover addons”</b> no passo 2 e converta de novo.</span>";
        if (stripPacks) bwarn = "<br><span style='font-size:13px'>Addons (pacotes de comportamento) removidos dos arquivos.</span>";
        try { if (window.RC_pay && window.RC_pay.track) window.RC_pay.track("operation_completed", { worlds: results.length, source: sourceForTool(currentToolSlug() || "conquistas") }); } catch (e0) {}
        clearCheckoutResume();
        setStatus("ok", "Pronto. <b>" + results.length + " arquivos</b> corrigidos e baixados. Abra em <b>Sobrevivência</b>, com cheats <b>desligados</b>. <b>Guarde os originais</b>." + bwarn);
        submit.disabled = false;
      }).catch(function (err) {
        if (operationId && window.RC_entitlements) window.RC_entitlements.release(operationId).catch(function () {});
        if (packLimitHint(err)) return;
        presentOperationFailure(err);
        submit.disabled = false;
      });
      return;
    }

    operationGate.then(function () { return Promise.all([selected.arrayBuffer(), iconPromise]); }).then(function (arr) {
      if (wantIcon.checked && arr[1] && !(arr[1][0] === 0xFF && arr[1][1] === 0xD8)) {
        throw new Error("Ícone inválido: o mundo usa world_icon.jpeg (JPEG). Escolha a imagem de novo.");
      }
      return window.RC_convert(arr[0], { gameMode: mode, iconBytes: arr[1], worldName: newName, difficulty: difficulty, rules: rules, recoverHardcore: wantsHardcore, paidEntitlement: prem, reactivateAchievements: reactivateAchievements, stripBehaviorPacks: stripPacks, addPacks: addPacks }).then(function (res) {
        return { res: res, iconBytes: arr[1] };
      });
    }).then(function (both) {
      var chain = Promise.resolve(both.res.blob);
      var extras = [];
      if (wantChunks) {
        chain = chain.then(function (b) {
          setStatus("", '<span class="spin"></span> Aplicando reset de chunks…');
          return window.RC_reset.applyToBlob(b);
        }).then(function (r) {
          extras.push(r.nChunks + " chunk(s) resetado(s)" + (r.vilDel ? " (+" + r.vilDel + " de vila)" : ""));

          return r.blob;
        });
      }
      if (wantPlayer) {
        chain = chain.then(function (b) {
          setStatus("", '<span class="spin"></span> Aplicando player…');
          return window.RC_player.applyToBlob(b);
        }).then(function (r) {
          extras.push("player com " + r.occ + " item(ns)");

          return r.blob;
        });
      }
      return chain.then(function (finalBlob) {
        both.res.blob = finalBlob;
        return finishSingle(baseName(selected.name), selected, both.res, both.iconBytes, extras);
      });
    }).catch(function (err) {
      if (operationId && window.RC_entitlements) window.RC_entitlements.release(operationId).catch(function () {});
      if (packLimitHint(err)) return;
      presentOperationFailure(err);
      submit.disabled = false;
    });
  }

  /* ---------- diagnóstico --check (somente leitura, não consome cota) ---------- */
  if (diagBtn) diagBtn.addEventListener("click", function () {
    if (!selected) { input.click(); return; }
    if (typeof window.RC_local === "undefined") {
      setStatus("err", "Ferramentas locais ainda carregando. Aguarde 5s e tente de novo.");
      return;
    }
    var f = selectedList.length > 1 ? selectedList[0] : selected;
    setStatus("", '<span class="spin"></span> Analisando <b>sem modificar nada</b>…');
    diagBtn.disabled = true;
    f.arrayBuffer().then(function (ab) {
      return window.RC_local.diagnoseAny(ab, f.name);
    }).then(function (rep) {
      diagBtn.disabled = false;
      if (!rep.ok) { setStatus("err", "Não deu para analisar: " + escapeHtml(rep.error || "arquivo inválido")); return; }
      if (rep.alreadyClean) {
        setStatus("ok", "<b>" + escapeHtml(f.name) + "</b> já está limpo (flags zeradas" +
          (rep.gameType.length ? ", GameType = " + rep.gameType.join(", ") : "") + "). Nada a corrigir." +
          (selectedList.length > 1 ? " (mostrei o 1º de " + selectedList.length + ")" : ""));
        return;
      }
      var det = rep.wouldChange.slice(0, 8).map(escapeHtml).join("<br>· ");
      var RULE_LBL = { keepinventory: "manter inventário", showcoordinates: "coordenadas na tela", dodaylightcycle: "ciclo dia/noite", doweathercycle: "clima" };
      var gr = rep.gamerules || {};
      var grTxt = Object.keys(RULE_LBL).map(function (k) {
        return gr[k] === null || gr[k] === undefined ? null : RULE_LBL[k] + " = <b>" + (gr[k] ? "ligado" : "desligado") + "</b>";
      }).filter(Boolean).join(" · ");
      var lockedTxt = rep.locked && ((rep.locked.hasLockedBehaviorPack || []).indexOf(1) >= 0 || (rep.locked.hasLockedResourcePack || []).indexOf(1) >= 0)
        ? "<br>Trava de pack: <b>ativa</b> — remova os behavior packs <b>dentro do jogo</b> antes de exportar o mundo" : "";
      // gatilho contextual: mundo em Criativo/Aventura + usuário grátis
      var vipMode = (!isPremiumAny() && (rep.gameType || []).filter(function (g) { return +g !== 0 && String(g).indexOf("tag") !== 0; }).length)
        ? "<br>Quer <b>manter o Criativo/Aventura</b> em vez de ir para Sobrevivência? Só o <a href='#planos'><b>VIP</b></a> permite." : "";
      // addons: o level.dat pode estar limpo e as conquistas continuarem
      // bloqueadas por pacotes de comportamento personalizados
      var pcD = packCount(rep);
      var packTxt = pcD > 0
        ? "<br>Pacotes de comportamento (addons): <b>" + pcD + " ativo(s)" + (packNames(rep) ? " (" + escapeHtml(packNames(rep)) + (((rep.behaviorPacks.folders || []).length > 4) ? ", …" : "") + ")" : "") + "</b> — addons personalizados <b>BLOQUEIAM conquistas no jogo</b> mesmo com o level.dat limpo. Marque <b>“Remover addons”</b> no passo 2 antes de converter (o original fica intacto)."
        : "";
      setStatus("", "Diagnóstico de <b>" + escapeHtml(f.name) + "</b> — <b>nada foi alterado</b>:<br>· " + det +
        ((rep.worldName && rep.worldName[0]) ? "<br>Nome no level.dat: <b>" + escapeHtml(rep.worldName[0]) + "</b>" : "") +
        ((rep.seed && rep.seed[0]) ? "<br>Seed: <b>" + escapeHtml(rep.seed[0]) + "</b>" : "") +
        (rep.gameType.length ? "<br>Modo atual (GameType): <b>" + rep.gameType.join(", ") + "</b> (0 = Sobrevivência, 1 = Criativo)" : "") +
        (rep.difficulty && rep.difficulty.length ? "<br>Dificuldade atual: <b>" + diffName(rep.difficulty[0]) + "</b>" : "") +
        (grTxt ? "<br>Regras: " + grTxt : "") + lockedTxt + vipMode + packTxt +
        "<br><br>Aperte <b>Corrigir meu mundo</b> para aplicar.");
    }).catch(function (err) {
      diagBtn.disabled = false;
      setStatus("err", "Não deu para analisar: " + escapeHtml((err && err.message) || err));
    });
  });

  paintContact();
  paintPresets();
  paintQuota();
  refreshFreeQuota();
  document.addEventListener("rc-pay-ready", function () { refreshFreeQuota(); refreshRemotePrem().catch(function () {}); });
  document.addEventListener("rc-auth", function () {
    setTimeout(function () {
      var u = null;
      try { u = (window.RC_auth && window.RC_auth.user()) || null; } catch (e) {}
      if (!u) {
        // deslogou: limpa qualquer resto de Premium e volta pro grátis na hora
        serverEntitlement = Object.assign({}, window.RC_entitlements ? window.RC_entitlements.state() : {}, { ready: false });
        window.RC_entitlementState = serverEntitlement;
        serverFreeQuota = { ready: false, remaining: 0 };
        paintQuota();
        return;
      }
      refreshFreeQuota();
      refreshRemotePrem().catch(function () {});
    }, 150);
  });
})();
