/* ReativaConquistas — Minha conta */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function token() { try { return localStorage.getItem("rc_token") || ""; } catch (e) { return ""; } }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var t = token();
    if (t) opts.headers["Authorization"] = "Bearer " + t;
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var j = {};
        try { j = txt ? JSON.parse(txt) : {}; } catch (e) {}
        if (!res.ok) throw new Error((j && j.error) || ("Erro " + res.status));
        return j;
      });
    });
  }
  function fmtSize(n) {
    n = +n || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(2) + " MB";
  }

  if (!token()) {
    $("needLogin").hidden = false;
    return;
  }
  api("/api/auth/me").then(function (me) {
    $("needLogin").hidden = true;
    $("account").hidden = false;
    $("histCard").hidden = false;
    $("dangerCard").hidden = false;
    $("accEmail").textContent = me.name + " · " + me.email;
    var prem = (me.premium_until_ms || 0) > Date.now();
    $("accPlan").innerHTML = prem
      ? "Premium até <b>" + new Date(me.premium_until_ms).toLocaleDateString("pt-BR") + "</b>"
      : "Grátis (1 conversão por semana)";
    $("planBtn").textContent = prem ? "Ver planos" : "Assinar o Premium";
    if (!prem) $("planBtn").href = "index.html#planos";
    try {
      var arr = JSON.parse(localStorage.getItem("rc_quota") || "[]");
      var now = Date.now(), week = 7 * 24 * 3600 * 1000;
      arr = arr.filter(function (t) { return now - t < week; });
      var left = Math.max(0, 1 - arr.length);
      $("accQuota").textContent = prem ? "Ilimitada (Premium)" : left + " restante esta semana";
    } catch (e) { $("accQuota").textContent = "—"; }
    return api("/api/history");
  }).then(function (h) {
    var items = (h && h.items) || [];
    if (!items.length) {
      $("histBody").innerHTML = "<p class='sub'>Nenhuma conversão registrada nesta conta ainda.</p>";
      return;
    }
    var html = "<table class='hist'><tr><th>Data</th><th>Arquivo</th><th>Modo</th><th>Extras</th></tr>";
    items.forEach(function (it) {
      var ex = [];
      if (it.strip) ex.push("sem behavior");
      if (it.icon) ex.push("ícone novo");
      if (it.rename) ex.push("renomeado");
      html += "<tr><td>" + new Date((+it.at || 0) * 1000).toLocaleDateString("pt-BR") +
        "</td><td class='mono'>" + esc(it.file) + " <span style='color:var(--faint)'>(" + fmtSize(it.size) + ")</span>" +
        "</td><td>" + esc(it.mode === "creative" ? "Criativo" : "Sobrevivência") +
        "</td><td>" + esc(ex.join(", ") || "—") + "</td></tr>";
    });
    $("histBody").innerHTML = html + "</table>";
  }).catch(function () {
    try { localStorage.removeItem("rc_token"); localStorage.removeItem("rc_account"); } catch (e) {}
    $("needLogin").hidden = false;
  });

  $("logoutAll").addEventListener("click", function () {
    if (!window.confirm("Encerrar a sessão em todos os aparelhos, incluindo este?")) return;
    api("/api/auth/logout-all", { method: "POST" }).catch(function () {});
    try { localStorage.removeItem("rc_token"); localStorage.removeItem("rc_account"); } catch (e) {}
    window.location.href = "index.html";
  });

  function delMsg(kind, html) {
    var m = $("delMsg");
    m.hidden = false;
    m.className = "status " + kind;
    m.innerHTML = html;
  }
  $("delGo1").addEventListener("click", function () {
    $("delStep1").hidden = true;
    $("delStep2").hidden = false;
    $("delPass").focus();
  });
  $("delBack").addEventListener("click", function () {
    $("delStep2").hidden = true;
    $("delStep1").hidden = false;
  });
  $("delGo2").addEventListener("click", function () {
    var pw = $("delPass").value || "";
    if (!pw) { $("delPass").focus(); return; }
    if (!window.confirm("Última confirmação: excluir tudo mesmo?")) return;
    api("/api/auth/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw })
    }).then(function () {
      try {
        ["rc_token", "rc_account", "rc_premium", "rc_quota", "rc_pending_email"]
          .forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) {}
      window.location.href = "index.html";
    }).catch(function (err) { delMsg("err", esc(err.message)); });
  });
})();
