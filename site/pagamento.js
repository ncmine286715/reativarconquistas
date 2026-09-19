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

  function openPayModal(notice) {
    if (!enabled()) return;
    closePay();
    var logged = currentEmail();
    var bg = document.createElement("div");
    bg.className = "modal-bg open";
    bg.id = "payModal";
    bg.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="payTitle">' +
      "<h3 id='payTitle'>Premium — 30 dias</h3>" +
      (notice ? "<div class='warn' style='margin:0 0 12px;font-size:13px'>" + escH(notice) + "</div>" : "") +
      "<p class='sub'>Conversões <b>ilimitadas</b> por 30 dias + mundos gigantes + sem behavior pack + foto e nome do mundo. Pagamento seguro (Pix ou cartão) via AbacatePay.</p>" +
      "<div class='status' id='payMsg' hidden></div>" +
      "<label for='payEmail' style='display:block;font-size:13px;font-weight:700;margin:12px 0 5px'>E-mail (o Premium é liberado nele)</label>" +
      "<input id='payEmail' type='email' maxlength='120' autocomplete='email' value='" + logged.replace(/\"/g, "&quot;") + "'" + (logged ? " readonly" : "") + " style='width:100%;border:1.5px solid var(--line-strong);border-radius:10px;padding:10px 12px;font-size:14px'>" +
      "<div class='row2' style='display:flex;gap:10px;margin-top:14px'>" +
      "<button class='btn-ghost' id='payBack' type='button' style='flex:1'>Voltar</button>" +
      "<button class='btn-ghost' id='payGo' type='button' style='flex:2;background:var(--orange);border-color:var(--orange);color:#fff'>Ir pagar</button></div>" +
      "<div class='secure' id='payConn' style='margin-top:10px;font-size:13px'>Testando conexão…</div>" +
      (logged
        ? "<div class='secure' style='margin-top:10px;font-size:13px'>Pagando como <b>" + logged.replace(/[<>&\"']/g, "") + "</b></div>"
        : "<div class='secure' style='margin-top:10px;font-size:13px'><a href='#' id='payLogin'><b>Entrar / criar conta</b></a> para guardar seu Premium</div>") + "</div>";
    document.body.appendChild(bg);
    bg.addEventListener("click", function (e) { if (e.target === bg) closePay(); });
    // self-test: mostra na hora se o servidor de pagamento responde
    try {
      fetch(base() + "/api/config").then(function (r) {
        if (!r.ok) throw new Error();
        var c = document.getElementById("payConn");
        if (c) c.textContent = "✓ Conectado ao pagamento seguro";
      }).catch(function (err) {
        logClient("selftest", (err && err.message) || err);
        var c = document.getElementById("payConn");
        if (c) c.textContent = "⚠ Sem conexão com o pagamento agora — confira sua internet antes de continuar.";
      });
    } catch (e) {}
    document.getElementById("payBack").addEventListener("click", closePay);
    var pl = document.getElementById("payLogin");
    if (pl) pl.addEventListener("click", function (e) {
      e.preventDefault(); closePay();
      if (window.RC_auth) window.RC_auth.openModal("login", "Entre para pagar com sua conta (ou pague só com o e-mail).");
    });
    document.getElementById("payGo").addEventListener("click", function () {
      var email = (document.getElementById("payEmail").value || "").trim();
      if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(email)) { payStatus("Informe um e-mail válido.", "err"); return; }
      var go = document.getElementById("payGo");
      var name = "";
      try {
        var u = window.RC_auth && window.RC_auth.user();
        if (u && u.name) name = u.name;
      } catch (e) {}
      function attempt(n) {
        go.disabled = true; go.textContent = "Gerando cobrança…";
        payStatus(n > 1 ? "Tentando de novo (tentativa " + n + ")…" : "Criando cobrança segura…");
        // text/plain = request simples (sem preflight); o Worker lê o JSON do corpo
        req("/api/abacate/create", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ email: email, name: name })
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
          box.className = "status ok";
          box.innerHTML = "Pagamento confirmado" + (r.email ? " em <b>" + r.email.replace(/[<>&\"']/g, "") + "</b>" : "") +
            ". Premium liberado por 30 dias. <a href='index.html#converter'><b>Ir converter</b></a>";
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
        openPayModal();
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
