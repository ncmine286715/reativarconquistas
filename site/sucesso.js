/* ReativaConquistas — página de retorno do pagamento (Depix + AbacatePay) */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  $("back").addEventListener("click", function () { location.href = "index.html"; });
  // Volta do checkout (?id=BILLING_ID): confirma no Worker e mostra.
  try {
    if (window.RC_pay && window.RC_pay.enabled()) window.RC_pay.checkReturn();
  } catch (e) {}
})();
