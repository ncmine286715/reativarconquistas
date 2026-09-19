/* ReativaConquistas — ativação de código Kiwify (estático) */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function show(kind, html) {
    var box = $("box");
    box.hidden = false;
    box.className = "status " + kind;
    box.innerHTML = html;
  }
  // ?codigo=RC-... ativa sozinho (link do e-mail / área de membros)
  try {
    var q = new URLSearchParams(location.search).get("codigo");
    if (q && $("code")) $("code").value = q;
  } catch (e) {}
  $("back").addEventListener("click", function () { location.href = "index.html"; });
  $("go").addEventListener("click", function () {
    var raw = ($("code").value || "").trim();
    if (!raw) { $("code").focus(); return; }
    $("go").disabled = true; $("go").textContent = "Verificando…";
    window.RC_codes.activateCode(raw).then(function (r) {
      $("go").disabled = false; $("go").textContent = "Ativar e converter";
      if (!r.valid) { show("err", "Código inválido. Confira e tente de novo."); return; }
      show("ok", "Código <b>" + r.label + "</b> ativo neste navegador. <a href='index.html#converter'><b>Ir converter</b></a>");
    }).catch(function () {
      $("go").disabled = false; $("go").textContent = "Ativar e converter";
      show("err", "Falha ao validar. Tente de novo.");
    });
  });
  // Volta do checkout Abacate (?id=BILLING_ID): confirma no Worker e mostra.
  // Se não veio de pagamento (sem id e sem Worker), não faz nada.
  try {
    if (window.RC_pay && window.RC_pay.enabled()) window.RC_pay.checkReturn();
  } catch (e) {}
})();
