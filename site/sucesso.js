/* Worldify — página de retorno do pagamento (InfinitePay; pagamentos anteriores continuam válidos) */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  var resumeRecord = null, resumeIntent = null;
  try {
    resumeRecord = JSON.parse(sessionStorage.getItem("rc_checkout_resume") || "null");
    if (!resumeRecord || resumeRecord.version !== 1 || Date.now() - +resumeRecord.created_at > 2 * 60 * 60 * 1000) resumeRecord = null;
  } catch (e0) { resumeRecord = null; }
  try { resumeIntent = resumeRecord && window.RC_toolIntents ? window.RC_toolIntents.resolve(resumeRecord.tool) : null; } catch (e1) {}
  var returnHref = resumeIntent && window.RC_toolIntents ? window.RC_toolIntents.returnHref(resumeIntent, true) : "index.html#converter";
  var returnLabel = resumeIntent ? (resumeIntent.href ? "Voltar ao Builder 3D" : "Retomar " + resumeIntent.label) : "Ir converter";
  $("back").addEventListener("click", function () { location.href = returnHref; });
  var toolReturn = $("toolReturn");
  if (toolReturn && resumeIntent) { toolReturn.href = returnHref; toolReturn.textContent = returnLabel; }
  var benefitsShown = false;
  function showBenefits(ent) {
    var box = $("box");
    if (!box || !ent || benefitsShown) return;
    benefitsShown = true;
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
