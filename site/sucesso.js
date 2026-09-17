/* ReativaConquistas — página de retorno do pagamento */
(function () {
  "use strict";
  var title = document.getElementById("title");
  var desc = document.getElementById("desc");
  var box = document.getElementById("box");
  var hint = document.getElementById("hint");
  var qsId = new URLSearchParams(location.search).get("id");
  function show(kind, html) { box.hidden = false; box.className = "status " + kind; box.innerHTML = html; }
  function paidOk(email, until) {
    try {
      localStorage.setItem("rc_premium", JSON.stringify({ email: email, until: until }));
      localStorage.removeItem("rc_pending_email");
    } catch (e) {}
    title.textContent = "Premium ativo";
    desc.textContent = "Pagamento confirmado. Seu Premium vale até " + new Date(until).toLocaleDateString("pt-BR") + ".";
    show("ok", "Tudo liberado: <b>ilimitado + Criativo + sem behavior pack + troca de foto</b> por 30 dias. <a href='index.html'><b>Ir converter</b></a>");
    hint.textContent = "Em outro aparelho? Entre com a mesma conta que o Premium aparece lá.";
  }
  function check() {
    var q = new URLSearchParams(location.search);
    var id = q.get("id") || q.get("billing_id") || q.get("billingId");
    if (!id) {
      title.textContent = "Nenhum pagamento para verificar";
      desc.textContent = "Abra esta página pelo botão de retorno do checkout (ela traz o código da cobrança), ou assine de novo.";
      hint.textContent = "";
      return;
    }
    title.textContent = "Verificando pagamento…";
    desc.textContent = "Checando a cobrança " + id + " na AbacatePay…";
    fetch("/api/abacate/status?id=" + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status === "PAID" || j.paid === true) {
          var until = j.premium_until_ms || (Date.now() + 30 * 24 * 3600 * 1000);
          var em = "";
          try { em = localStorage.getItem("rc_pending_email") || j.email || ""; } catch (e) { em = j.email || ""; }
          paidOk(em, until);
        } else {
          title.textContent = "Pagamento ainda pendente";
          desc.textContent = "Status atual: " + (j.status || "PENDENTE") + ".";
          show("", "O Pix/cartão ainda não compensou. Aguarde 1–2 minutos e clique em “Verificar de novo”. Se você já pagou e passou de 10 min, chame o suporte com o código " + id + ".");
          hint.textContent = "";
        }
      })
      .catch(function () {
        title.textContent = "Não consegui verificar agora";
        show("err", "Falha de conexão com o servidor. Clique em “Verificar de novo”.");
      });
  }
  document.getElementById("retry").addEventListener("click", check);
  check();
})();
