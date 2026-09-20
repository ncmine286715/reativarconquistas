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
    return u;
  }
  function enabled() { return !!base(); }

  function req(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    try {
      var t = localStorage.getItem("rc_token") || "";
      if (t) opts.headers.Authorization = "Bearer " + t;
    } catch (e) {}
    return fetch(base() + path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) {}
        if (!res.ok) throw new Error((j && j.error) || ("Erro " + res.status));
        return j;
      });
    });
  }

  function currentEmail() {
    try {
      var u = window.RC_auth && window.RC_auth.user();
      if (u && u.email) return u.email;
    } catch (e) {}
    return "";
  }

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
      return "Não consegui falar com o servidor de pagamento. Toque em Tentar de novo — se persistir, confira sua internet ou fale no suporte.";
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

  var PLANS = {
    vip24h: { title: "Passe 24h", price: "R$ 4,90", cta: "Liberar por R$ 4,90",
      sub: "VIP completo por <b>24 horas</b>: mundos gigantes + modo de jogo + foto + tempo/clima + lote. Ideal para resolver <b>aquele mundo grande</b> hoje." },
    vip30: { title: "VIP — 30 dias", price: "R$ 19,90", cta: "Assinar por R$ 19,90",
      sub: "Mundos <b>gigantes</b> (acima de 10 MB) + modo de jogo + manter inventário + foto do mundo + travar tempo e clima + lote. Pagamento seguro (Pix ou cartão) via AbacatePay." }
  };

  function openPayModal(notice, plan) {
    if (!enabled()) return;
    plan = plan === "vip24h" ? "vip24h" : "vip30";
    closePay();
    var logged = currentEmail();
    var bg = document.createElement("div");
    bg.className = "modal-bg open";
    bg.id = "payModal";
    bg.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="payTitle">' +
      "<h3 id='payTitle'></h3>" +
      (notice ? "<div class='warn' style='margin:0 0 12px;font-size:13px'>" + escH(notice) + "</div>" : "") +
      "<div class='planpick' role='radiogroup' aria-label='Escolha o plano'>" +
      "<label><input type='radio' name='payplan' value='vip24h'" + (plan === "vip24h" ? " checked" : "") + "> Passe 24h — <b>R$ 4,90</b></label>" +
      "<label><input type='radio' name='payplan' value='vip30'" + (plan === "vip30" ? " checked" : "") + "> VIP 30 dias — <b>R$ 19,90</b></label>" +
      "</div>" +
      "<p class='sub' id='paySub'></p>" +
      "<div class='status' id='payMsg' hidden></div>" +
      "<label for='payEmail' style='display:block;font-size:13px;font-weight:700;margin:12px 0 5px'>E-mail (o VIP é liberado nele)</label>" +
      "<input id='payEmail' type='email' maxlength='120' autocomplete='email' value='" + logged.replace(/\"/g, "&quot;") + "'" + (logged ? " readonly" : "") + " style='width:100%;border:1.5px solid var(--line-strong);border-radius:10px;padding:10px 12px;font-size:14px'>" +
      "<div class='row2' style='display:flex;gap:10px;margin-top:14px'>" +
      "<button class='btn-ghost' id='payBack' type='button' style='flex:1'>Voltar</button>" +
      "<button class='btn-ghost' id='payGo' type='button' style='flex:2;background:var(--orange);border-color:var(--orange);color:#fff'></button></div>" +
      "<div class='secure' id='payConn' style='margin-top:10px;font-size:13px'>Testando conexão…</div>" +
      (logged
        ? "<div class='secure' style='margin-top:10px;font-size:13px'>Pagando como <b>" + logged.replace(/[<>&\"']/g, "") + "</b></div>"
        : "<div class='secure' style='margin-top:10px;font-size:13px'><a href='#' id='payLogin'><b>Entrar / criar conta</b></a> para guardar seu VIP</div>") + "</div>";
    document.body.appendChild(bg);
    function selPlan() {
      var r = bg.querySelector("input[name='payplan']:checked");
      return (r && r.value === "vip24h") ? "vip24h" : "vip30";
    }
    function paintPlan() {
      var p = PLANS[selPlan()];
      document.getElementById("payTitle").textContent = p.title + " — " + p.price;
      document.getElementById("paySub").innerHTML = p.sub;
      document.getElementById("payGo").textContent = p.cta;
    }
    Array.prototype.forEach.call(bg.querySelectorAll("input[name='payplan']"), function (r) {
      r.addEventListener("change", paintPlan);
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
        if (c) c.textContent = "✓ Conectado ao pagamento seguro";
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
    var vipLockUntil = 0;
    function showVipOwner(ms) {
      vipLockUntil = ms;
      var m = document.getElementById("payMsg");
      if (m) {
        m.hidden = false;
        m.className = "status ok";
        m.innerHTML = "Este e-mail já tem <b>VIP até " + new Date(ms).toLocaleDateString("pt-BR") + "</b>. Não precisa pagar de novo.";
      }
      var go = document.getElementById("payGo");
      if (go) { go.disabled = false; go.textContent = "Ir converter"; }
    }
    function refreshVipLock() {
      if (!document.getElementById("payModal")) return;
      var em = (document.getElementById("payEmail").value || "").trim();
      if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(em)) return;
      remotePremiumMs(em).then(function (ms) {
        if (ms > Date.now() && document.getElementById("payModal") && !vipLockUntil) showVipOwner(ms);
      }).catch(function () {});
    }
    var emailTimer = null;
    document.getElementById("payEmail").addEventListener("input", function () {
      vipLockUntil = 0;
      if (emailTimer) clearTimeout(emailTimer);
      emailTimer = setTimeout(refreshVipLock, 700);
    });
    refreshVipLock();
    document.getElementById("payBack").addEventListener("click", closePay);
    var pl = document.getElementById("payLogin");
    if (pl) pl.addEventListener("click", function (e) {
      e.preventDefault(); closePay();
      if (window.RC_auth) window.RC_auth.openModal("login", "Entre para pagar com sua conta (ou pague só com o e-mail).");
    });
    document.getElementById("payGo").addEventListener("click", function () {
      var email = (document.getElementById("payEmail").value || "").trim();
      if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(email)) { payStatus("Informe um e-mail válido.", "err"); return; }
      // já é VIP? redireciona em vez de cobrar de novo (trava final)
      if (vipLockUntil > Date.now()) { location.href = "index.html#converter"; return; }
      var go = document.getElementById("payGo");
      go.disabled = true; go.textContent = "Verificando…";
      var buyerName = "";
      try {
        var u0 = window.RC_auth && window.RC_auth.user();
        if (u0 && u0.name) buyerName = u0.name;
      } catch (e0) {}
      remotePremiumMs(email).then(function (ms) {
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
        var plan = (planEl && planEl.value === "vip24h") ? "vip24h" : "vip30";
        // text/plain = request simples (sem preflight); o Worker lê o JSON do corpo
        req("/api/abacate/create", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ email: email, name: name, plan: plan })
        }).then(function (r) {
          if (!r.url) throw new Error("Resposta sem link de pagamento.");
          try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e) {}
          payStatus("Abrindo o checkout…");
          location.href = r.url;
        }).catch(function (err) {
          logClient("create-" + n, (err && err.message) || err);
          if (n < 2) { setTimeout(function () { attempt(n + 1); }, 1500); return; }
          go.disabled = false; go.textContent = "Tentar de novo";
          payStatus(friendlyErr(err), "err");
        });
      }
      attempt(1);
    });
  }

  // sucesso.html?id=BILLING_ID (volta do checkout) — mostra pagou/não-pagou.
  function checkReturn() {
    var box = document.getElementById("box");
    var id = "";
    try { id = new URLSearchParams(location.search).get("id") || ""; } catch (e) {}
    if (!id) {
      try { id = localStorage.getItem("rc_pending_billing") || ""; } catch (e) {}
    }
    if (!id || !enabled()) return Promise.resolve(null);
    if (box) { box.hidden = false; box.className = "status"; box.textContent = "Confirmando pagamento…"; }
    return req("/api/abacate/status?id=" + encodeURIComponent(id)).then(function (r) {
      if (box) {
        if (r.paid) {
          // libera na hora NESTE navegador (vale p/ quem pagou sem login também)
          try {
            if (+r.premium_until_ms > Date.now()) {
              localStorage.setItem("rc_prem_remote", JSON.stringify({ until: +r.premium_until_ms, email: r.email || "" }));
            }
            localStorage.removeItem("rc_pending_billing");
          } catch (e) {}
          var untilTxt = +r.premium_until_ms > Date.now()
            ? "VIP liberado até <b>" + new Date(+r.premium_until_ms).toLocaleDateString("pt-BR") + "</b>"
            : "VIP liberado";
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
  function remotePremiumMs(email) {
    if (!enabled() || !email) return Promise.resolve(0);
    return req("/api/premium?email=" + encodeURIComponent(email)).then(function (r) {
      return +r.premium_until_ms || 0;
    }).catch(function () { return 0; });
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), function (b) {
      if (!enabled()) { b.hidden = true; return; }
      b.hidden = false;
      b.addEventListener("click", function (e) {
        e.preventDefault();
        openPayModal(null, b.getAttribute("data-pay"));
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePay();
    });
  }

  window.RC_pay = {
    enabled: enabled,
    openPayModal: openPayModal,
    checkReturn: checkReturn,
    remotePremiumMs: remotePremiumMs
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
