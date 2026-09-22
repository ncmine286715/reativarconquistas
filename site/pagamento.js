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
    return p === "kiwify" || p === "hybrid" ? p : "depix";
  }

  function req(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    // O login atual é Firebase/Google. Não envie rc_token legado:
    // uma sessão antiga poderia associar a cobrança ao e-mail errado.
    return fetch(base() + path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) {}
        if (!res.ok) throw new Error((j && j.error) || ("Erro " + res.status));
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
    return (window.RC_auth && window.RC_auth.getToken ? window.RC_auth.getToken() : Promise.resolve("")).then(function (token) {
      if (!token) throw new Error("Entre novamente com sua conta Google para continuar.");
      opts.headers = opts.headers || {};
      opts.headers.Authorization = "Bearer " + token;
      return req(path, opts);
    });
  }

  var telemetryId = "";
  try {
    telemetryId = localStorage.getItem("rc_telemetry_id") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    localStorage.setItem("rc_telemetry_id", telemetryId);
  } catch (e) { telemetryId = "anonymous"; }
  function track(event, data) {
    try {
      var body = Object.assign({ event: String(event || "").slice(0, 40), session_id: telemetryId, page: location.pathname }, data || {});
      fetch(base() + "/api/telemetry", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) {}
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
    if (m) m.remove();
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

  var PLANS = {};
  function normalizePlan(plan) {
    return plan === "vip24h" || plan === "vip7" || plan === "vip30" ? plan : "vip30";
  }

  // Oferta comercial orientada ao problema, mantendo os ids antigos apenas
  // para compatibilidade com links e pagamentos já existentes.
  PLANS = {
    world1: { title: "Resolver 1 mundo", price: "R$ 5,99", cta: "Resolver meu mundo · R$ 5,99", sub: "Crédito para exatamente 1 mundo de até 150 MB. O benefício é consumido quando a operação premium termina com sucesso." },
    vip7: { title: "Passe 7 dias", price: "R$ 7,99", cta: "Liberar 7 dias por R$ 7,99", sub: "Até 500 MB, lotes de até 5 arquivos e ferramentas avançadas durante 7 dias." },
    vip30: { title: "Passe 30 dias", price: "R$ 24,90", cta: "Liberar 30 dias por R$ 24,90", sub: "Acesso recorrente por 30 dias, arquivos grandes, lotes de até 10 arquivos e ferramentas avançadas." },
    creator: { title: "Criador", price: "R$ 39,90", cta: "Liberar Criador · R$ 39,90 · 30 dias", sub: "Lotes maiores, addons e edição avançada para criadores e donos de Realms." }
  };
  function normalizePlan(plan) {
    return PLANS[plan] ? plan : (plan === "vip24h" ? "world1" : "vip30");
  }

  /* ---------- Depix (Pix via Worker — segredos NUNCA no navegador) ---------- */
  function depixEnabled() {
    try {
      var cfg = window.RC_CONFIG || {};
      return !!(cfg.DEPIX_ENABLED && (paymentProvider() === "depix" || paymentProvider() === "hybrid") && base());
    } catch (e) { return false; }
  }
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
  function depixCreate(plan, doc, payerEmail, source) {
    return authReq("/api/depix/create", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        plan: normalizePlan(plan),
        payer_tax_number: cleanDoc(doc),
        payer_email: String(payerEmail || "").trim().toLowerCase(),
        source: String(source || "").slice(0, 40),
        terms_accepted: true,
        terms_version: "2026-09-20-v1.6"
      })
    }).then(function (r) { return r; });
  }
  function depixStatus(id) {
    return authReq("/api/depix/status?id=" + encodeURIComponent(id));
  }
  function entitlements() { return authReq("/api/entitlements"); }
  function freeQuota(consume) {
    var opts = { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ consume: consume === true }) };
    // Quota is keyed to the verified UID when logged in and to the edge IP
    // for guests. It is intentionally not read from localStorage.
    return currentUser() ? authReq("/api/free-quota", opts) : req("/api/free-quota", opts);
  }
  function authorizeOperation(worlds, sizeBytes, features) {
    return authReq("/api/entitlements/check", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ worlds: worlds, size_bytes: sizeBytes, features: features || {} }) });
  }
  function consumeOperation(operationId, worlds) {
    return authReq("/api/entitlements/consume", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ operation_id: operationId, worlds: worlds }) }).then(function (r) {
      return r;
    });
  }

  function openPayModal(notice, plan, context) {
    if (!enabled()) return;
    plan = normalizePlan(plan);
    context = context || {};
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
        "<h3 id='payTitle'></h3>" +
        "<div class='pay-account'>" +
          (avatar ? "<img class='pay-account-avatar' src='" + escH(avatar) + "' alt=''>" : "<div class='pay-account-avatar-fallback'>" + escH(displayName.charAt(0).toUpperCase()) + "</div>") +
          "<div class='pay-account-meta'><b>" + escH(displayName) + "</b><span>" + escH(logged) + "</span></div>" +
          "<span class='pay-account-badge'>Google</span>" +
        "</div>" +
      "</div>" +
      (notice ? "<div class='warn pay-notice'>" + escH(notice) + "</div>" : "") +
      "<div class='pay-intro'><span class='pay-method-pill' id='payMethodBadge'>PIX · DEPIX</span><p id='payIntroText'>Escolha seu plano e confira os dados. Ao continuar, você vai gerar uma cobrança Pix no checkout.</p></div>" +
      "<div class='vip-assurance'><b>Onde o acesso será liberado?</b> Após a confirmação do pagamento, o benefício será vinculado à conta Google exibida acima.</div>" +
      "<div class='pay-section-label'>1. Escolha seu plano</div>" +
      "<div class='planpick pay-planpick' role='radiogroup' aria-label='Escolha o plano'>" +
        "<label><input type='radio' name='payplan' value='world1'" + (plan === "world1" ? " checked" : "") + "><span class='plan-main'><strong>1 mundo</strong><b>R$ 5,99</b><small>150 MB</small></span></label>" +
        "<label><input type='radio' name='payplan' value='vip7'" + (plan === "vip7" ? " checked" : "") + "><span class='plan-main'><strong>7 dias</strong><b>R$ 7,99</b><small>500 MB</small></span></label>" +
        "<label><input type='radio' name='payplan' value='vip30'" + (plan === "vip30" ? " checked" : "") + "><span class='plan-main'><strong>30 dias</strong><b>R$ 24,90</b><small>Sem limite comercial</small></span></label>" +
        "<label><input type='radio' name='payplan' value='creator'" + (plan === "creator" ? " checked" : "") + "><span class='plan-main'><strong>Criador</strong><b>R$ 39,90</b><small>Sem limite comercial</small></span></label>" +
      "</div>" +
      "<div class='pay-plan-summary' aria-live='polite'><div class='pay-plan-summary-top'><span>Seu pedido</span><strong id='payPlanPrice'></strong></div><b id='payPlanName'></b><p id='paySub'></p></div>" +
      "<div class='pay-section-label pay-data-label'>2. Dados para gerar o Pix</div>" +
      "<div class='pay-form-grid'>" +
        "<div class='pay-field pay-field-full'>" +
          "<label for='payDoc'>CPF ou CNPJ do pagador</label>" +
          "<input id='payDoc' inputmode='numeric' maxlength='18' autocomplete='off' placeholder='Documento do titular do Pix'>" +
          "<small class='pay-help'>O Depix pede o documento de quem vai pagar para criar a cobrança. Se o pagador for menor de 18 anos, use os dados do responsável.</small>" +
        "</div>" +
        "<div class='pay-field'>" +
          "<label for='payPixEmail'>E-mail informado no pagamento</label>" +
          "<input id='payPixEmail' type='email' maxlength='120' autocomplete='email' value='" + escH(logged) + "' placeholder='seu@email.com'>" +
          "<small class='pay-help'>Já preenchemos com seu e-mail Google. Você pode manter esse ou informar outro.</small>" +
        "</div>" +
      "</div>" +
      "<label class='accept pay-terms' for='payTerms'>" +
        "<input id='payTerms' type='checkbox'>" +
        "<span>Li e aceito os <a href='termos.html' target='_blank' rel='noopener'>Termos</a>, <a href='reembolso.html' target='_blank' rel='noopener'>Reembolso</a> e <a href='privacidade.html' target='_blank' rel='noopener'>Privacidade</a>. Confirmo os dados da compra.</span>" +
      "</label>" +
      "</div>" +
      "<div class='pay-footer'>" +
        "<div class='status' id='payMsg' hidden></div>" +
        "<div class='pay-next-step' id='payNextStep'>Próxima etapa: abrir o checkout Depix para pagar via Pix. Você ainda não pagou nesta tela.</div>" +
        "<div class='secure' id='payConn'>Conexão com Depix: verificando…</div>" +
        "<div class='row2 pay-actions'>" +
          "<button class='btn-ghost' id='payBack' type='button'>Voltar</button>" +
          "<button class='btn-ghost pay-primary' id='payGo' type='button'></button>" +
        "</div>" +
      "</div>" +
      "</div>";
    document.body.appendChild(bg);
    if (kiwifyEnabled()) {
      var pixFields = bg.querySelector(".pay-form-grid");
      if (pixFields) pixFields.hidden = true;
      var dataLabel = bg.querySelector(".pay-data-label");
      if (dataLabel) dataLabel.hidden = true;
      var assurance = bg.querySelector(".vip-assurance");
      if (assurance) assurance.innerHTML = "<b>Importante</b> Use exatamente este e-mail Google (" + escH(logged) + ") no checkout da Kiwify para vincular o VIP a sua conta.";
      var payNote = bg.querySelector(".pay-mini-note");
      if (payNote) payNote.innerHTML = "O checkout Kiwify abrirÃ¡ em seguida. Use nele o <b>mesmo e-mail da conta Google</b> para o VIP cair na conta correta.";
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
    if (planPick) planPick.innerHTML =
      "<label><input type='radio' name='payplan' value='world1'" + (plan === "world1" ? " checked" : "") + "><span class='plan-main'><strong>1 mundo</strong><b>R$ 5,99</b><small>150 MB</small></span></label>" +
      "<label><input type='radio' name='payplan' value='vip7'" + (plan === "vip7" ? " checked" : "") + "><span class='plan-main'><strong>7 dias</strong><b>R$ 7,99</b><small>500 MB</small></span></label>" +
      "<label><input type='radio' name='payplan' value='vip30'" + (plan === "vip30" ? " checked" : "") + "><span class='plan-main'><strong>30 dias</strong><b>R$ 24,90</b><small>Sem limite comercial</small></span></label>" +
      "<label><input type='radio' name='payplan' value='creator'" + (plan === "creator" ? " checked" : "") + "><span class='plan-main'><strong>Criador</strong><b>R$ 39,90</b><small>Sem limite comercial</small></span></label>";
    var requested = bg.querySelector("input[value='" + plan + "']");
    if (requested) requested.checked = true;
    function selPlan() {
      var r = bg.querySelector("input[name='payplan']:checked");
      return r ? normalizePlan(r.value) : "vip30";
    }
    function checkoutCta(planId) {
      var p = PLANS[normalizePlan(planId)];
      return paymentProvider() === "kiwify" ? p.cta : "Continuar para pagar no Pix · " + p.price;
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
      r.addEventListener("change", function () { paintPlan(); track("plan_viewed", { plan: normalizePlan(r.value) }); });
    });
    paintPlan();
    bg.addEventListener("click", function (e) { if (e.target === bg) closePay(); });
    // self-test: mostra na hora se o servidor de pagamento responde
    // e desliga o Passe 24h se o produto não estiver configurado lá
    try {
      fetch(base() + "/api/config").then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      }).then(function (cfg) {
        var c = document.getElementById("payConn");
        if (c) c.textContent = paymentProvider() === "kiwify"
          ? "Checkout Kiwify configurado"
          : (cfg.depix_configured ? "✓ Pix disponível via Depix" : "Serviço de pagamento disponível");
        if (cfg && cfg.product24h_configured === false) {
          var radio = bg.querySelector("input[name='payplan'][value='vip24h']");
          if (radio) {
            radio.checked = false;
            radio.disabled = true;
            var lb = radio.closest("label");
            if (lb) { lb.style.opacity = ".5"; lb.title = "Passe 24h indisponível no momento"; }
            var r30 = bg.querySelector("input[name='payplan'][value='vip30']");
            if (r30) r30.checked = true;
            paintPlan();
          }
        }
      }).catch(function (err) {
        logClient("selftest", (err && err.message) || err);
        var c = document.getElementById("payConn");
        if (c) c.textContent = "⚠ Sem conexão com o pagamento agora — confira sua internet antes de continuar.";
      });
    } catch (e) {}
    // trava anti-compra-dupla: e-mail que já tem VIP ativo não gera cobrança
    var vipLockUntil = 0, vipOverride = false;
    function showVipOwner(ms) {
      vipLockUntil = ms;
      var m = document.getElementById("payMsg");
      if (m) {
        m.hidden = false;
        m.className = "status ok";
        m.innerHTML = "Esta conta já tem <b>VIP até " + new Date(ms).toLocaleDateString("pt-BR") + "</b>. Você só precisa pagar novamente se quiser somar mais tempo.";
      }
      var go = document.getElementById("payGo");
      if (go) { go.disabled = false; go.textContent = "Comprar mais dias"; }
    }
    function refreshVipLock() {
      if (!document.getElementById("payModal")) return;
      remotePremiumMs().then(function (ms) {
        if (ms > Date.now() && document.getElementById("payModal") && !vipLockUntil) showVipOwner(ms);
      }).catch(function () {});
    }
    refreshVipLock();
    document.getElementById("payBack").addEventListener("click", closePay);
    document.getElementById("payGo").addEventListener("click", function () {
      var go = document.getElementById("payGo");
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
          payStatus("Este plano Kiwify estÃ¡ temporariamente indisponÃ­vel.", "err");
          return;
        }
        if (!document.getElementById("payTerms").checked) {
          track("checkout_validation_failed", { plan: selectedPlan, reason: "terms" });
          payStatus("Para continuar, leia e aceite os Termos de Uso, a PolÃ­tica de Reembolso e a PolÃ­tica de Privacidade.", "err");
          return;
        }
        try { localStorage.setItem("rc_pending_kiwify", JSON.stringify({ plan: selectedPlan, at: Date.now() })); } catch (e) {}
        track("kiwify_checkout_redirect", Object.assign({ plan: selectedPlan }, context));
        go.disabled = true;
        go.textContent = "Abrindo Kiwifyâ€¦";
        location.href = kwUrl;
        return;
      }
      var pixEmail = String((document.getElementById("payPixEmail") || {}).value || "").trim().toLowerCase();
      if (!validEmail(pixEmail)) {
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
      if (vipLockUntil > Date.now() && !vipOverride) { vipOverride = true; vipLockUntil = 0; payStatus("Você já tem VIP ativo. Se confirmar uma nova compra, o novo período será somado após a confirmação do pagamento.", "ok"); go.textContent = "Confirmar compra de mais dias"; return; }
      go.disabled = true; go.textContent = "Verificando…";
      var buyerName = "";
      try {
        var u0 = window.RC_auth && window.RC_auth.user();
        if (u0 && u0.name) buyerName = u0.name;
      } catch (e0) {}
      remotePremiumMs().then(function (ms) {
        if (ms > Date.now() && document.getElementById("payModal")) { showVipOwner(ms); return; }
        attempt(1);
      }).catch(function () {
        attempt(1);
      });
      function attempt(n) {
        var name = buyerName;
        go.disabled = true; go.textContent = "Gerando cobrança…";
        payStatus(n > 1 ? "Tentando de novo (tentativa " + n + ")…" : (depixEnabled() ? "Criando sua cobrança Pix no Depix…" : "Preparando seu checkout…"));
        var planEl = document.querySelector("#payModal input[name='payplan']:checked");
        var plan = normalizePlan(planEl && planEl.value);
        // Depix primeiro (Pix via Worker); AbacatePay como reserva.
        if (depixEnabled()) {
          var docEl = document.getElementById("payDoc");
          var doc = docEl ? docEl.value : "";
          if (!validDoc(doc)) { track("checkout_validation_failed", { plan: plan, reason: "document" }); go.disabled = false; go.textContent = checkoutCta(plan); payStatus("Informe um CPF/CNPJ válido p/ gerar o Pix.", "err"); return; }
          track("pix_create_clicked", Object.assign({ plan: plan }, context));
          depixCreate(plan, doc, pixEmail, context.source).then(function (r) {
            var url = r.url || r.payment_url;
            if (!url) throw new Error("Resposta sem link de pagamento.");
            try { localStorage.setItem("rc_pending_depix", r.id || ""); } catch (e) {}
            try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e2) {}
            track("pix_checkout_redirect", Object.assign({ plan: plan }, context));
            payStatus("Abrindo o checkout Pix da Depix…");
            location.href = url;
          }).catch(function (err) {
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
        if (plan === "vip7") {
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
            terms_accepted: true,
            terms_version: "2026-09-20-v1.6"
          })
        }).then(function (r) {
          if (!r.url) throw new Error("Resposta sem link de pagamento.");
          try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e) {}
          payStatus("Abrindo o checkout…");
          location.href = r.url;
        }).catch(function (err) {
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
    try {
      var qs = new URLSearchParams(location.search);
      id = qs.get("id") || "";
      depixId = qs.get("checkout_id") || qs.get("checkoutId") || "";
    } catch (e) {}
    if (!depixId) {
      try { depixId = localStorage.getItem("rc_pending_depix") || ""; } catch (e2) {}
    }
    if (!id) {
      try { id = localStorage.getItem("rc_pending_billing") || ""; } catch (e3) {}
    }
    // Depix primeiro: id chk_... ou pendência depix salva.
    var useDepix = !!(depixId && (!id || depixId === id || /^chk_/.test(depixId) || /^chk_/.test(id)));
    if (useDepix && depixEnabled()) {
      var did = /^chk_/.test(depixId) ? depixId : (/^chk_/.test(id) ? id : (depixId || id));
      if (box) { box.hidden = false; box.className = "status"; box.textContent = "Confirmando Pix (Depix)…"; }
      return depixStatus(did).then(function (r) {
        if (box) {
          if (r.paid) {
            try {
              localStorage.removeItem("rc_pending_depix");
              localStorage.removeItem("rc_pending_billing");
            } catch (e) {}
            var untilTxt = +r.world_credits > 0
              ? "1 crédito de mundo liberado"
              : (+r.premium_until_ms > Date.now()
              ? "VIP liberado até <b>" + new Date(+r.premium_until_ms).toLocaleDateString("pt-BR") + "</b>"
              : "VIP liberado");
            box.className = "status ok";
            box.innerHTML = "Pix confirmado. " + untilTxt + ". <a href='index.html#converter'><b>Ir converter</b></a>";
          } else {
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
      if (box) {
        if (r.paid) {
          // libera na hora NESTE navegador (vale p/ quem pagou sem login também)
          try {
            localStorage.removeItem("rc_pending_billing");
          } catch (e) {}
          var untilTxt = +r.world_credits > 0
            ? "1 crédito de mundo liberado"
            : (+r.premium_until_ms > Date.now()
            ? "VIP liberado até <b>" + new Date(+r.premium_until_ms).toLocaleDateString("pt-BR") + "</b>"
            : "VIP liberado");
          box.className = "status ok";
          box.innerHTML = "Pagamento confirmado" + (r.email ? " em <b>" + r.email.replace(/[<>&\"']/g, "") + "</b>" : "") +
            ". " + untilTxt + ". <a href='index.html#converter'><b>Ir converter</b></a>";
        } else {
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

  // Premium remoto (conta) — é o que libera o Premium no site.
  // Retorna o timestamp (ms) em caso de SUCESSO (0 = sem VIP).
  // Em FALHA DE REDE/SERVIDOR, REJEITA em vez de devolver 0 — assim o
  // chamador sabe a diferença entre "sem VIP" e "não consegui verificar"
  // e NÃO apaga o cache local de quem já é VIP.
  function remotePremiumMs() {
    if (!enabled() || !currentUser()) return Promise.resolve(0);
    return authReq("/api/premium").then(function (r) {
      return +r.premium_until_ms || 0;
    });
  }

  function kiwifyUrl(plan) {
    if (!kiwifyEnabled()) return "";
    var cfg = window.RC_CONFIG || {};
    plan = normalizePlan(plan);
    var u = plan === "world1" ? (cfg.KIWIFY_URL_WORLD1 || cfg.KIWIFY_URL_24H || "")
      : plan === "vip7" ? (cfg.KIWIFY_URL_7D || "")
      : plan === "creator" ? (cfg.KIWIFY_URL_CREATOR || "")
      : (cfg.KIWIFY_URL_30D || "");
    return /^https?:\/\//i.test(u) ? u : "";
  }

  // Entrada única de compra: autentica a conta e confirma o plano antes do checkout.
  // Backup Kiwify em site/backup-kiwify-2026-09-20/.
  function checkout(plan, notice) {
    plan = normalizePlan(plan);
    if (!currentEmail()) {
      try { localStorage.setItem("rc_pending_plan", plan); } catch (e) {}
      if (window.RC_auth) window.RC_auth.openModal();
      return true;
    }
    // Sempre passa pelo nosso modal antes de qualquer cobrança:
    // conta Google, resumo do plano e aceite explícito dos termos.
    if (!enabled()) return false;
    openPayModal(notice || null, plan);
    return true;
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), function (b) {
      var plan = normalizePlan(b.getAttribute("data-pay"));
      if (!depixEnabled() && !kiwifyUrl(plan) && !enabled()) { b.hidden = true; return; }
      b.hidden = false;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        var source = b.getAttribute("data-source") || "pricing_card";
        track("buy_clicked", { plan: plan, price_cents: ({ world1: 599, vip7: 799, vip30: 2490, creator: 3990 })[plan], source: source });
        checkout(plan, null);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePay();
    });
    document.addEventListener("rc-auth", function () {
      var em = currentEmail(), plan = "";
      try { plan = localStorage.getItem("rc_pending_plan") || ""; } catch (e) {}
      if (!em || !plan) return;
      try { localStorage.removeItem("rc_pending_plan"); } catch (e2) {}
      openPayModal(null, normalizePlan(plan));
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
    remotePremiumMs: remotePremiumMs,
    track: track, entitlements: entitlements, freeQuota: freeQuota, authorizeOperation: authorizeOperation, consumeOperation: consumeOperation
  };
  try { document.dispatchEvent(new Event("rc-pay-ready")); } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
