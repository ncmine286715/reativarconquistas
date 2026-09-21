/* ReativaConquistas — página de retorno do pagamento (Depix + AbacatePay) */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  $("back").addEventListener("click", function () { location.href = "index.html"; });
  // Volta do checkout (?id=BILLING_ID): confirma no Worker e mostra.
  try {
    var run = function () { if (window.RC_pay && window.RC_pay.enabled()) window.RC_pay.checkReturn(); };
    // The Worker now protects checkout status with the Firebase identity.
    // Wait until Firebase restored the Google session before polling.
    if (window.RC_auth && window.RC_auth.onChange) window.RC_auth.onChange(run);
    else run();
  } catch (e) {}
})();
