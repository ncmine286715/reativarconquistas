(function () {
  "use strict";

  var app = document.getElementById("adminApp");
  var gate = document.getElementById("adminGate");
  var gateText = document.getElementById("gateText");
  var login = document.getElementById("adminLogin");
  var refresh = document.getElementById("refreshAdmin");

  function base() {
    return String((window.RC_CONFIG || {}).WORKER_URL || location.origin || "").replace(/\/+$/, "");
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function api(path, options) {
    options = options || {};
    return window.RC_auth.getToken().then(function (token) {
      if (!token) throw new Error("Entre com sua conta Google.");
      options.headers = options.headers || {};
      options.headers.Authorization = "Bearer " + token;
      return fetch(base() + path, options);
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (!response.ok) {
          var error = new Error(data.error || "Erro " + response.status);
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }
  function money(cents) {
    return (Number(cents) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function when(ms) {
    return ms ? new Date(Number(ms)).toLocaleString("pt-BR") : "—";
  }
  function planName(plan) {
    return ({ world1: "1 mundo", vip7: "7 dias", vip30: "30 dias", creator: "Criador" })[plan] || plan || "—";
  }
  function sourceName(item) {
    if (item.manual) return "Manual";
    return (item.provider || "depix") + (item.source ? " · " + item.source : "");
  }
  function fillRows(targetId, items) {
    var body = document.getElementById(targetId);
    if (!items.length) {
      body.innerHTML = "<tr><td class='admin-empty' colspan='5'>Nenhum registro neste período.</td></tr>";
      return;
    }
    body.innerHTML = items.map(function (item) {
      return "<tr><td>" + esc(when(item.paid_at || item.at)) + "</td><td><b>" + esc(item.email) + "</b></td><td>" + esc(planName(item.plan)) + "</td><td>" + esc(money(item.amount_cents)) + "</td><td>" + esc(sourceName(item)) + "</td></tr>";
    }).join("");
  }
  function fillManualGrantRows(items) {
    var body = document.getElementById("manualGrantRows");
    if (!items.length) {
      body.innerHTML = "<tr><td class='admin-empty' colspan='5'>Nenhuma liberação manual neste período.</td></tr>";
      return;
    }
    body.innerHTML = items.map(function (item) {
      return "<tr><td>" + esc(when(item.at)) + "</td><td><b>" + esc(item.email) + "</b></td><td>" + esc(planName(item.plan)) + "</td><td>" + esc(item.reason || "—") + "</td><td>" + esc(item.admin || "—") + "</td></tr>";
    }).join("");
  }
  function renderErrors(items) {
    var list = document.getElementById("errorList");
    document.getElementById("errorCount").textContent = items.length;
    if (!items.length) { list.innerHTML = "<p class='sub'>Nenhum erro recente.</p>"; return; }
    list.innerHTML = items.map(function (item) {
      if (item.count) {
        return "<div class='admin-log'><b>" + esc(item.title || "Aviso") + " (" + item.count + "x)</b><span>" + esc(item.msg || "Sem detalhes") + " Ultima: " + esc(when(item.at)) + ".</span></div>";
      }
      return "<div class='admin-log'><b>" + esc(item.step || "erro") + " · " + esc(when(item.at)) + "</b><span>" + esc(item.msg || "Sem detalhes") + "</span></div>";
    }).join("");
  }
  function render(data) {
    gate.hidden = true;
    app.hidden = false;
    var summary = data.summary || {};
    document.getElementById("statPaid").textContent = summary.paid_count || 0;
    document.getElementById("statRevenue").textContent = money(summary.revenue_cents);
    document.getElementById("statConversion").textContent = (summary.conversion_percent || 0) + "%";
    document.getElementById("statAbandoned").textContent = summary.abandoned_count || 0;
    document.getElementById("statPending").textContent = summary.pending_count || 0;
    document.getElementById("purchaseCount").textContent = (data.purchases || []).length;
    document.getElementById("manualGrantCount").textContent = (data.manual_grants || []).length;
    document.getElementById("abandonedCount").textContent = (data.abandoned || []).length;
    fillRows("purchaseRows", data.purchases || []);
    fillManualGrantRows(data.manual_grants || []);
    fillRows("abandonedRows", data.abandoned || []);
    renderErrors(data.errors || []);
  }
  function load() {
    refresh.disabled = true;
    refresh.textContent = "Atualizando…";
    return api("/api/admin/dashboard?days=30").then(render).catch(function (error) {
      app.hidden = true;
      gate.hidden = false;
      gateText.textContent = error.status === 403
        ? "Esta conta Google não está autorizada no painel. Configure ADMIN_EMAILS no Worker."
        : error.message;
    }).then(function () {
      refresh.disabled = false;
      refresh.textContent = "Atualizar dados";
    });
  }

  refresh.addEventListener("click", load);
  login.addEventListener("click", function () { window.RC_auth.openModal(); });
  document.getElementById("grantForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var status = document.getElementById("grantStatus");
    var button = event.currentTarget.querySelector("button[type='submit']");
    button.disabled = true;
    status.hidden = false;
    status.className = "status";
    status.textContent = "Liberando plano…";
    api("/api/admin/grant", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        email: document.getElementById("grantEmail").value,
        plan: document.getElementById("grantPlan").value,
        reason: document.getElementById("grantReason").value
      })
    }).then(function (data) {
      status.className = "status ok";
      status.textContent = data.plan === "world1"
        ? "Crédito liberado. Saldo atual: " + data.world_credits + "."
        : "Plano liberado até " + when(data.premium_until_ms) + ".";
      document.getElementById("grantReason").value = "";
      load();
    }).catch(function (error) {
      status.className = "status err";
      status.textContent = error.message;
    }).then(function () { button.disabled = false; });
  });

  document.getElementById("reconcileForm").addEventListener("submit", function (event) {
    event.preventDefault();
    var status = document.getElementById("reconcileStatus");
    var button = event.currentTarget.querySelector("button[type='submit']");
    button.disabled = true;
    status.hidden = false;
    status.className = "status";
    status.textContent = "Consultando pagamentos diretamente na Depix…";
    api("/api/admin/depix/reconcile", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ id: document.getElementById("reconcileId").value })
    }).then(function (data) {
      status.className = "status ok";
      status.textContent = data.recovered
        ? data.recovered + " pagamento(s) confirmado(s) e VIP liberado."
        : "Nenhum pagamento novo para liberar entre os " + data.checked + " verificado(s).";
      load();
    }).catch(function (error) {
      status.className = "status err";
      status.textContent = error.message;
    }).then(function () { button.disabled = false; });
  });

  window.RC_auth.onChange(function (user) {
    if (!user) {
      app.hidden = true;
      gate.hidden = false;
      gateText.textContent = "Entre com a conta Google autorizada para abrir o painel.";
      login.hidden = false;
      return;
    }
    login.hidden = true;
    gateText.textContent = "Validando permissão de " + user.email + "…";
    load();
  });
})();
