/* ReativaConquistas — frontend
   Conta (login/senha) -> verifica e-mail -> paga (AbacatePay) -> Premium.
   Cota grátis: 1 conversão / 7 dias. Popups só abrem em clique explícito.
*/
(function () {
  "use strict";

  var CFG = window.RC_CONFIG || {};
  var FREE_PER_WEEK = CFG.FREE_PER_WEEK || 1;
  var WEEK_MS = 7 * 24 * 3600 * 1000;

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var form = $("form"), input = $("file"), drop = $("drop"),
      fileName = $("fileName"), submit = $("submit"), strip = $("strip"),
      accept = $("accept"), status = $("status"),
      quotaBar = $("quotaBar"), quotaText = $("quotaText"),
      gameCreative = $("gameCreative"), creativeLabel = $("creativeLabel"),
      wantIcon = $("wantIcon"), iconFile = $("iconFile"), iconBtn = $("iconBtn"),
      iconPreview = $("iconPreview"), iconName = $("iconName"),
      wantRename = $("wantRename"), renameInput = $("renameInput");

  var payModal = $("payModal"), authModal = $("authModal");
  var selected = null, selectedIcon = null, pendingPay = false;

  if (CFG.PREMIUM_PRICE_LABEL) {
    var pp = $("premiumPrice");
    if (pp) pp.innerHTML = CFG.PREMIUM_PRICE_LABEL + "<small> · 30 dias</small>";
    var payPrice = $("payPrice");
    if (payPrice) payPrice.textContent = CFG.PREMIUM_PRICE_LABEL;
  }
  if (CFG.SUPPORT_EMAIL) {
    document.querySelectorAll('a[href^="mailto:suporte"]').forEach(function (a) {
      a.href = "mailto:" + CFG.SUPPORT_EMAIL;
    });
    var se = $("supEmail");
    if (se) se.textContent = CFG.SUPPORT_EMAIL;
  }
  if (CFG.OPERATOR_DOC) { var od = $("opDoc"); if (od) od.textContent = CFG.OPERATOR_DOC; }
  if (CFG.OPERATOR_CITY_UF) { var oc = $("opCity"); if (oc) oc.textContent = CFG.OPERATOR_CITY_UF; }

  /* ---------- sessão / conta ---------- */
  function getToken() { try { return localStorage.getItem("rc_token") || ""; } catch (e) { return ""; } }
  function setToken(t) { try { t ? localStorage.setItem("rc_token", t) : localStorage.removeItem("rc_token"); } catch (e) {} }
  function getAccount() { try { return JSON.parse(localStorage.getItem("rc_account") || "null"); } catch (e) { return null; } }
  function setAccount(a) { try { a ? localStorage.setItem("rc_account", JSON.stringify(a)) : localStorage.removeItem("rc_account"); } catch (e) {} }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var t = getToken();
    if (t) opts.headers["Authorization"] = "Bearer " + t;
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var j = null;
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { error: "Resposta inválida do servidor." }; }
        if (!res.ok) {
          var err = new Error((j && j.error) || ("Erro " + res.status));
          err.code = j && j.code;
          throw err;
        }
        return j;
      });
    });
  }

  function refreshMe() {
    var t = getToken();
    if (!t) { renderAuth(null); refreshQuota(); return; }
    api("/api/auth/me").then(function (me) {
      setAccount({ email: me.email, name: me.name, verified: me.verified });
      renderAuth(me);
      refreshQuota();
      if (pendingPay && me.verified) { pendingPay = false; openPay(); }
    }).catch(function () {
      setToken(""); setAccount(null);
      renderAuth(null); refreshQuota();
    });
  }

  function renderAuth(me) {
    var area = $("authArea");
    if (!area) return;
    if (me) {
      var until = me.premium_until_ms || 0;
      var badge = until > Date.now() ? " · Premium" : "";
      area.innerHTML = '<a href="minha-conta.html" class="who" title="' + escapeHtml(me.email) + '">' +
        escapeHtml(me.name || me.email) + badge + '</a> <a href="#" id="logoutLink">Sair</a>';
      var lo = $("logoutLink");
      if (lo) lo.addEventListener("click", function (e) {
        e.preventDefault();
        api("/api/auth/logout", { method: "POST" }).catch(function () {});
        setToken(""); setAccount(null);
        renderAuth(null); refreshQuota();
        setStatus("ok", "Você saiu da conta.");
      });
    } else {
      area.innerHTML = '<a href="#" id="authBtn">Entrar</a>';
      var b = $("authBtn");
      if (b) b.addEventListener("click", function (e) { e.preventDefault(); openAuth(); });
    }
  }

  /* ---------- premium / cota ---------- */
  var serverPremiumUntil = 0;
  function getPremium() {
    if (serverPremiumUntil > Date.now()) return { until: serverPremiumUntil, server: true };
    try {
      var p = JSON.parse(localStorage.getItem("rc_premium") || "null");
      if (p && p.until && Date.now() < p.until) return p;
      localStorage.removeItem("rc_premium");
    } catch (e) {}
    return null;
  }
  function isPremium() { return !!getPremium(); }

  function quotaUses() {
    try {
      var arr = JSON.parse(localStorage.getItem("rc_quota") || "[]");
      var now = Date.now();
      arr = arr.filter(function (t) { return now - t < WEEK_MS; });
      localStorage.setItem("rc_quota", JSON.stringify(arr));
      return arr;
    } catch (e) { return []; }
  }
  function quotaAdd() {
    var arr = quotaUses(); arr.push(Date.now());
    localStorage.setItem("rc_quota", JSON.stringify(arr));
  }
  function freeLeft() { return Math.max(0, FREE_PER_WEEK - quotaUses().length); }

  function refreshQuota() {
    var t = getToken();
    if (t) {
      api("/api/auth/me").then(function (me) {
        serverPremiumUntil = me.premium_until_ms || 0;
        paintQuota(me);
      }).catch(function () { paintQuota(null); });
    } else {
      serverPremiumUntil = 0;
      paintQuota(null);
    }
    updateSubmit();
  }

  function paintQuota(me) {
    var p = getPremium();
    if (p) {
      quotaBar.classList.add("premium");
      var d = new Date(p.until);
      var who = (me && me.email) ? escapeHtml(me.email) : "sua conta";
      quotaText.innerHTML = "<strong>Premium ativo</strong> (" + who + ") até <strong>" +
        d.toLocaleDateString("pt-BR") + "</strong> — sem limite de conversões.";
    } else {
      quotaBar.classList.remove("premium");
      var left = freeLeft();
      if (left > 0) {
        quotaText.innerHTML = "Você tem <strong>" + left + " conversão grátis</strong> esta semana, sem cadastro. <a href='#planos'>Ver o Premium</a>";
      } else {
        var arr = quotaUses();
        var next = arr.length ? new Date(arr[0] + WEEK_MS).toLocaleDateString("pt-BR") : "";
        quotaText.innerHTML = "Sua <strong>cota grátis acabou</strong> esta semana" + (next ? " (renova em <strong>" + next + "</strong>)" : "") + ". <a href='#' data-pay>Assinar o Premium</a>";
      }
    }
  }

  /* ---------- status ---------- */
  function setStatus(kind, html) {
    if (!kind) { status.hidden = true; status.className = "status"; status.textContent = ""; return; }
    status.hidden = false;
    status.className = "status " + kind;
    status.innerHTML = html;
  }
  // Aviso discreto (sem popup): usado quando clicam em função Premium bloqueada
  function lockedHint(msg) {
    setStatus("", escapeHtml(msg) + ' <a href="#" data-pay><b>Ver o Premium</b></a>');
  }

  /* ---------- arquivo ---------- */
  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }
  function baseName(name) { return name.replace(/\.(mcworld|zip)$/i, "") + "-conquistas.mcworld"; }

  function pick(file) {
    if (!file) return;
    var ok = /\.(mcworld|zip)$/i.test(file.name);
    if (file.size > 100 * 1024 * 1024) {
      selected = null; fileName.hidden = true; updateSubmit();
      setStatus("err", "Arquivo grande demais (máx. <b>100 MB</b>).");
      return;
    }
    selected = ok ? file : null;
    if (ok) {
      fileName.textContent = file.name + "  (" + fmtSize(file.size) + ")";
      fileName.hidden = false;
      setStatus(null);
    } else {
      fileName.hidden = true;
      setStatus("err", "Formato não suportado. Envie um arquivo <b>.mcworld</b> ou <b>.zip</b>.");
    }
    updateSubmit();
  }

  function updateSubmit() {
    submit.disabled = !(selected && accept.checked);
  }

  input.addEventListener("change", function () { pick(input.files && input.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { pick(e.dataTransfer.files && e.dataTransfer.files[0]); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  accept.addEventListener("change", updateSubmit);

  /* travas premium — SEM popup automático, só aviso inline */
  if (strip) strip.addEventListener("change", function () {
    if (strip.checked && !isPremium()) { strip.checked = false; lockedHint("Remover behavior packs é função Premium."); }
  });
  if (creativeLabel) creativeLabel.addEventListener("click", function () {
    if (!isPremium()) {
      var r = document.querySelector('input[name="gamemode"][value="survival"]');
      setTimeout(function () { if (r) r.checked = true; }, 0);
      lockedHint("Deixar no Criativo é função Premium.");
    }
  });
  if (wantIcon) wantIcon.addEventListener("change", function () {
    if (wantIcon.checked && !isPremium()) { wantIcon.checked = false; lockedHint("Trocar a foto do mundo é função Premium."); }
  });
  if (wantRename) wantRename.addEventListener("change", function () {
    if (wantRename.checked && !isPremium()) { wantRename.checked = false; lockedHint("Renomear o mundo é função Premium."); return; }
    if (wantRename.checked) renameInput.focus();
  });
  if (iconBtn) iconBtn.addEventListener("click", function () {
    if (!isPremium()) { lockedHint("Trocar a foto do mundo é função Premium."); return; }
    iconFile.click();
  });
  if (iconFile) iconFile.addEventListener("change", function () {
    var f = iconFile.files && iconFile.files[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setStatus("err", "Ícone: envie <b>PNG ou JPG</b>."); return; }
    if (f.size > 5 * 1024 * 1024) { setStatus("err", "Ícone grande demais (máx. <b>5 MB</b>)."); return; }
    selectedIcon = f;
    wantIcon.checked = true;
    iconName.textContent = f.name + " (" + fmtSize(f.size) + ")";
    var url = URL.createObjectURL(f);
    iconPreview.src = url; iconPreview.style.display = "block";
    setStatus(null);
  });

  /* ---------- modais ---------- */
  function openPay() {
    closeAuth();
    var acc = getAccount();
    if (!acc) {
      // Sem conta: manda criar conta primeiro (fluxo conta -> pagar)
      openAuth("Crie sua conta grátis para continuar com o Premium.");
      pendingPay = true;
      return;
    }
    $("payNoAccount").hidden = true;
    $("payHasAccount").hidden = false;
    $("payAccountEmail").textContent = acc.email;
    $("payVerifyWarn").hidden = !!acc.verified;
    payModal.classList.add("open");
  }
  function closePay() { payModal.classList.remove("open"); }

  var captchaId = "";
  function openAuth(notice) {
    closePay();
    if (notice) $("authNotice").textContent = notice;
    else $("authNotice").textContent = "Entre ou crie sua conta. É grátis; o Premium é ativado nela.";
    authModal.classList.add("open");
    loadCaptcha();
  }
  function closeAuth() { authModal.classList.remove("open"); }

  function loadCaptcha() {
    $("captchaQ").textContent = "carregando…";
    api("/api/captcha/new").then(function (c) {
      captchaId = c.id;
      $("captchaQ").textContent = c.question;
      $("regCaptcha").value = "";
    }).catch(function () { $("captchaQ").textContent = "erro — reabra"; });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-pay]");
    if (t) { e.preventDefault(); openPay(); } // único lugar que abre o popup: clique explícito
  });
  var navPrem = $("navPremium");
  if (navPrem) navPrem.addEventListener("click", function (e) {
    e.preventDefault();
    var p = getPremium();
    if (p) {
      setStatus("ok", "Premium ativo até <b>" + new Date(p.until).toLocaleDateString("pt-BR") + "</b>.");
      document.getElementById("converter").scrollIntoView({ behavior: "smooth" });
    } else openPay();
  });
  $("payCancel").addEventListener("click", closePay);
  payModal.addEventListener("click", function (e) { if (e.target === payModal) closePay(); });
  authModal.addEventListener("click", function (e) { if (e.target === authModal) closeAuth(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closePay(); closeAuth(); } });
  $("payToAuth").addEventListener("click", function () {
    openAuth("Crie sua conta grátis para continuar com o Premium.");
    pendingPay = true;
  });
  var pgv = $("payGoVerify");
  if (pgv) pgv.addEventListener("click", function (e) {
    e.preventDefault(); closePay();
    openAuth();
    showVerify((getAccount() || {}).email || "");
  });

  /* abas login/registro */
  document.querySelectorAll('input[name="authtab"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var reg = document.querySelector('input[name="authtab"]:checked').value === "register";
      $("authLogin").hidden = reg;
      $("authRegister").hidden = !reg;
      if (reg) loadCaptcha();
    });
  });
  $("authCancel").addEventListener("click", closeAuth);
  $("authCancel2").addEventListener("click", closeAuth);

  function afterAuth(j) {
    setToken(j.token);
    setAccount({ email: j.email, name: j.name, verified: j.verified });
    renderAuth({ email: j.email, name: j.name, premium_until_ms: 0 });
    refreshQuota();
    if (!j.verified) {
      showVerify(j.email);
      if (!j.mail_sent) setStatus("", "Conta criada. O envio de e-mail ainda não está configurado neste servidor — peça o código ao suporte ou veja o terminal do servidor (modo teste).");
    } else {
      closeAuth();
      setStatus("ok", "Olá, <b>" + escapeHtml(j.name) + "</b>. Conta pronta" + (pendingPay ? " — continue para o pagamento." : ".") );
      if (pendingPay) { pendingPay = false; openPay(); }
    }
  }

  $("registerGo").addEventListener("click", function () {
    var name = ($("regName").value || "").trim();
    var email = ($("regEmail").value || "").trim().toLowerCase();
    var email2 = ($("regEmail2").value || "").trim().toLowerCase();
    var pass = $("regPass").value || "";
    if (name.length < 2) { $("regName").focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("regEmail").focus(); return; }
    if (email !== email2) { setStatus("err", "Os e-mails não conferem — digite o mesmo nos dois campos."); $("regEmail2").focus(); return; }
    if (pass.length < 8) { $("regPass").focus(); setStatus("err", "A senha precisa de ao menos <b>8 caracteres</b>."); return; }
    var btn = $("registerGo"); btn.disabled = true; btn.textContent = "Criando…";
    api("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, email: email, password: pass,
        captcha_id: captchaId, captcha: $("regCaptcha").value,
        website: $("regWebsite").value })
    }).then(function (j) {
      btn.disabled = false; btn.textContent = "Criar conta →";
      afterAuth(j);
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = "Criar conta →";
      if (err.code === "BAD_CAPTCHA") loadCaptcha();
      if (err.code === "EXISTS") {
        document.querySelector('input[name="authtab"][value="login"]').checked = true;
        $("authLogin").hidden = false; $("authRegister").hidden = true;
        $("loginEmail").value = email;
      }
      setStatus("err", escapeHtml(err.message));
    });
  });

  $("loginGo").addEventListener("click", function () {
    var btn = $("loginGo"); btn.disabled = true; btn.textContent = "Entrando…";
    api("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ($("loginEmail").value || "").trim().toLowerCase(),
        password: $("loginPass").value || "" })
    }).then(function (j) {
      btn.disabled = false; btn.textContent = "Entrar →";
      afterAuth(j);
    }).catch(function (err) {
      btn.disabled = false; btn.textContent = "Entrar →";
      setStatus("err", escapeHtml(err.message));
    });
  });

  function showVerify(email) {
    $("authVerify").hidden = false;
    $("verifyEmail").textContent = email;
  }
  $("verifyGo").addEventListener("click", function () {
    api("/api/auth/verify-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: $("verifyCode").value || "" })
    }).then(function () {
      var acc = getAccount() || {};
      acc.verified = true; setAccount(acc);
      $("authVerify").hidden = true;
      closeAuth();
      setStatus("ok", "E-mail confirmado.");
      if (pendingPay) { pendingPay = false; openPay(); }
    }).catch(function (err) { setStatus("err", escapeHtml(err.message)); });
  });
  $("resendCode").addEventListener("click", function () {
    api("/api/auth/send-code", { method: "POST" }).then(function (j) {
      setStatus("", escapeHtml(j.hint || "Código reenviado."));
    }).catch(function (err) { setStatus("err", escapeHtml(err.message)); });
  });

  /* ---------- pagamento (conta primeiro, sempre) ---------- */
  var payGoHTML = $("payGo").innerHTML;
  $("payGo").addEventListener("click", function () {
    if (!$("payAccept").checked) { setStatusPay("Você precisa aceitar os Termos, a Privacidade e o Reembolso para assinar."); return; }
    var btn = $("payGo");
    btn.disabled = true; btn.textContent = "Gerando pagamento…";
    api("/api/abacate/create", { method: "POST" })
      .then(function (j) {
        btn.disabled = false; btn.innerHTML = payGoHTML;
        if (!j.url) throw new Error("Falha ao gerar pagamento. Tente de novo ou chame o suporte.");
        try {
          var acc = getAccount() || {};
          localStorage.setItem("rc_pending_email", acc.email || "");
        } catch (e) {}
        window.location.href = j.url;
      })
      .catch(function (err) {
        btn.disabled = false; btn.innerHTML = payGoHTML;
        if (err.code === "LOGIN_REQUIRED") { closePay(); openAuth("Entre ou crie sua conta para continuar com o Premium."); pendingPay = true; return; }
        if (err.code === "VERIFY_REQUIRED") {
          closePay(); openAuth(); showVerify((getAccount() || {}).email || "");
          setStatus("err", "Confirme seu e-mail com o código antes de pagar.");
          return;
        }
        setStatusPay(err.message);
      });
  });
  function setStatusPay(msg) {
    setStatus("err", escapeHtml(msg));
    closePay();
    document.getElementById("converter").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- envio ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!selected || submit.disabled) return;
    if (!accept.checked) { setStatus("err", "Para converter, você precisa <b>aceitar os Termos</b> marcando a caixinha acima."); return; }

    var prem = getPremium();
    var mode = (document.querySelector('input[name="gamemode"]:checked') || {}).value || "survival";
    if (mode === "creative" && !prem) { lockedHint("Modo Criativo é Premium."); return; }
    if (strip.checked && !prem) { lockedHint("Remover behavior packs é Premium."); return; }
    if (wantIcon.checked && !prem) { lockedHint("Trocar a foto do mundo é Premium."); return; }
    var newName = wantRename && wantRename.checked ? (renameInput.value || "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    if (wantRename && wantRename.checked && !prem) { lockedHint("Renomear o mundo é Premium."); return; }
    if (newName && !prem) { lockedHint("Renomear o mundo é Premium."); return; }
    if (!prem && freeLeft() <= 0) { setStatus("err", "Sua <b>cota grátis acabou</b> esta semana. <a href='#' data-pay><b>Assinar o Premium</b></a>"); return; }

    setStatus("", '<span class="spin"></span> Corrigindo mundo, aguarde… Não feche a página.');
    submit.disabled = true;

    var fd = new FormData();
    fd.append("mcworld", selected, selected.name);
    fd.append("game_mode", mode);
    if (strip.checked) fd.append("strip", "1");
    if (wantIcon.checked && selectedIcon) fd.append("icon", selectedIcon, selectedIcon.name);
    if (newName) fd.append("world_name", newName);
    fd.append("accept_terms", "1");
    var acc = getAccount();
    if (acc && acc.email) fd.append("premium_email", acc.email);

    var headers = {};
    var t = getToken();
    if (t) headers["Authorization"] = "Bearer " + t;
    fetch("/api/fix", { method: "POST", headers: headers, body: fd })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (j) {
            var err = new Error((j && j.error) || ("Erro " + res.status));
            err.code = j && j.code;
            throw err;
          }).catch(function (err) {
            if (err instanceof Error && err.code) throw err;
            throw new Error("Erro " + res.status + ". Tente de novo.");
          });
        }
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = baseName(selected.name);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        if (!prem) { quotaAdd(); refreshQuota(); }
        setStatus("ok", "Pronto. Download iniciado: <b>" + escapeHtml(baseName(selected.name)) +
          "</b>. Abra o mundo em <b>" + (mode === "creative" ? "Criativo" : "Sobrevivência") + "</b>" +
          (mode === "survival" ? " e com cheats <b>desligados</b>" : "") +
          ". <b>Guarde o arquivo original</b> por segurança.");
        submit.disabled = false;
      })
      .catch(function (err) {
        if (err.code === "PREMIUM_REQUIRED") {
          lockedHint(err.message);
        } else if (err.code === "QUOTA_EXCEEDED") {
          refreshQuota();
          setStatus("err", escapeHtml(err.message) + ' <a href="#" data-pay><b>Assinar o Premium</b></a>');
        } else {
          setStatus("err", "Não deu certo: " + escapeHtml(err.message));
        }
        submit.disabled = false;
      });
  });

  renderAuth(null);
  refreshMe();
})();
