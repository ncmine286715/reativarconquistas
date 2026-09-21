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
  track("visit");

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
    try { return !!(window.RC_CONFIG && window.RC_CONFIG.DEPIX_ENABLED && base()); } catch (e) { return false; }
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
  function depixCreate(plan, doc, payerEmail) {
    return authReq("/api/depix/create", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        plan: normalizePlan(plan),
        payer_tax_number: cleanDoc(doc),
        payer_email: String(payerEmail || "").trim().toLowerCase(),
        terms_accepted: true,
        terms_version: "2026-09-20-v1.5"
      })
    }).then(function (r) { track("pix_created", { plan: normalizePlan(plan) }); return r; });
  }
  function depixStatus(id) {
    return authReq("/api/depix/status?id=" + encodeURIComponent(id));
  }
  function entitlements() { return authReq("/api/entitlements"); }
  function authorizeOperation(worlds, sizeBytes) {
    return authReq("/api/entitlements/check", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ worlds: worlds, size_bytes: sizeBytes }) });
  }
  function consumeOperation(operationId, worlds) {
    return authReq("/api/entitlements/consume", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ operation_id: operationId, worlds: worlds }) }).then(function (r) {
      try {
        var cur = JSON.parse(localStorage.getItem("rc_prem_remote") || "{}");
        cur.world_credits = +r.world_credits || 0;
        localStorage.setItem("rc_prem_remote", JSON.stringify(cur));
      } catch (e) {}
      return r;
    });
  }

  function openPayModal(notice, plan) {
    if (!enabled()) return;
    plan = normalizePlan(plan);
    track("checkout_opened", { plan: plan });
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
      "<div class='vip-assurance'><b>VIP automático:</b> cai nesta conta Google assim que o Pix for confirmado.</div>" +
      "<div class='planpick pay-planpick' role='radiogroup' aria-label='Escolha o plano'>" +
        "<label><input type='radio' name='payplan' value='world1'" + (plan === "world1" ? " checked" : "") + "><span class='plan-main'><strong>1 mundo</strong><b>R$ 5,99</b><small>150 MB</small></span></label>" +
        "<label><input type='radio' name='payplan' value='vip7'" + (plan === "vip7" ? " checked" : "") + "><span class='plan-main'><strong>7 dias</strong><b>R$ 7,99</b><small>500 MB</small></span></label>" +
        "<label><input type='radio' name='payplan' value='vip30'" + (plan === "vip30" ? " checked" : "") + "><span class='plan-main'><strong>30 dias</strong><b>R$ 24,90</b><small>Sem limite comercial</small></span></label>" +
        "<label><input type='radio' name='payplan' value='creator'" + (plan === "creator" ? " checked" : "") + "><span class='plan-main'><strong>Criador</strong><b>R$ 39,90</b><small>Sem limite comercial</small></span></label>" +
      "</div>" +
      "<p class='sub pay-sub' id='paySub'></p>" +
      "<div class='pay-form-grid'>" +
        "<div class='pay-field pay-field-full'>" +
          "<label for='payDoc'>CPF ou CNPJ do pagador</label>" +
          "<input id='payDoc' inputmode='numeric' maxlength='18' autocomplete='off' placeholder='Documento do titular do Pix'>" +
          "<small class='pay-help'><b>Pagador maior de 18 anos.</b> Se você for menor, use os dados do responsável que fará o pagamento.</small>" +
        "</div>" +
        "<div class='pay-field'>" +
          "<label for='payPixEmail'>E-mail para o Pix</label>" +
          "<input id='payPixEmail' type='email' maxlength='120' autocomplete='email' value='" + escH(logged) + "' placeholder='E-mail do pagamento'>" +
        "</div>" +
        "<div class='pay-field'>" +
          "<label for='payPixEmailConfirm'>Confirmar e-mail</label>" +
          "<input id='payPixEmailConfirm' type='email' maxlength='120' autocomplete='email' placeholder='Repita o e-mail'>" +
        "</div>" +
      "</div>" +
      "<div class='pay-mini-note'>O e-mail acima identifica a cobrança Pix. O VIP continua vinculado à <b>conta Google</b> mostrada no topo.</div>" +
      "<label class='accept pay-terms' for='payTerms'>" +
        "<input id='payTerms' type='checkbox'>" +
        "<span>Li e aceito os <a href='termos.html' target='_blank' rel='noopener'>Termos</a>, <a href='reembolso.html' target='_blank' rel='noopener'>Reembolso</a> e <a href='privacidade.html' target='_blank' rel='noopener'>Privacidade</a>. Confirmo os dados da compra.</span>" +
      "</label>" +
      "</div>" +
      "<div class='pay-footer'>" +
        "<div class='status' id='payMsg' hidden></div>" +
        "<div class='secure' id='payConn'>Verificando pagamento seguro…</div>" +
        "<div class='row2 pay-actions'>" +
          "<button class='btn-ghost' id='payBack' type='button'>Voltar</button>" +
          "<button class='btn-ghost pay-primary' id='payGo' type='button'></button>" +
        "</div>" +
      "</div>" +
      "</div>";
    document.body.appendChild(bg);
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
    function paintPlan() {
      var p = PLANS[selPlan()];
      document.getElementById("payTitle").textContent = p.title + " — " + p.price;
      document.getElementById("paySub").innerHTML = p.sub;
      document.getElementById("payGo").textContent = p.cta;
    }
    Array.prototype.forEach.call(bg.querySelectorAll("input[name='payplan']"), function (r) {
      r.addEventListener("change", function () { paintPlan(); track("plan_selected", { plan: normalizePlan(r.value) }); });
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
        if (c) c.textContent = cfg.depix_configured ? "✓ Pagamento Pix disponível" : "✓ Pagamento seguro disponível";
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
      var pixEmail = String((document.getElementById("payPixEmail") || {}).value || "").trim().toLowerCase();
      var pixEmailConfirm = String((document.getElementById("payPixEmailConfirm") || {}).value || "").trim().toLowerCase();
      if (!validEmail(pixEmail)) {
        payStatus("Preencha um e-mail válido para o Pix.", "err");
        return;
      }
      if (!validEmail(pixEmailConfirm)) {
        payStatus("Confirme o e-mail usado no Pix.", "err");
        return;
      }
      if (pixEmail !== pixEmailConfirm) {
        payStatus("Os dois e-mails não são iguais. Confira antes de continuar.", "err");
        return;
      }
      if (!document.getElementById("payTerms").checked) {
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
        payStatus(n > 1 ? "Tentando de novo (tentativa " + n + ")…" : "Criando cobrança segura…");
        var planEl = document.querySelector("#payModal input[name='payplan']:checked");
        var plan = normalizePlan(planEl && planEl.value);
        // Depix primeiro (Pix via Worker); AbacatePay como reserva.
        if (depixEnabled()) {
          var docEl = document.getElementById("payDoc");
          var doc = docEl ? docEl.value : "";
          if (!validDoc(doc)) { go.disabled = false; go.textContent = "Tentar de novo"; payStatus("Informe um CPF/CNPJ válido p/ gerar o Pix.", "err"); return; }
          depixCreate(plan, doc, pixEmail).then(function (r) {
            var url = r.url || r.payment_url;
            if (!url) throw new Error("Resposta sem link de pagamento.");
            try { localStorage.setItem("rc_pending_depix", r.id || ""); } catch (e) {}
            try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e2) {}
            payStatus("Abrindo o checkout Pix…");
            location.href = url;
          }).catch(function (err) {
            logClient("depix-create", (err && err.message) || err);
            go.disabled = false;
            go.textContent = PLANS[plan].cta;
            payStatus(friendlyErr(err), "err");
          });
          return;
        }
        // Reserva: AbacatePay (quando Depix desligado).
        // O plano de 7 dias usa preço dinâmico no Depix; não convertemos
        // silenciosamente para 30 dias em outro provedor.
        if (plan === "vip7") {
          go.disabled = false;
          go.textContent = PLANS[plan].cta;
          payStatus("O plano de 7 dias está disponível somente no Pix no momento. Escolha 24h ou 30 dias para usar outra forma de pagamento.", "err");
          return;
        }
        authReq("/api/abacate/create", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            plan: plan,
            terms_accepted: true,
            terms_version: "2026-09-20-v1.5"
          })
        }).then(function (r) {
          if (!r.url) throw new Error("Resposta sem link de pagamento.");
          try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e) {}
          payStatus("Abrindo o checkout…");
          location.href = r.url;
        }).catch(function (err) {
          logClient("create-alt", (err && err.message) || err);
          go.disabled = false;
          go.textContent = PLANS[plan].cta;
          payStatus(friendlyErr(err), "err");
        });
      }
      attempt(1);
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
            track("pix_paid", { plan: normalizePlan(r.plan) });
            try {
              localStorage.setItem("rc_prem_remote", JSON.stringify({ until: +r.premium_until_ms || 0, world_credits: +r.world_credits || 0, email: r.email || "" }));
              localStorage.setItem("rc_prem_plan", r.plan || plan);
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
          track("pix_paid", { plan: normalizePlan(r.plan) });
          // libera na hora NESTE navegador (vale p/ quem pagou sem login também)
          try {
            localStorage.setItem("rc_prem_remote", JSON.stringify({ until: +r.premium_until_ms || 0, world_credits: +r.world_credits || 0, email: r.email || "" }));
            localStorage.setItem("rc_prem_plan", r.plan || plan);
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
    var cfg = window.RC_CONFIG || {};
    var u = plan === "vip24h" ? (cfg.KIWIFY_URL_24H || "") : (cfg.KIWIFY_URL_30D || "");
    return /^https?:\/\//i.test(u) ? u : "";
  }

  // Entrada única de compra: Depix (Pix via Worker) primeiro,
  // Kiwify (link direto) como reserva, AbacatePay por último.
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
    depixEnabled: depixEnabled,
    depixCreate: depixCreate,
    depixStatus: depixStatus,
    validDoc: validDoc,
    openPayModal: openPayModal,
    checkout: checkout,
    kiwifyUrl: kiwifyUrl,
    checkReturn: checkReturn,
    remotePremiumMs: remotePremiumMs,
    track: track, entitlements: entitlements, authorizeOperation: authorizeOperation, consumeOperation: consumeOperation
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
