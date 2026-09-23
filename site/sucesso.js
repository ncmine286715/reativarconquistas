/* ReativaConquistas — página de retorno do pagamento (Depix + AbacatePay) */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  $("back").addEventListener("click", function () { location.href = "index.html"; });
  function showBenefits(ent) {
    var box = $("box");
    if (!box || !ent) return;
    var until = ent.expires_at ? " · Ativo até <b>" + new Date(ent.expires_at).toLocaleDateString("pt-BR") + "</b>" : "";
    var limit = ent.plan === "world1" ? "" + (+ent.max_file_mb) + " MB por mundo · 1 crédito de mundo · " + (+ent.world_credits || 0) + " restante(s)" : (ent.max_file_mb === null ? "sem limite comercial de tamanho" : (+ent.max_file_mb) + " MB por mundo");
    box.innerHTML += "<br><b>Plano atual:</b> " + String(ent.plan_label || ent.plan || "Plano gratuito").replace(/[<>&\"']/g, "") + until + "<br><b>Limite:</b> " + limit + " · <a href='minha-conta.html'>Atualizar benefícios</a>";
  }
  // Volta do checkout (?id=BILLING_ID): confirma no Worker e mostra.
  try {
    var run = function () {
      if (!window.RC_pay || !window.RC_pay.enabled()) return;
      window.RC_pay.checkReturn().then(function (payment) {
        if (!payment || !payment.paid || !window.RC_entitlements) return;
        return window.RC_entitlements.refresh().then(showBenefits).catch(function () {
          var box = $("box");
          if (box) box.innerHTML += "<br>Pagamento confirmado. Não foi possível atualizar os benefícios agora. <a href='minha-conta.html'>Atualize sua conta</a>; não é necessário pagar novamente.";
        });
      });
    };
    // The Worker now protects checkout status with the Firebase identity.
    // Wait until Firebase restored the Google session before polling.
    if (window.RC_auth && window.RC_auth.onChange) window.RC_auth.onChange(run);
    else run();
  } catch (e) {}
})();
