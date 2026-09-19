/* ReativaConquistas — pagamento AbacatePay 100% em JS, SEM segredo no navegador.
   A chave abc_* fica SÓ no Cloudflare Worker (worker/): o site chama o Worker,
   o Worker chama o AbacatePay. Ativação: preencha WORKER_URL em config.js.
   Fluxo: [data-pay] -> login (se houver) -> POST /api/abacate/create ->
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

  function checkoutEmail() {
    var email = currentEmail();
    if (!email) {
      email = (window.prompt("Qual seu e-mail? (o Premium é liberado nele após pagar)") || "").trim();
    }
    if (!/[^@\s]+@[^@\s]+\.[^@\s]+/.test(email)) throw new Error("Informe um e-mail válido.");
    return email;
  }

  // Chamado pelos botões [data-pay] nos planos. Se o Worker não estiver
  // configurado, os botões ficam escondidos (HTML) e nada acontece.
  function startCheckout() {
    if (!enabled()) return Promise.reject(new Error("Pagamento online ainda não configurado."));
    var email, name = "";
    try {
      email = checkoutEmail();
      var u = window.RC_auth && window.RC_auth.user();
      if (u && u.name) name = u.name;
    } catch (e) {
      return Promise.reject(e);
    }
    return req("/api/abacate/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, name: name })
    }).then(function (r) {
      try { localStorage.setItem("rc_pending_billing", r.id || ""); } catch (e) {}
      location.href = r.url;
      return r;
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
          box.className = "status ok";
          box.innerHTML = "Pagamento confirmado" + (r.email ? " em <b>" + r.email.replace(/[<>&\"']/g, "") + "</b>" : "") +
            ". Premium liberado por 30 dias. <a href='index.html#converter'><b>Ir converter</b></a>";
        } else {
          box.className = "status";
          box.textContent = "Pagamento ainda não confirmado (" + (r.status || "?") + "). Se já pagou, aguarde 1 min e recarregue.";
        }
      }
      return r;
    }).catch(function (err) {
      if (box) { box.className = "status err"; box.textContent = "Não deu para confirmar agora: " + err.message; }
      return null;
    });
  }

  // Premium remoto (KV do Worker) — soma ao código local (codes.js).
  function remotePremiumMs(email) {
    if (!enabled() || !email) return Promise.resolve(0);
    return req("/api/premium?email=" + encodeURIComponent(email)).then(function (r) {
      return +r.premium_until_ms || 0;
    }).catch(function () { return 0; });
  }

  function wire() {
    // mostra botões Abacate só quando o Worker está configurado
    Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), function (b) {
      if (enabled()) {
        b.hidden = false;
        b.addEventListener("click", function (e) {
          e.preventDefault();
          b.textContent = "Gerando cobrança…";
          startCheckout().catch(function (err) {
            b.textContent = "Pagar com Pix";
            window.alert(err.message);
          });
        });
      } else {
        b.hidden = true;
      }
    });
    // botão Entrar/Sair (Firebase) — some se login não configurado
    var nav = document.getElementById("navAuth");
    if (nav && window.RC_auth) {
      window.RC_auth.onChange(function (u) {
        if (!window.RC_auth.enabled) { nav.hidden = true; return; }
        nav.hidden = false;
        nav.textContent = u ? ("Sair (" + (u.email || "").split("@")[0] + ")") : "Entrar";
      });
      nav.addEventListener("click", function (e) {
        e.preventDefault();
        var u = window.RC_auth.user();
        if (u) {
          if (window.confirm("Sair da conta " + u.email + "?")) window.RC_auth.signOut();
          return;
        }
        window.RC_auth.signInGoogle().catch(function () {
          var email = (window.prompt("E-mail:") || "").trim();
          if (!email) return;
          var pw = window.prompt("Senha:") || "";
          if (!pw) return;
          window.RC_auth.signInEmail(email, pw).catch(function (err) {
            if (window.confirm("Não entrou (" + err.message + "). Criar conta com este e-mail?")) {
              window.RC_auth.signUpEmail(email, pw).catch(function (e2) { window.alert(e2.message); });
            }
          });
        });
      });
    }
  }

  window.RC_pay = {
    enabled: enabled,
    startCheckout: startCheckout,
    checkReturn: checkReturn,
    remotePremiumMs: remotePremiumMs
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
