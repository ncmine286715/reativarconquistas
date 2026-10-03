/* ReativaConquistas — pagamento AbacatePay 100% em JS, SEM segredo no navegador.
   A chave abc_* fica SÓ no Cloudflare Worker (worker/): o site chama o Worker,
   o Worker chama o AbacatePay. Ativação: WORKER_URL em config.js.
   Fluxo: [data-pay] -> modal (e-mail + status visível) -> POST /api/abacate/create ->
   redireciona p/ checkout -> volta em sucesso.html?id=BILLING_ID ->
   checkReturn() consulta /api/abacate/status e mostra o resultado.
*/
(function () {
  "use strict";

  function base() {
    var u = ((window.RC_CONFIG || {}).WORKER_URL || "").replace(/\/+$/, "");
    // Em produção o site e a API vivem no mesmo Worker; vazio significa mesma origem.
    return u || (location.origin || "");
  }
  function enabled() { return !!base() && !!window.fetch; }
  function paymentProvider() {
    var p = String((window.RC_CONFIG || {}).PAYMENT_PROVIDER || "depix").toLowerCase();
    return p === "abacate" ? "abacate" : (p === "kiwify" || p === "hybrid" ? p : "depix");
  }

  function req(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    // O login atual é Firebase/Google. Não envie rc_token legado:
    // uma sessão antiga poderia associar a cobrança ao e-mail errado.
    function request(attempt) {
      return fetch(base() + path, opts).catch(function (error) {
        // Leituras do plano podem ser repetidas sem reservar créditos nem criar cobranças.
        if (attempt === 0 && (!opts.method || opts.method === "GET") &&
            (path === "/api/config" || path === "/api/entitlements")) {
          return new Promise(function (resolve) { setTimeout(resolve, 800); }).then(function () { return request(1); });
        }
        throw Object.assign(new Error("Não foi possível conectar ao servidor para verificar seu plano. Confira a conexão e tente novamente."), { code: "API_NETWORK_UNAVAILABLE", cause: error });
      }).then(function (res) {
        if (attempt === 0 && (!opts.method || opts.method === "GET") && path === "/api/entitlements" && [502, 503, 504].indexOf(res.status) >= 0) {
          return new Promise(function (resolve) { setTimeout(resolve, 700); }).then(function () { return request(1); });
        }
        return res;
      });
    }
    return request(0).then(function (res) {
      return res.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) {}
        if (!res.ok) throw Object.assign(new Error((j && j.error) || ("Erro " + res.status)), { status: res.status, payload: j });
        return j;
      });
    });
  }

  function currentUser() {
    try { return (window.RC_auth && window.RC_auth.user()) || null; }
    catch (e) { return null; }
  }
  function currentEmail() {
    var u = currentUser();
    return (u && u.email) || "";
  }
  function authReq(path, opts) {
    opts = opts || {};
    function send(forceRefresh) {
      return (window.RC_auth && window.RC_auth.getToken ? window.RC_auth.getToken(forceRefresh) : Promise.resolve("")).then(function (token) {
        if (!token) throw new Error("Entre novamente com sua conta Google para continuar.");
        opts.headers = opts.headers || {};
        opts.headers.Authorization = "Bearer " + token;
        return req(path, opts);
      });
    }
    return send(false).catch(function (error) {
      if (error && error.status === 401 && window.RC_auth && window.RC_auth.getToken) return send(true);
      throw error;
    });
  }

  var telemetryId = "";
  try {
    telemetryId = localStorage.getItem("rc_telemetry_id") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem("rc_telemetry_id", telemetryId);
  } catch (e) { telemetryId = "anonymous"; }
  function track(event, data) {
    try {
      if (window.RC_analytics && window.RC_analytics.track) window.RC_analytics.track(event, data);
      var tool = "";
      try {
        var saved = sessionStorage.getItem("rc_tool_intent") || "";
        var intent = window.RC_toolIntents && window.RC_toolIntents.resolve(saved);
        if (intent) tool = intent.slug;
      } catch (e0) {}
      var body = Object.assign({ event: String(event || "").slice(0, 40), session_id: telemetryId, page: location.pathname }, tool ? { tool: tool, source: "tool_" + tool.replace(/-/g, "_") } : {}, data || {});
      try { if (window.WorldifyAudit) window.WorldifyAudit.record(event, body); } catch (auditError) {}
      fetch(base() + "/api/telemetry", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  function trackPaymentState(r) {
    var state = String((r && r.status) || "").toLowerCase();
    var event = /expir/.test(state) ? "payment_expired" : /fail|cancel|refus|rejeit/.test(state) ? "payment_failed" : /pend|wait|aguard|open|created|unpaid/.test(state) ? "payment_pending" : "";
    if (event) track(event, { plan: r.plan || "" });
  }
  track("page_view");

  // Telemetria de erro: o navegador conta o que travou (leitura só com segredo).
  function logClient(step, message) {
    try {
      fetch(base() + "/api/client-log", {
        method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ step: step, message: String(message || "").slice(0, 300), href: String(location.href).slice(0, 120) })
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---------- modal de pagamento (tudo visível, sem prompt) ---------- */
  function friendlyErr(err) {
    var m = String((err && err.message) || err || "");
    if (err && err.status === 409 && /cobrança|checkout|tentativa anterior/i.test(m)) return m;
    if (/failed to fetch|networkerror|load failed/i.test(m)) {
      return "Não consegui falar com o servidor de pagamento. Confira sua internet e tente novamente.";
    }
    if (/Muitas tentativas/i.test(m)) return m;
    if (/compliance review|unable to process deposits for this payer/i.test(m)) {
      return "O provedor Pix não conseguiu processar este pagador no momento. Nenhuma cobrança foi criada. Use somente o documento do responsável que realmente fará o pagamento ou contate o suporte do provedor.";
    }
    if (/401|API key|invalid_api_key/i.test(m)) {
      return "O Pix está temporariamente indisponível. Tente novamente mais tarde.";
    }
    return "Não deu: " + m;
  }
  function classifyError(err) {
    var m = String((err && err.message) || err || "").toLowerCase();
    if (/cpf|cnpj|documento/.test(m)) return "document_invalid";
    if (/e-mail|email/.test(m)) return "email_invalid";
    if (/401|conta google|autentic/.test(m)) return "unauthenticated";
    if (/429|muitas tentativas|rate/.test(m)) return "rate_limited";
    if (/api key|invalid_api_key/.test(m)) return "api_key";
    if (/compliance|pagador/.test(m)) return "compliance";
    if (/timeout|timed out/.test(m)) return "timeout";
    if (/fetch|network|conexão/.test(m)) return "network";
    if (/5\d\d|depix recusou/.test(m)) return "provider";
    return "internal";
  }
  function closePay() {
    var m = document.getElementById("payModal");
    if (m) { m.remove(); if (payReturnFocus && payReturnFocus.isConnected) payReturnFocus.focus(); }
  }
  function payStatus(t, kind) {
    var m = document.getElementById("payMsg");
    if (!m) return;
    if (!t) { m.hidden = true; m.className = "status"; m.textContent = ""; return; }
    m.hidden = false;
    m.className = "status " + (kind || "");
    m.textContent = t;
  }

  function escH(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var PLAN_IDS = ["essential7v4","pro7v4","creator30v4","studio30v4"];
  var PLANS = {};
  var PUBLIC_PLANS = {};
  var payReturnFocus = null;
  var planCatalogReady = false;
  var planCatalogPending = null;
  var planModalWaiting = false;
  var salesEnabled = true;
  var paymentServerConfig = null;
  function priceText(cents) { return "R$ " + ((+cents || 0) / 100).toFixed(2).replace(".", ","); }
  function planPrice(plan) { return PUBLIC_PLANS[plan] ? priceText(PUBLIC_PLANS[plan].price_cents) : ""; }
  function planSummary(id) {
    var p = PUBLIC_PLANS[id] || {};
    var limit = p.max_file_mb === null ? "sem limite comercial de tamanho" : "até " + p.max_file_mb + " MB por mundo";
    var batch = "até " + (p.max_batch || 1) + " mundo(s) por lote";
    if (p.kind === "world_credit") return (p.credit_count || 1) + " crédito(s), " + limit + ". Use um mundo por vez. Créditos sem uso não expiram; reedite cada projeto reconhecido por " + (p.project_window_days || 30) + " dias após a última operação concluída. Inclui editor e Builder; " + (window.RC_toolIntents.includesStudio(p) ? "inclui World Studio" : "não inclui World Studio") + ". Compra única, sem renovação automática.";
    return "Acesso por " + (p.duration_days || 0) + " dias a partir da confirmação do pagamento, " + limit + " e " + batch + ". " + (window.RC_toolIntents.includesStudio(p) ? "Inclui World Studio. " : "World Studio não incluído. ") + (p.daily_operations ? p.daily_operations + " operações concluídas por dia, reset às 21h de Brasília (00h UTC). " : "") + "Pagamento único, sem renovação automática.";
  }
  function applyPlanCatalog(config) {
    paymentServerConfig = config || null;
    PUBLIC_PLANS = config && config.plans || {};
    salesEnabled = !config || config.sales_enabled !== false;
    PLANS = {};
    PLAN_IDS = window.RC_toolIntents ? window.RC_toolIntents.catalogIds(config) : [];
    var grid = document.querySelector('.wf-pricing');
    if (grid) {
      while (grid.querySelectorAll('.wf-plan-slot').length < PLAN_IDS.length) {
        var template = grid.querySelector('.wf-plan-slot');
        if (!template) break;
        var clone = template.cloneNode(true);
        clone.querySelector('[data-pay]').addEventListener('click', function(event) { event.preventDefault(); checkout(this.getAttribute('data-pay'), null, {source:'pricing_card'}); });
        grid.appendChild(clone);
      }
    }
    document.querySelectorAll('.wf-plan-slot').forEach(function(card, i) {
      var button = card.querySelector('[data-pay]');
      card.hidden = !PLAN_IDS[i];
      if (button && PLAN_IDS[i]) { button.setAttribute('data-pay', PLAN_IDS[i]); button.disabled = !PUBLIC_PLANS[PLAN_IDS[i]]; }
    });
    var catalogStatus = document.getElementById('catalogStatus');
    if (catalogStatus) catalogStatus.textContent = salesEnabled
      ? 'Pagamento único · sem renovação automática. Preços e limites verificados no servidor.'
      : 'Vendas temporariamente suspensas. Quem já pagou mantém o acesso até o fim do período contratado.';
    PLAN_IDS.forEach(function (id) {
      var p = PUBLIC_PLANS[id];
      if (!p) return;
      var title = String(p.label || id);
      var price = priceText(p.price_cents);
      PLANS[id] = { title: title, price: price, cta: "Comprar " + title + " · " + price, sub: planSummary(id) };
    });
    planCatalogReady = PLAN_IDS.length > 0 && PLAN_IDS.every(function (id) { return !!PUBLIC_PLANS[id] && !!PLANS[id]; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), function (button) {
      var id = button.getAttribute("data-pay");
      var p = PUBLIC_PLANS[id];
      if (!p) { button.disabled = true; button.textContent = 'Plano indisponível'; return; }
      button.disabled = !salesEnabled;
      var size = p.max_file_mb === null ? "sem limite comercial de tamanho" : (p.max_file_mb + " MB por mundo");
      var batch = "até " + (p.max_batch || 1) + " mundo(s) por lote";
      var card = button.closest ? button.closest(".plan") : null;
      if (card) {
        card.classList.toggle('plan-featured', p.featured === true);
        card.setAttribute('data-plan-kind', p.kind);
        var offer = card.querySelector('[data-plan-offer]');
        if (!offer) { offer = document.createElement('p'); offer.setAttribute('data-plan-offer', ''); offer.className = 'plan-offer'; card.insertBefore(offer, card.querySelector('ul')); }
        offer.hidden = p.kind !== 'time';
        offer.textContent = p.featured ? 'Recomendado para uso frequente' : p.fit || 'Escolha pelo seu volume de uso';
      }
      if (card && p.kind === "world_credit" && paymentProvider() === "kiwify") card.hidden = true;
      var title = card && card.querySelector("[data-plan-title]");
      if (title) title.textContent = String(p.label || id);
      var fit = card && card.querySelector("[data-plan-fit]");
      if (fit) fit.textContent = p.fit || "Escolha pelo tamanho do arquivo e volume de uso";
      var priceBox = card && card.querySelector(".price");
      var list = card && card.querySelector("ul");
      var creditPlan = p.kind === "world_credit";
      if (priceBox) priceBox.innerHTML = escH(planPrice(id)) + "<small> · " + escH(creditPlan ? (p.credit_count || 1) + " crédito(s)" : (p.duration_days || 0) + " dias") + "</small>";
      if (list) {
        var count = p.credit_count || 1;
        var bullets = creditPlan
          ? [count + " crédito(s) · " + size, (count > 1 ? "Cerca de " : "") + priceText(Math.round((+p.price_cents || 0) / count)) + " por mundo" + ((PUBLIC_PLANS.world1 && +PUBLIC_PLANS.world1.price_cents * count > +p.price_cents) ? " · economize " + priceText((+PUBLIC_PLANS.world1.price_cents * count) - (+p.price_cents || 0)) + " frente a " + count + " compras avulsas" : ""), "Editor e Builder · um mundo por vez · " + (window.RC_toolIntents.includesStudio(p) ? "World Studio incluído" : "World Studio não incluído"), "Créditos sem uso não expiram; reedite cada projeto reconhecido por " + (p.project_window_days || 30) + " dias após a última operação concluída"]
          : ["Acesso por " + (p.duration_days || 0) + " dias", (p.daily_operations ? p.daily_operations + " operações concluídas por dia (UTC)" : "Conforme o plano"), size, batch, window.RC_toolIntents.includesStudio(p) ? "World Studio: pintar e exportar mundos" : "Editor e Builder · World Studio não incluído"];
        list.innerHTML = bullets.map(function (item) { return "<li class='yes'>" + escH(item) + "</li>"; }).join("");
      }
      button.textContent = salesEnabled ? String(p.label || id) + " · " + planPrice(id) : "Vendas pausadas";
    });
    var creditGrid = document.querySelector(".credit-plans");
    var creditGroup = creditGrid && creditGrid.closest ? creditGrid.closest(".plan-group") : null;
    if (creditGroup) creditGroup.hidden = !creditGrid.querySelector(".plan:not([hidden])");
    var free = PUBLIC_PLANS.free;
    var freeCard = document.querySelector(".plan-free");
    if (free && freeCard) {
      var freeDescription = freeCard.querySelector("p");
      if (freeDescription) freeDescription.textContent = "Até " + free.max_file_mb + " MB · análise local · funções básicas com limites diários";
      var freeItems = freeCard.querySelectorAll("ul li");
      if (freeItems[0]) freeItems[0].innerHTML = "Até <b>" + (+free.max_file_mb) + " MB</b> por mundo e " + (+((free.capabilities && free.capabilities.convert && free.capabilities.convert.daily_operations) || 0)) + " operações/dia";
    }
    var overview = document.querySelector(".plans-sub");
    if (overview) overview.textContent = "Edições pontuais, vários mundos ou criação frequente: escolha pelo resultado e pela capacidade. Pagamento único, sem renovação automática.";
    renderPlanComparison();
  }
  function renderPlanComparison() {
    var host = document.getElementById('planComparison');
    if (!host) return;
    var ids = PLAN_IDS.filter(function (id) { return !!PUBLIC_PLANS[id]; });
    var rows = [
      ['Pagamento único', function(p) { return priceText(p.price_cents); }],
      ['O que você compra', function(p) { return p.kind === 'world_credit' ? p.credit_count + ' mundo(s), um por vez' : 'Acesso por ' + p.duration_days + ' dias'; }],
      ['Tamanho por arquivo', function(p) { return p.max_file_mb === null ? 'Sem teto comercial¹' : 'Até ' + p.max_file_mb + ' MB'; }],
      ['Operações por dia (UTC)', function(p) { return p.daily_operations ? String(p.daily_operations) : 'Conforme oferta original'; }],
      ['Mundos por lote', function(p) { return String(p.max_batch); }],
      ['Editor e Builder', function(p) { return (p.allowed_tools || []).indexOf('builder') >= 0 ? 'Incluídos' : 'Confira as ferramentas do plano'; }],
      ['World Studio', function(p) { return window.RC_toolIntents.includesStudio(p) ? 'Incluído' : 'Não incluído'; }],
      ['Quando usar', function(p) { return p.kind === 'world_credit' ? 'Créditos sem uso não expiram; reedições por ' + p.project_window_days + ' dias após a última operação concluída' : 'Durante ' + p.duration_days + ' dias após a confirmação'; }]
    ];
    host.innerHTML = '<table><caption>Compare o que cada plano entrega</caption><thead><tr><th scope="col">Benefício</th>' + ids.map(function(id) { return '<th scope="col">' + escH(PUBLIC_PLANS[id].label) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function(row) { return '<tr><th scope="row">' + row[0] + '</th>' + ids.map(function(id) { return '<td>' + escH(row[1](PUBLIC_PLANS[id])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    var grid = document.querySelector('.wf-pricing');
    if (grid) {
      ['world_credit','time'].forEach(function(kind) {
        var heading = grid.querySelector('[data-plan-heading="' + kind + '"]');
        if (!heading) { heading = document.createElement('h3'); heading.setAttribute('data-plan-heading',kind); heading.className = 'plan-group-heading'; }
        heading.textContent = kind === 'world_credit' ? 'Créditos · para mundos individuais, no seu ritmo' : 'Passes · para editar e criar durante um período';
        var cards = Array.prototype.filter.call(grid.querySelectorAll('.wf-plan-slot'),function(card) { return !card.hidden && card.getAttribute('data-plan-kind') === kind; });
        heading.hidden = !cards.length;
        grid.appendChild(heading); cards.forEach(function(card) { grid.appendChild(card); });
      });
    }
    var goal = document.getElementById('planGoal');
    var advice = document.getElementById('planAdvice');
    if (!goal || !advice) return;
    function recommend() {
      var context = {goal:goal.value};
      var eligible = relevantPlanIds(context);
      var id = window.RC_toolIntents.choosePlan(eligible,'',PUBLIC_PLANS,context);
      var p = PUBLIC_PLANS[id];
      advice.textContent = p ? 'Para esse uso: ' + p.label + ' · ' + planPrice(id) + '. ' + planSummary(id) : 'Nenhum plano disponível atende a esse uso agora.';
      document.querySelectorAll('.wf-plan-slot').forEach(function(card) { var btn = card.querySelector('[data-pay]'); card.classList.toggle('plan-recommended',!!id && btn.getAttribute('data-pay') === id); });
    }
    goal.onchange = recommend;
    recommend();
  }
  function ensurePlanCatalog() {
    if (planCatalogReady) return Promise.resolve(PUBLIC_PLANS);
    if (planCatalogPending) return planCatalogPending;
    planCatalogPending = req("/api/config").then(function (config) { applyPlanCatalog(config); if (!planCatalogReady) throw new Error("Plan catalog response is incomplete."); return PUBLIC_PLANS; }).finally(function () { planCatalogPending = null; });
    return planCatalogPending;
  }
  function relevantPlanIds(context) {
    var ids = paymentProvider() === "kiwify" ? PLAN_IDS.filter(function (id) { return !(PUBLIC_PLANS[id] && PUBLIC_PLANS[id].kind === "world_credit"); }) : PLAN_IDS;
    return window.RC_toolIntents
      ? window.RC_toolIntents.eligiblePlanIds(ids, PUBLIC_PLANS, context || {})
      : ids.filter(function (id) { return !!PUBLIC_PLANS[id]; });
  }
  function renderPlanOptions(selectedPlan, context) {
    var eligible = relevantPlanIds(context);
    var selected = window.RC_toolIntents
      ? window.RC_toolIntents.choosePlan(eligible, selectedPlan, PUBLIC_PLANS, context)
      : (eligible.indexOf(selectedPlan) >= 0 ? selectedPlan : eligible[0]);
    return eligible.map(function (id) {
      var p = PUBLIC_PLANS[id];
      var size = p.max_file_mb === null ? "sem limite comercial" : (p.max_file_mb + " MB");
      var batch = p.kind === "world_credit" ? (p.credit_count || 1) + " crédito(s), sem validade" : (p.max_batch || 1) + " por lote";
      return "<label><input type='radio' name='payplan' value='" + escH(id) + "'" + (selected === id ? " checked" : "") + "><span class='plan-main'><strong>" + escH(p.label) + "</strong><b>" + escH(planPrice(id)) + "</b><small>" + escH(size + " · " + batch + (p.kind === "time" ? " · " + p.duration_days + " dias" : "") + " · " + (p.daily_operations ? p.daily_operations + " operações/dia · " : "") + (window.RC_toolIntents.includesStudio(p) ? "Studio incluído" : "Sem Studio")) + "</small>" + (id === 'worlds3plus' ? "<small class='plan-offer-inline'>" + escH(bundleDifference(id)) + " em relação a 1 mundo</small>" : "") + "</span></label>";
    }).join("");
  }
  function bundleDifference(id) {
    var p = PUBLIC_PLANS[id], single = PUBLIC_PLANS.world1;
    if (!p || !single) return '';
    return 'Mais ' + priceText(p.price_cents - single.price_cents) + ' para levar mais ' + (p.credit_count - single.credit_count) + ' mundos';
  }
  function normalizePlan(plan) { var alias = { worlds2: 'worlds3plus', worlds3: 'worlds5', ouro: 'worlds5', vip7: 'pro7', vip30: 'creator30', creator: 'creator30', worlds3v2: 'worlds5', pro7: 'vip7', creator30: 'creator' }; return PLANS[plan] ? plan : (PLANS[alias[plan]] ? alias[plan] : ''); }  /* ---------- Depix (Pix via Worker — segredos NUNCA no navegador) ---------- */
  function depixEnabled() {
    try {
      var cfg = window.RC_CONFIG || {};
      // InfinitePay is the active checkout when configured and sales are open.
      // Do not let the legacy DePix CPF/CNPJ validation intercept its flow.
      return !!(!infinitepayEnabled() && cfg.DEPIX_ENABLED && (paymentProvider() === "depix" || paymentProvider() === "hybrid") && base());
    } catch (e) { return false; }
  }
  function infinitepayEnabled() { return false; }
  function kiwifyEnabled() {
    try { return !!((window.RC_CONFIG || {}).KIWIFY_ENABLED && (paymentProvider() === "kiwify" || paymentProvider() === "hybrid")); } catch (e) { return false; }
  }
  function depixTestMode() {
    try { return !!(window.RC_CONFIG && window.RC_CONFIG.DEPIX_TEST_MODE); } catch (e) { return false; }
  }
  // CPF/CNPJ: o Depix (trilho Pix) exige documento REAL do pagador p/ gerar o QR.
  // Valida formato + dígito do CPF; CNPJ aceita 14 dígitos (validação leve).
  function cleanDoc(s) { return String(s || "").replace(/\D/g, ""); }
  function validEmail(s) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || "").trim().toLowerCase());
  }
  function validCPF(d) {
    d = cleanDoc(d);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    var i, s = 0;
    for (i = 0; i < 9; i++) s += (+d[i]) * (10 - i);
    var d1 = 11 - (s % 11); if (d1 >= 10) d1 = 0;
    if (d1 !== (+d[9])) return false;
    s = 0;
    for (i = 0; i < 10; i++) s += (+d[i]) * (11 - i);
    var d2 = 11 - (s % 11); if (d2 >= 10) d2 = 0;
    return d2 === (+d[10]);
  }
  function validDoc(s) {
    var d = cleanDoc(s);
    if (d.length === 11) return validCPF(d);
    if (d.length === 14 && !/^(\d)\1{13}$/.test(d)) return true; // CNPJ: formato OK (a receita valida no QR)
    return false;
  }
  var checkoutRequestId = "";
  function newRequestId() {
    try { return crypto.randomUUID(); } catch (e) { return String(Date.now()) + "-" + Math.random().toString(36).slice(2); }
  }
  function depixCreate(plan, doc, payerEmail, source) {
    if (!checkoutRequestId) checkoutRequestId = newRequestId();
    return authReq("/api/depix/create", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        plan: normalizePlan(plan),
        payer_tax_number: cleanDoc(doc),
        payer_email: String(payerEmail || "").trim().toLowerCase(),
        source: String(source || "").slice(0, 40),
        terms_accepted: true,
        terms_version: "2026-10-03-v4",
        request_id: checkoutRequestId
      })
    }).then(function (r) { return r; });
  }
  function depixStatus(id) {
    return authReq("/api/depix/status?id=" + encodeURIComponent(id));
  }
  function infinitepayCreate(plan, source) {
    if (!checkoutRequestId) checkoutRequestId = newRequestId();
    return authReq("/api/infinitepay/create", {
      method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ plan: normalizePlan(plan), source: String(source || "").slice(0, 40), terms_accepted: true, terms_version: "2026-10-03-v4", request_id: checkoutRequestId })
    });
  }
  function infinitepayStatus(params) {
    var query = new URLSearchParams({ order_nsu: params.order_nsu, transaction_nsu: params.transaction_nsu, slug: params.slug });
    return authReq("/api/infinitepay/status?" + query.toString());
  }
  function fetchEntitlementPayload() { return authReq("/api/entitlements"); }
  function entitlements() {
    if (!window.RC_entitlements || typeof window.RC_entitlements.refresh !== "function") return Promise.reject(new Error("O serviço de benefícios ainda está carregando. Tente novamente."));
    return window.RC_entitlements.refresh();
  }
  function freeQuota(consume) {
    var opts = { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ consume: consume === true }) };
    // Quota is keyed to the verified UID when logged in and to the edge IP
    // for guests. It is intentionally not read from localStorage.
    return currentUser() ? authReq("/api/free-quota", opts) : req("/api/free-quota", opts);
  }
  function authorizeOperation(worlds, sizeBytes, features, operationId, worldProjectId, worldFingerprint) {
    var opts = { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ worlds: worlds, size_bytes: sizeBytes, features: features || {}, operation_id: operationId || "", world_project_id: worldProjectId || "", world_fingerprint: worldFingerprint || "" }) };
    if(window.WF_operationRecovery)window.WF_operationRecovery.begin(operationId,currentUser());
    return currentUser() ? authReq("/api/entitlements/check", opts) : req("/api/entitlements/check", opts);
  }
  function consumeOperation(operationId, worlds) {
    return authReq("/api/entitlements/consume", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ operation_id: operationId, worlds: worlds }) }).then(function (r) {
      return r;
    });
  }
  function completeOperation(operationId, worldFingerprint) {
    var body = JSON.stringify({ operation_id: operationId, world_fingerprint: String(worldFingerprint || "") });
    function attempt(retries) {
      var opts = { method: "POST", headers: { "Content-Type": "text/plain" }, body: body };
      var request = currentUser() ? authReq("/api/entitlements/complete", opts) : req("/api/entitlements/complete", opts);
      return request.catch(function (error) {
        var networkFailure = error.code === "API_NETWORK_UNAVAILABLE" || !error.status && /failed to fetch|networkerror|load failed/i.test(String(error.message || error));
        if (retries <= 0 || !(networkFailure || error.status >= 500)) throw error;
        return new Promise(function (resolve) { setTimeout(resolve, retries === 2 ? 250 : 700); }).then(function () { return attempt(retries - 1); });
      });
    }
    // /complete is idempotent by operation_id, so retry only transient failures.
    return attempt(2).then(function(result){if(window.WF_operationRecovery)window.WF_operationRecovery.end(operationId);return result;});
  }
  function releaseOperation(operationId) {
    var opts = { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ operation_id: operationId }) };
    return (currentUser() ? authReq("/api/entitlements/release", opts) : req("/api/entitlements/release", opts)).then(function(result){if(window.WF_operationRecovery)window.WF_operationRecovery.end(operationId);return result;});
  }

  var PENDING_CHECKOUT_CONTEXT = "rc_pending_checkout_context";
  function storeCheckoutContext(plan, context) {
    var safe = { version: 1, created_at: Date.now(), plan: String(plan || ""), context: {} };
    context = context || {};
    if(window.WF_pending && context.preserve_context)window.WF_pending.capture(context.tool || 'upload');
    ["tool", "source"].forEach(function (key) { if (typeof context[key] === "string") safe.context[key] = context[key].slice(0, 40); });
    ["worlds", "world_size_mb", "world_size_bytes"].forEach(function (key) { if (Number.isFinite(+context[key])) safe.context[key] = +context[key]; });
    safe.context.preserve_context = context.preserve_context === true;
    try { sessionStorage.setItem(PENDING_CHECKOUT_CONTEXT, JSON.stringify(safe)); } catch (e) {}
  }
  function readCheckoutContext() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(PENDING_CHECKOUT_CONTEXT) || "null");
      if (!saved || saved.version !== 1 || Date.now() - +saved.created_at > 2 * 60 * 60 * 1000) return null;
      var plan = String(saved.plan || "");
      return PLAN_IDS.indexOf(plan) >= 0 ? { plan: plan, context: saved.context || {} } : null;
    } catch (e) { return null; }
  }
  function openContextCheckoutWindow(context) {
    if (!context || context.preserve_context !== true) return null;
    try {
      var popup = window.open("about:blank", "_blank");
      if (popup) { try { popup.opener = null; } catch (e) {} }
      return popup;
    } catch (e2) { return null; }
  }
  function preferSameTabCheckout() {
    try {
      return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches || window.navigator.standalone === true;
    } catch (e) { return true; }
  }
  function closeContextCheckoutWindow(popup) {
    try { if (popup && !popup.closed) popup.close(); } catch (e) {}
  }
  function signalContextCheckout(context) {
    if (!context || context.preserve_context !== true) return;
    try { window.dispatchEvent(new CustomEvent("rc-context-checkout-started", { detail: { tool: String(context.tool || "").slice(0, 40) } })); } catch (e) {}
  }

  function openPayModal(notice, plan, context) {
    if (!enabled()) return;
    if (!planCatalogReady) {
      if (!planModalWaiting) {
        planModalWaiting = true;
        ensurePlanCatalog().then(function () { planModalWaiting = false; openPayModal(notice, plan, context); }).catch(function () {
          planModalWaiting = false;
          alert("Não foi possível carregar os planos agora. Tente novamente em instantes.");
        });
      }
      return;
    }
    plan = normalizePlan(plan || "world1");
    if (!plan) return;
    context = context || {};
    var eligiblePlans = relevantPlanIds(context);
    if (!eligiblePlans.length) {
      alert("Nenhum produto atual atende ao tamanho ou à quantidade de mundos selecionada.");
      return;
    }
    if (window.RC_toolIntents) plan = window.RC_toolIntents.choosePlan(eligiblePlans, context.source === 'pricing_card' ? plan : '', PUBLIC_PLANS, context) || plan;
    checkoutRequestId = newRequestId();
    storeCheckoutContext(plan, context);
    track("plan_selected", Object.assign({ plan: plan }, context));
    track("checkout_opened", Object.assign({ plan: plan }, context));
    closePay();
    var user = currentUser();
    if (!user || !user.email) {
      try { localStorage.setItem("rc_pending_plan", plan); } catch (e) {}
      if (window.RC_auth) window.RC_auth.openModal();
      return;
    }
    var logged = user.email;
    var displayName = user.name || logged.split("@")[0];
    var avatar = user.photo || "";
    var bg = document.createElement("div");
    bg.className = "modal-bg open";
    bg.id = "payModal";
    bg.innerHTML =
      '<div class="modal pay-modal" role="dialog" aria-modal="true" aria-labelledby="payTitle">' +
      "<div class='pay-scroll'>" +
      "<div class='pay-head'>" +
        "<img class='pay-voxel' src='assets/checkout-voxel.png' alt='' aria-hidden='true'>" +
        "<div class='pay-head-copy'><span class='pay-kicker'>CHECKOUT SEGURO</span><h3 id='payTitle'></h3><p>Liberação automática após a confirmação.</p></div>" +
        "<div class='pay-account'>" +
          (avatar ? "<img class='pay-account-avatar' src='" + escH(avatar) + "' alt=''>" : "<div class='pay-account-avatar-fallback'>" + escH(displayName.charAt(0).toUpperCase()) + "</div>") +
          "<div class='pay-account-meta'><b>" + escH(displayName) + "</b><span>" + escH(logged) + "</span></div>" +
          "<span class='pay-account-badge'>Google</span>" +
        "</div>" +
      "</div>" +
      (notice ? "<div class='warn pay-notice'>" + escH(notice) + "</div>" : "") +
      (context.preserve_context ? "<div class='warn pay-notice'>Mantenha esta aba com o mundo aberto durante o pagamento. Se o checkout abrir em outra aba, volte aqui para continuar sem selecionar o mundo novamente.</div>" : "") +
      "<p><a href='suporte.html' target='_blank' rel='noopener'>Já pagou? Reclamar / Pedir reembolso</a> · <a href='minha-conta.html' target='_blank' rel='noopener'>Verificar acesso</a></p>" +
      "<div class='pay-intro'><span class='pay-method-pill' id='payMethodBadge'>PIX · DEPIX</span><p id='payIntroText'><b>Escolha o plano, confirme seus dados e pague.</b> O acesso cai na conta Google exibida acima.</p></div>" +
      "<div class='pay-section-label'>Escolha seu plano</div>" +
      "<div class='planpick pay-planpick' role='radiogroup' aria-label='Escolha o plano'></div>" +
      "<div class='pay-plan-summary' aria-live='polite'><div class='pay-plan-summary-top'><span>Seu pedido</span><strong id='payPlanPrice'></strong></div><b id='payPlanName'></b><p id='paySub'></p></div>" +
      "<p class='warn' id='payCapacity' role='status'>O limite em MB é do plano. A capacidade de processar depende do aparelho e do conteúdo do mundo. Selecione seu mundo antes de comprar para verificar a compatibilidade estimada. O mesmo plano pode ser usado em outro aparelho com a mesma conta Google.</p>" +
      "<div class='pay-section-label pay-data-label'>Dados para gerar o Pix</div>" +
      "<div class='pay-form-grid'>" +
        "<div class='pay-field pay-field-full'>" +
          "<label for='payDoc'>CPF ou CNPJ do pagador</label>" +
          "<input id='payDoc' inputmode='numeric' maxlength='18' autocomplete='off' placeholder='Documento do titular do Pix'>" +
          "<small class='pay-help'>O provedor Pix exige CPF/CNPJ para identificar o pagador. Use o documento do titular; para menores, o do responsável.</small>" +
        "</div>" +
        "<div class='pay-field'>" +
          "<label for='payPixEmail'>E-mail informado no pagamento</label>" +
          "<input id='payPixEmail' type='email' maxlength='120' autocomplete='email' value='" + escH(logged) + "' placeholder='seu@email.com'>" +
          "<small class='pay-help'>Enviaremos a identificação da cobrança para este e-mail.</small>" +
        "</div>" +
      "</div>" +
      "<label class='accept pay-terms' for='payTerms'>" +
        "<input id='payTerms' type='checkbox'>" +
        "<span>Li e aceito os <a href='termos.html' target='_blank' rel='noopener'>Termos</a>, <a href='reembolso.html' target='_blank' rel='noopener'>Reembolso</a> e <a href='privacidade.html' target='_blank' rel='noopener'>Privacidade</a>. Confirmo os dados da compra.</span>" +
      "</label>" +
      "</div>" +
      "<div class='pay-footer'>" +
        "<div class='status' id='payMsg' hidden></div>" +
        "<div class='pay-next-step' id='payNextStep'>Você será levado à AbacatePay para pagar com Pix.</div>" +
        "<div class='secure' id='payConn'>Conexão com AbacatePay: verificando…</div>" +
        "<div class='row2 pay-actions'>" +
          "<button class='btn-ghost' id='payBack' type='button'>Voltar</button>" +
          "<button class='btn-ghost pay-primary' id='payGo' type='button'></button>" +
        "</div>" +
      "</div>" +
      "</div>";
    payReturnFocus = document.activeElement;
    document.body.appendChild(bg);
    if (infinitepayEnabled() || paymentProvider() === "abacate") {
      var fields = bg.querySelector(".pay-form-grid");
      if (fields) fields.hidden = true;
      var dataLabel = bg.querySelector(".pay-data-label");
      if (dataLabel) dataLabel.hidden = true;
      var badge = bg.querySelector("#payMethodBadge");
      if (badge) badge.textContent = "CHECKOUT · ABACATEPAY";
      var intro = bg.querySelector("#payIntroText");
      if (intro) intro.textContent = "Compra única, sem renovação automática. O acesso será vinculado à conta Google exibida acima.";
      var next = bg.querySelector("#payNextStep");
      if (next) next.textContent = "Próxima etapa: abrir o checkout seguro da AbacatePay para pagar com Pix.";
      var conn = bg.querySelector("#payConn");
      if (conn) conn.textContent = "AbacatePay · Pix";
    }
    bg.addEventListener('keydown', function(e) {
      if (e.key !== 'Tab') return;
      var items = Array.from(bg.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')).filter(function(el) { return el.getClientRects().length; });
      if (!items.length) return;
      var first = items[0], last = items[items.length-1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.setTimeout(function() { var field = bg.querySelector((infinitepayEnabled() || paymentProvider() === "abacate") ? '#payGo' : '#payDoc'); if(field) field.focus(); }, 0);
    if (kiwifyEnabled()) {
      var pixFields = bg.querySelector(".pay-form-grid");
      if (pixFields) pixFields.hidden = true;
      var dataLabel = bg.querySelector(".pay-data-label");
      if (dataLabel) dataLabel.hidden = true;
      var assurance = bg.querySelector(".vip-assurance");
      if (assurance) assurance.innerHTML = "<b>Importante</b> Use exatamente este e-mail Google (" + escH(logged) + ") no checkout da Kiwify para vincular o VIP a sua conta.";
      var payNote = bg.querySelector(".pay-mini-note");
      if (payNote) payNote.innerHTML = "O checkout Kiwify abrirá em seguida. Use nele o <b>mesmo e-mail da conta Google</b> para os benefícios caírem na conta correta.";
      var payBadge = bg.querySelector("#payMethodBadge");
      if (payBadge) payBadge.textContent = "CHECKOUT · KIWIFY";
      var payIntro = bg.querySelector("#payIntroText");
      if (payIntro) payIntro.textContent = "Confira o plano e os dados da sua conta. Ao continuar, você vai para o checkout da Kiwify.";
      var payNextStep = bg.querySelector("#payNextStep");
      if (payNextStep) payNextStep.textContent = "Próxima etapa: abrir o checkout Kiwify para concluir a compra.";
      var payConn = bg.querySelector("#payConn");
      if (payConn) payConn.textContent = "Checkout Kiwify configurado";
    }
    var planPick = bg.querySelector(".planpick");
    if (planPick) planPick.innerHTML = renderPlanOptions(plan, context);
    var requested = bg.querySelector("input[value='" + plan + "']");
    if (requested) requested.checked = true;
    function selPlan() {
      var r = bg.querySelector("input[name='payplan']:checked");
      return r ? normalizePlan(r.value) : normalizePlan(plan);
    }
    var lastSelectedPlan = normalizePlan(plan);
    function checkoutCta(planId) {
      var p = PLANS[normalizePlan(planId)];
      return paymentProvider() === "kiwify" ? p.cta : "Continuar por " + p.price;
    }
    function paintPlan() {
      var p = PLANS[selPlan()];
      document.getElementById("payTitle").textContent = "Finalize sua compra";
      document.getElementById("payPlanName").textContent = p.title;
      document.getElementById("payPlanPrice").textContent = p.price;
      document.getElementById("paySub").textContent = p.sub;
      document.getElementById("payGo").textContent = checkoutCta(selPlan());
    }
    Array.prototype.forEach.call(bg.querySelectorAll("input[name='payplan']"), function (r) {
      r.addEventListener("change", function () {
        var nextPlan = normalizePlan(r.value);
        if (nextPlan !== lastSelectedPlan) {
          checkoutRequestId = newRequestId();
          lastSelectedPlan = nextPlan;
        }
        paintPlan();
        track("plan_selected", { plan: nextPlan });
      });
    });
    paintPlan();
    bg.addEventListener("click", function (e) { if (e.target === bg) closePay(); });
    // self-test: mostra na hora se o servidor de pagamento responde
    try {
      fetch(base() + "/api/config").then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      }).then(function (cfg) {
        var c = document.getElementById("payConn");
        if (c) c.textContent = (cfg.abacate_configured && cfg.sales_enabled)
          ? "AbacatePay · Pix · vendas ativas"
          : (paymentProvider() === "kiwify" ? "Checkout Kiwify configurado" : (cfg.depix_configured ? "✓ Pix disponível via Depix" : "Serviço de pagamento disponível"));
      }).catch(function (err) {
        logClient("selftest", (err && err.message) || err);
        var c = document.getElementById("payConn");
        if (c) c.textContent = "⚠ Sem conexão com o pagamento agora — confira sua internet antes de continuar.";
      });
    } catch (e) {}
    // trava anti-compra-dupla: e-mail que já tem VIP ativo não gera cobrança
    var vipLockUntil = 0, vipOverride = false;
    function showActiveBenefits(ent) {
      vipLockUntil = Date.now() + 60000;
      var text = "Esta conta já tem " + String(ent.plan_label || ent.plan || "benefícios ativos");
      if (ent.expires_at) text += " até " + new Date(ent.expires_at).toLocaleDateString("pt-BR");
      if (+ent.world_credits > 0) text += " e " + (+ent.world_credits) + " crédito(s) de mundo";
      var m = document.getElementById("payMsg");
      if (m) { m.hidden = false; m.className = "status ok"; m.textContent = text + ". A compra adicional é opcional."; }
      var go = document.getElementById("payGo");
      if (go) { go.disabled = false; go.textContent = "Confirmar compra adicional"; }
    }
    function refreshVipLock() {
      if (!document.getElementById("payModal")) return;
      entitlements().then(function (ent) {
        if (ent.active && document.getElementById("payModal") && !vipLockUntil) showActiveBenefits(ent);
      }).catch(function () {});
    }
    refreshVipLock();
    document.getElementById("payBack").addEventListener("click", closePay);
    var checkoutInFlight = false, capacityPending=false,capacityError=null,checkedFiles=[],capacitySeq=0;
    function selectedCapacityFiles(){return window.WF_zip?window.WF_zip.currentFiles():[];}
    function checkCapacity(){var myCapacity=++capacitySeq;checkedFiles=selectedCapacityFiles();capacityError=null;capacityPending=false;if(!checkedFiles.length||!window.WF_zip)return;capacityPending=true;bg.querySelector("#payCapacity").textContent="Verificando o mundo neste aparelho antes da compra…";window.WF_zip.preflight(checkedFiles,/builder|chunks|jogador|player|inventario/i.test(context.tool||location.pathname)).then(function(results){if(myCapacity!==capacitySeq)return;capacityPending=false;if(!bg.isConnected)return;bg.querySelector("#payCapacity").textContent=results.some(function(c){return !c.mapAllowed;})?"Modo leve para conquistas, nome e regras. Este mundo é pesado para mapa, chunks e jogador neste aparelho. Comprar um plano maior não aumenta a memória do celular. Use essas ferramentas em outro aparelho com a mesma conta.":"Verificação inicial concluída. O mundo será processado no aparelho; isso não garante memória suficiente em todas as etapas. Feche outras abas. Se precisar de outro aparelho, entre na mesma conta: não é necessário comprar outro plano.";},function(e){if(myCapacity!==capacitySeq)return;capacityPending=false;capacityError=e;bg.querySelector("#payCapacity").textContent=e.message;});}
    checkCapacity();
    document.getElementById("payGo").addEventListener("click", function () {
      var go = document.getElementById("payGo");
      if (checkoutInFlight || (go && go.disabled)) return;
      var nowFiles=selectedCapacityFiles();if(nowFiles.length!==checkedFiles.length||nowFiles.some(function(f,i){return f!==checkedFiles[i];}))checkCapacity();
      if(capacityPending){payStatus("Aguarde a verificação do mundo antes de comprar.","err");return;}
      if(capacityError){payStatus(capacityError.message,"err");return;}
      var email = currentEmail();
      if (!currentUser()) {
        closePay();
        if (window.RC_auth) window.RC_auth.openModal();
        return;
      }
      var selectedPlan = selPlan();
      if (paymentProvider() === "kiwify" && kiwifyEnabled()) {
        var kwUrl = kiwifyUrl(selectedPlan);
        if (!kwUrl) {
          payStatus("Este plano Kiwify está temporariamente indisponível.", "err");
          return;
        }
        if (!document.getElementById("payTerms").checked) {
          track("checkout_validation_failed", { plan: selectedPlan, reason: "terms" });
          payStatus("Para continuar, leia e aceite os Termos de Uso, a Política de Reembolso e a Política de Privacidade.", "err");
          return;
        }
        track("kiwify_checkout_redirect", Object.assign({ plan: selectedPlan }, context));
        go.disabled = true;
        go.textContent = "Abrindo Kiwify…";
        var kwWindow = openContextCheckoutWindow(context);
        if (kwWindow) {
          try { kwWindow.location.href = kwUrl; } catch (e) { closeContextCheckoutWindow(kwWindow); location.href = kwUrl; }
          signalContextCheckout(context);
          closePay();
        } else {
          signalContextCheckout(context);
          location.href = kwUrl;
        }
        return;
      }
      var pixEmail = String((document.getElementById("payPixEmail") || {}).value || "").trim().toLowerCase();
      if (depixEnabled() && !validEmail(pixEmail)) {
        track("checkout_validation_failed", { plan: selPlan(), reason: "email" });
        payStatus("Preencha um e-mail válido para o Pix.", "err");
        return;
      }
      if (!document.getElementById("payTerms").checked) {
        track("checkout_validation_failed", { plan: selPlan(), reason: "terms" });
        payStatus("Para continuar, leia e aceite os Termos de Uso, a Política de Reembolso e a Política de Privacidade.", "err");
        return;
      }
      // já é VIP? redireciona em vez de cobrar de novo (trava final)
      if (vipLockUntil > Date.now() && !vipOverride) { vipOverride = true; vipLockUntil = 0; payStatus("Você já tem benefícios ativos. Ao confirmar, créditos serão adicionados ao saldo ou o passe começará após o período atual.", "ok"); go.textContent = "Confirmar compra adicional"; return; }
      var contextCheckoutWindow = null;
      if (depixEnabled()) {
        var currentDoc = String((document.getElementById("payDoc") || {}).value || "");
        if (!validDoc(currentDoc)) {
          track("checkout_validation_failed", { plan: selPlan(), reason: "document" });
          payStatus("Informe um CPF/CNPJ válido p/ gerar o Pix.", "err");
          return;
        }
      }
      // Mobile browsers and in-app webviews often discard a blank tab opened
      // before an async Pix response. Return to the provider in this tab there;
      // the selected world/settings were saved before checkout and can resume.
      if ((selectedPlan !== "vip7" || depixEnabled()) && !preferSameTabCheckout()) contextCheckoutWindow = openContextCheckoutWindow(context);
      checkoutInFlight = true;
      go.disabled = true; go.textContent = "Verificando…";
      var buyerName = "";
      try {
        var u0 = window.RC_auth && window.RC_auth.user();
        if (u0 && u0.name) buyerName = u0.name;
      } catch (e0) {}
      function resumeExistingCheckout(err, selectedPlan) {
        var existing = err && err.status === 409 && err.payload && err.payload.existing_checkout;
        var existingUrl = "";
        try {
          var parsed = new URL(String(existing && existing.url || ""));
          if (parsed.protocol === "https:") existingUrl = parsed.href;
        } catch (e) {}
        if (!existingUrl) return false;
        var existingPlan = normalizePlan(existing.plan) || selectedPlan;
        var existingProvider = String(existing.provider || "");
        try {
          if (existingProvider === "infinitepay") sessionStorage.setItem("rc_pending_infinitepay", JSON.stringify({ order_nsu: existing.id, plan: existingPlan, created_at: Date.now() }));
          if (existingProvider === "depix") localStorage.setItem("rc_pending_depix", existing.id || "");
          if (existingProvider === "depix" || existingProvider === "abacate") localStorage.setItem("rc_pending_billing", existing.id || "");
        } catch (e) {}
        checkoutInFlight = true;
        payStatus("Reabrindo o checkout que já estava disponível…");
        signalContextCheckout(context);
        if (contextCheckoutWindow) {
          try { contextCheckoutWindow.location.href = existingUrl; closePay(); return true; }
          catch (e) { closeContextCheckoutWindow(contextCheckoutWindow); }
        }
        location.assign(existingUrl);
        return true;
      }
      entitlements().then(function (ent) {
        if (ent.active && document.getElementById("payModal") && !vipOverride) { checkoutInFlight = false; closeContextCheckoutWindow(contextCheckoutWindow); showActiveBenefits(ent); return; }
        if (ent.pending_payment) {
          if (ent.pending_payment.checkout_url && resumeExistingCheckout({
            status: 409,
            payload: { existing_checkout: {
              id: ent.pending_payment.id || "",
              url: ent.pending_payment.checkout_url,
              plan: ent.pending_payment.plan || selPlan(),
              provider: ent.pending_payment.provider || ""
            } }
          }, selPlan())) return;
          checkoutInFlight = false;
          closeContextCheckoutWindow(contextCheckoutWindow);
          go.disabled = false;
          go.textContent = checkoutCta(selPlan());
          payStatus(window.RC_entitlements.messageForPending(ent.pending_payment) + " Nenhuma nova cobrança foi criada.", "err");
          var pendingMessage = document.getElementById("payMsg");
          if (pendingMessage && /^https:\/\//i.test(String(ent.pending_payment.checkout_url || ""))) {
            pendingMessage.appendChild(document.createElement("br"));
            var pendingLink = document.createElement("a");
            pendingLink.href = ent.pending_payment.checkout_url;
            pendingLink.target = "_blank";
            pendingLink.rel = "noopener noreferrer";
            pendingLink.textContent = "Abrir checkout existente";
            pendingMessage.appendChild(pendingLink);
          }
          return;
        }
        attempt(1);
      }).catch(function (verifyError) {
        closeContextCheckoutWindow(contextCheckoutWindow);
        checkoutInFlight = false;
        go.disabled = false;
        go.textContent = checkoutCta(selPlan());
        var verifyMessage = window.RC_entitlements && window.RC_entitlements.messageForError
          ? window.RC_entitlements.messageForError(verifyError)
          : "Não foi possível verificar os benefícios desta conta. Atualize a conta e tente novamente.";
        payStatus(verifyMessage + " Nenhuma nova cobrança foi criada.", "err");
      });
      function attempt(n) {
        var name = buyerName;
        go.disabled = true; go.textContent = "Gerando cobrança…";
        payStatus(n > 1 ? "Tentando de novo (tentativa " + n + ")…" : (infinitepayEnabled() ? "Preparando checkout seguro da InfinitePay…" : (depixEnabled() ? "Criando sua cobrança Pix no Depix…" : "Preparando seu checkout…")));
        var planEl = document.querySelector("#payModal input[name='payplan']:checked");
        var plan = normalizePlan(planEl && planEl.value);
        if (infinitepayEnabled()) {
          track("checkout_opened", Object.assign({ plan: plan, provider: "infinitepay" }, context));
          infinitepayCreate(plan, context.source).then(function (r) {
            if (!/^https:\/\/(?:checkout\.infinitepay\.com\.br|checkout\.infinitepay\.io)\//i.test(String(r.url || ""))) throw new Error("Resposta inválida do checkout InfinitePay.");
            try { sessionStorage.setItem("rc_pending_infinitepay", JSON.stringify({ order_nsu: r.id, plan: plan, created_at: Date.now() })); } catch (e) {}
            payStatus("Abrindo o checkout da InfinitePay…");
            signalContextCheckout(context);
            if (contextCheckoutWindow) {
              try { contextCheckoutWindow.location.href = r.url; }
              catch (e) { closeContextCheckoutWindow(contextCheckoutWindow); location.href = r.url; return; }
              closePay();
            } else location.assign(r.url);
          }).catch(function (err) {
            if (resumeExistingCheckout(err, plan)) return;
            closeContextCheckoutWindow(contextCheckoutWindow);
            checkoutInFlight = false;
            track("pix_create_error", { plan: plan, error_type: classifyError(err), provider: "infinitepay" });
            logClient("infinitepay-create", (err && err.message) || err);
            go.disabled = false;
            go.textContent = checkoutCta(plan);
            payStatus(friendlyErr(err), "err");
          });
          return;
        }
        // Depix primeiro (Pix via Worker); AbacatePay como reserva.
        if (depixEnabled()) {
          var docEl = document.getElementById("payDoc");
          var doc = docEl ? docEl.value : "";
          track("pix_create_clicked", Object.assign({ plan: plan }, context));
          depixCreate(plan, doc, pixEmail, context.source).then(function (r) {
            var url = r.url || r.payment_url;
            if (!url) throw new Error("Resposta sem link de pagamento.");
            try { localStorage.setItem("rc_pending_depix", r.id || ""); } catch (e) {}
            try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e2) {}
            track("pix_checkout_redirect", Object.assign({ plan: plan }, context));
            payStatus("Abrindo o checkout Pix da Depix…");
            if (contextCheckoutWindow) {
              try { contextCheckoutWindow.location.href = url; }
              catch (e) { closeContextCheckoutWindow(contextCheckoutWindow); signalContextCheckout(context); location.href = url; return; }
              signalContextCheckout(context);
              closePay();
            } else {
              signalContextCheckout(context);
              location.assign(url);
            }
          }).catch(function (err) {
            if (resumeExistingCheckout(err, plan)) return;
            closeContextCheckoutWindow(contextCheckoutWindow);
            checkoutInFlight = false;
            track("pix_create_error", { plan: plan, error_type: classifyError(err) });
            logClient("depix-create", (err && err.message) || err);
            go.disabled = false;
            go.textContent = checkoutCta(plan);
            payStatus(friendlyErr(err), "err");
          });
          return;
        }
        // Reserva: AbacatePay (quando Depix desligado).
        // O plano de 7 dias usa preço dinâmico no Depix; não convertemos
        // silenciosamente para 30 dias em outro provedor.
        if (paymentProvider() !== "abacate" && plan === "vip7") {
          closeContextCheckoutWindow(contextCheckoutWindow);
          go.disabled = false;
          go.textContent = checkoutCta(plan);
          payStatus("O plano de 7 dias está disponível somente no Pix no momento. Escolha 24h ou 30 dias para usar outra forma de pagamento.", "err");
          return;
        }
        authReq("/api/abacate/create", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            plan: plan,
            request_id: checkoutRequestId,
            source: String(context.source || "").slice(0, 40),
            terms_accepted: true,
            terms_version: "2026-10-03-v4"
          })
        }).then(function (r) {
          if (!/^https:\/\/(?:app\.)?abacatepay\.com\//i.test(String(r.url || ""))) throw new Error("Checkout AbacatePay inválido.");
          try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e) {}
          payStatus("Abrindo a AbacatePay…");
          if (contextCheckoutWindow) {
            try { contextCheckoutWindow.location.href = r.url; }
            catch (e) { closeContextCheckoutWindow(contextCheckoutWindow); signalContextCheckout(context); location.href = r.url; return; }
            signalContextCheckout(context);
            closePay();
          } else {
            signalContextCheckout(context);
              location.assign(r.url);
          }
        }).catch(function (err) {
          if (resumeExistingCheckout(err, plan)) return;
          closeContextCheckoutWindow(contextCheckoutWindow);
          checkoutInFlight = false;
          logClient("create-alt", (err && err.message) || err);
          go.disabled = false;
          go.textContent = checkoutCta(plan);
          payStatus(friendlyErr(err), "err");
        });
      }
    });
  }

  // sucesso.html?id=BILLING_ID ou ?checkout_id=chk_... (volta do checkout) — mostra pagou/não-pagou.
  function checkReturn() {
    var box = document.getElementById("box");
    var id = "";
    var depixId = "";
    var infinitePayParams = null;
    try {
      var qs = new URLSearchParams(location.search);
      id = qs.get("id") || "";
      depixId = qs.get("checkout_id") || qs.get("checkoutId") || "";
      var orderNsu = qs.get("order_nsu") || "";
      var transactionNsu = qs.get("transaction_nsu") || "";
      var slug = qs.get("slug") || qs.get("invoice_slug") || "";
      if (orderNsu && transactionNsu && slug) infinitePayParams = { order_nsu: orderNsu, transaction_nsu: transactionNsu, slug: slug };
    } catch (e) {}
    if (infinitePayParams) {
      if (box) { box.hidden = false; box.className = "status"; box.textContent = "Confirmando pagamento com a InfinitePay…"; }
      return infinitepayStatus(infinitePayParams).then(function (r) {
        if (r.paid && window.RC_analytics) window.RC_analytics.purchase(r);
        if (r.paid) {
          try { sessionStorage.removeItem("rc_pending_infinitepay"); sessionStorage.removeItem(PENDING_CHECKOUT_CONTEXT); } catch (e) {}
          var untilTxt = +r.world_credits > 0 ? (+r.world_credits) + " crédito(s) de mundo disponíveis" : "acesso liberado";
          if (box) { box.className = "status ok"; box.textContent = "Pagamento InfinitePay confirmado; " + untilTxt + ". Volte à ferramenta para continuar."; }
          try { document.dispatchEvent(new Event("rc-auth")); } catch (e2) {}
        } else {
          trackPaymentState(r);
          if (box) { box.className = "status"; box.textContent = "Pagamento ainda em confirmação pela InfinitePay. Aguarde um minuto e atualize esta página; não faça outra compra."; }
        }
        return r;
      }).catch(function () {
        if (box) { box.className = "status"; box.textContent = "A InfinitePay ainda está confirmando. Aguarde e atualize; se já pagou, não faça outra compra."; }
        return null;
      });
    }
    if (depixId && !/^chk_/.test(depixId) && paymentProvider() === "abacate") { id = id || depixId; depixId = ""; }
    if (!depixId) {
      try { depixId = localStorage.getItem("rc_pending_depix") || ""; } catch (e2) {}
    }
    if (!id && paymentProvider() === "abacate") { try { id = localStorage.getItem("rc_pending_billing") || ""; } catch (e) {} }
    if (!id) {
      try { id = localStorage.getItem("rc_pending_billing") || ""; } catch (e3) {}
    }
    // Depix primeiro: id chk_... ou pendência depix salva.
    var useDepix = /^chk_/.test(id) || (!id && /^chk_/.test(depixId));
    if (useDepix) {
      var did = /^chk_/.test(depixId) ? depixId : (/^chk_/.test(id) ? id : (depixId || id));
      if (box) { box.hidden = false; box.className = "status"; box.textContent = "Confirmando Pix (Depix)…"; }
      return depixStatus(did).then(function (r) {
        if (r.paid && window.RC_analytics) window.RC_analytics.purchase(r);
        if (box) {
          if (r.paid) {
            try {
              localStorage.removeItem("rc_pending_depix");
              localStorage.removeItem("rc_pending_billing");
            } catch (e) {}
            try { sessionStorage.removeItem(PENDING_CHECKOUT_CONTEXT); } catch (e3) {}
            var untilTxt = +r.world_credits > 0
              ? (+r.world_credits) + " crédito(s) de mundo disponíveis"
              : (+r.premium_until_ms > Date.now()
              ? "VIP liberado até <b>" + new Date(+r.premium_until_ms).toLocaleDateString("pt-BR") + "</b>"
              : "VIP liberado");
            box.className = "status ok";
            box.innerHTML = "Pix confirmado. " + untilTxt + ". <a href='index.html#converter'><b>Ir converter</b></a>";
          } else {
            trackPaymentState(r);
            box.className = "status";
            box.textContent = "Pix ainda não confirmado (" + (r.status || "?") + "). Se já pagou, aguarde 1 min e recarregue.";
          }
        }
        try { document.dispatchEvent(new Event("rc-auth")); } catch (e) {}
        return r;
      }).catch(function (err) {
        if (box) { box.className = "status err"; box.textContent = friendlyErr(err); }
        return null;
      });
    }
    if (!id || !enabled()) return Promise.resolve(null);
    if (box) { box.hidden = false; box.className = "status"; box.textContent = "Confirmando pagamento…"; }
    return authReq("/api/abacate/status?id=" + encodeURIComponent(id)).then(function (r) {
      if (r.paid && window.RC_analytics) window.RC_analytics.purchase(r);
      if (box) {
        if (r.paid) {
          // libera na hora NESTE navegador (vale p/ quem pagou sem login também)
          try {
            localStorage.removeItem("rc_pending_billing");
          } catch (e) {}
          try { sessionStorage.removeItem(PENDING_CHECKOUT_CONTEXT); } catch (e3) {}
          var untilTxt = +r.world_credits > 0
            ? "1 crédito de mundo liberado"
            : (+r.premium_until_ms > Date.now()
            ? "VIP liberado até <b>" + new Date(+r.premium_until_ms).toLocaleDateString("pt-BR") + "</b>"
            : "VIP liberado");
          box.className = "status ok";
          box.innerHTML = "Pagamento confirmado" + (r.email ? " em <b>" + r.email.replace(/[<>&\"']/g, "") + "</b>" : "") +
            ". " + untilTxt + ". <a href='index.html#converter'><b>Ir converter</b></a>";
        } else {
          trackPaymentState(r);
          box.className = "status";
          box.textContent = "Pagamento ainda não confirmado (" + (r.status || "?") + "). Se já pagou, aguarde 1 min e recarregue.";
        }
      }
      try { document.dispatchEvent(new Event("rc-auth")); } catch (e) {}
      return r;
    }).catch(function (err) {
      if (box) { box.className = "status err"; box.textContent = friendlyErr(err); }
      return null;
    });
  }

  function kiwifyUrl(plan) {
    if (!kiwifyEnabled()) return "";
    var cfg = window.RC_CONFIG || {};
    plan = normalizePlan(plan);
    var u = plan === "world1" ? (cfg.KIWIFY_URL_WORLD1 || "")
      : plan === "vip7" ? (cfg.KIWIFY_URL_7D || "")
      : plan === "creator" ? (cfg.KIWIFY_URL_CREATOR || "")
      : (cfg.KIWIFY_URL_30D || "");
    return /^https?:\/\//i.test(u) ? u : "";
  }

  // Entrada única de compra: autentica a conta e confirma o plano antes do checkout.
  // Backup Kiwify em site/backup-kiwify-2026-09-20/.
  function checkout(plan, notice, context) {
    if (!planCatalogReady) {
      if (!planModalWaiting) {
        planModalWaiting = true;
        ensurePlanCatalog().then(function () { planModalWaiting = false; checkout(plan, notice, context); }).catch(function () {
          planModalWaiting = false;
          alert("Não foi possível carregar os planos agora. Nenhuma cobrança foi criada.");
        });
      }
      return true;
    }
    if (!salesEnabled) {
      alert("As vendas estão temporariamente suspensas. Seu plano já pago continua ativo até a data de expiração.");
      return false;
    }
    plan = normalizePlan(plan);
    if (!plan) return false;
    if (!currentEmail()) {
      try { localStorage.setItem("rc_pending_plan", plan); } catch (e) {}
      storeCheckoutContext(plan, context || {});
      if (window.RC_auth) window.RC_auth.openModal();
      return true;
    }
    // Sempre passa pelo nosso modal antes de qualquer cobrança:
    // conta Google, resumo do plano e aceite explícito dos termos.
    if (!enabled()) return false;
    openPayModal(notice || null, plan, context || {});
    return true;
  }

  var wireInstalled = false;
  function wire() {
    if (wireInstalled) return;
    wireInstalled = true;
    Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), function (b) {
      var plan = String(b.getAttribute("data-pay") || "");
      if (!salesEnabled) { b.hidden = false; b.disabled = true; b.textContent = "Vendas pausadas"; return; }
      if (!depixEnabled() && !kiwifyUrl(plan) && !enabled()) { b.hidden = true; return; }
      b.hidden = false;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        var plan = String(b.getAttribute("data-pay") || "");
        plan = String(b.getAttribute("data-pay") || "");
        var source = b.getAttribute("data-source") || "pricing_card";
        track("buy_clicked", { plan: plan, price_cents: PUBLIC_PLANS[plan] ? +PUBLIC_PLANS[plan].price_cents : 0, source: source });
        checkout(plan, null, { source: source });
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePay();
    });
    document.addEventListener("rc-auth", function () {
      var em = currentEmail(), plan = "";
      try { plan = localStorage.getItem("rc_pending_plan") || ""; } catch (e) {}
      var pendingContext = plan ? readCheckoutContext() : null;
      if (pendingContext) plan = pendingContext.plan;
      var selectedPlan = normalizePlan(plan);
      if (!em || !selectedPlan) {
        if (plan) { try { localStorage.removeItem("rc_pending_plan"); } catch (e0) {} }
        return;
      }
      if (!salesEnabled) {
        try { localStorage.removeItem("rc_pending_plan"); } catch (e3) {}
        clearCheckoutResume();
        return;
      }
      try { localStorage.removeItem("rc_pending_plan"); } catch (e2) {}
      openPayModal(null, selectedPlan, pendingContext ? pendingContext.context : {});
    });
  }

  window.RC_pay = {
    enabled: enabled,
    paymentProvider: paymentProvider,
    depixEnabled: depixEnabled,
    kiwifyEnabled: kiwifyEnabled,
    depixCreate: depixCreate,
    depixStatus: depixStatus,
    validDoc: validDoc,
    openPayModal: openPayModal,
    checkout: checkout,
    kiwifyUrl: kiwifyUrl,
    checkReturn: checkReturn,
    track: track, entitlements: fetchEntitlementPayload, planCatalog: ensurePlanCatalog, freeQuota: freeQuota, authorizeOperation: authorizeOperation, consumeOperation: consumeOperation, completeOperation: completeOperation, releaseOperation: releaseOperation
  };
  function recoverInterrupted(){if(window.WF_operationRecovery)window.WF_operationRecovery.recover(currentUser(),releaseOperation).then(function(count){if(count&&window.RC_entitlements)window.RC_entitlements.refresh().catch(function(){});});}
  document.addEventListener('rc-auth',recoverInterrupted);window.addEventListener('online',recoverInterrupted);if(window.RC_auth&&window.RC_auth.onChange)window.RC_auth.onChange(recoverInterrupted);recoverInterrupted();
  try { document.dispatchEvent(new Event("rc-pay-ready")); } catch (e) {}
  ensurePlanCatalog().catch(function () {
    var notice = document.getElementById('catalogStatus');
    if (notice) notice.textContent = 'Não foi possível consultar os planos. Recarregue para tentar novamente; nenhuma cobrança foi criada.';
    var advice = document.getElementById('planAdvice');
    if (advice) advice.textContent = 'A orientação estará disponível quando os planos forem carregados.';
    document.querySelectorAll('.wf-plan-slot [data-pay]').forEach(function(b) { b.disabled = true; b.textContent = 'Preço indisponível'; });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
