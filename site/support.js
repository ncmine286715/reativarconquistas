(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var base = String((window.RC_CONFIG || {}).WORKER_URL || location.origin || '').replace(/\/+$/, '');
  var state = { purchases: [], usage: [], files: [] };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function money(cents) { return ((+cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function when(ms) { return ms ? new Date(+ms).toLocaleString('pt-BR') : '—'; }
  function api(path, options) {
    options = options || {};
    return window.RC_auth.getToken().then(function (token) {
      if (!token) throw new Error('Entre na sua conta Google.');
      options.headers = options.headers || {};
      options.headers.Authorization = 'Bearer ' + token;
      return fetch(base + path, options);
    }).then(function (response) {
      return response.text().then(function (text) {
        var data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) {}
        if (!response.ok) throw new Error(data.error || 'Não foi possível completar a solicitação.');
        return data;
      });
    });
  }
  function audit(type, purchaseId, metadata) {
    api('/api/audit/events', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ event_type: type, purchase_id: purchaseId || '', session_id: sessionStorage.getItem('wf_audit_session') || '', page: location.pathname, app_version: 'worldify-static-2026-09-26', metadata: metadata || {} }) }).catch(function () {});
  }
  function reasonLabel(value) { var node = $('supportReason').querySelector('option[value="' + value + '"]'); return node ? node.textContent : value; }
  function renderCases(cases) {
    $('supportCases').innerHTML = cases.length ? cases.map(function (item) {
      return '<article class="support-case"><strong>' + esc(item.kind === 'refund' ? 'Reembolso' : 'Suporte') + ' · ' + esc(reasonLabel(item.reason)) + '</strong><span class="support-status-pill">' + esc(({ received: 'Recebido', in_review: 'Em análise', waiting_customer: 'Precisamos de informações', problem_resolved: 'Resolvido', refund_approved: 'Reembolso aprovado', refund_denied: 'Reembolso negado', refund_completed: 'Reembolso concluído' })[item.status] || item.status) + '</span><small>' + esc(item.id) + ' · enviado em ' + esc(when(item.created_at)) + '</small>' + (item.public_message ? '<small>' + esc(item.public_message) + '</small>' : '') + '</article>';
    }).join('') : '<p class="sub">Você ainda não tem solicitações.</p>';
  }
  function refresh() {
    return api('/api/support/mine').then(function (data) {
      state.purchases = data.purchases || []; state.usage = data.usage || [];
      $('supportPurchase').innerHTML = '<option value="">Sem compra · ajuda com uma ferramenta</option>' + state.purchases.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc((p.plan || 'Compra') + ' · ' + money(p.amount_cents) + ' · ' + when(p.paid_at)) + '</option>'; }).join('');
      renderCases(data.cases || []);
      if (!state.purchases.length) $('supportStatus').textContent = 'Você pode pedir ajuda mesmo sem uma compra. Para reembolso, entre com a conta usada no checkout.';
      return data;
    });
  }
  function refreshTools() {
    var purchase = state.purchases.find(function (item) { return item.id === $('supportPurchase').value; });
    var since = purchase ? purchase.paid_at : 0;
    var rows = state.usage.filter(function (item) { return item.timestamp >= since && item.tool; });
    var tools = Array.from(new Set(rows.map(function (item) { return item.tool; })));
    $('supportTool').innerHTML = '<option value="">Não lembro / não se aplica</option>' + tools.map(function (tool) { return '<option value="' + esc(tool) + '">' + esc(tool) + '</option>'; }).join('');
    $('supportDetailFields').hidden = !['tool_error', 'incorrect_result', 'file_rejected'].includes($('supportReason').value);
  }
  function toDataUrl(file) { return new Promise(function (resolve, reject) { var reader = new FileReader(); reader.onerror = function () { reject(new Error('Não foi possível ler um dos prints.')); }; reader.onload = function () { resolve(String(reader.result || '')); }; reader.readAsDataURL(file); }); }
  $('supportFiles').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    if (files.length > 3 || files.some(function (f) { return !['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 1024 * 1024; }) || files.reduce(function (sum, f) { return sum + f.size; }, 0) > 2 * 1024 * 1024) {
      this.value = ''; state.files = []; $('supportFileNames').textContent = 'Use até 3 imagens PNG, JPG ou WebP, com no máximo 1 MB cada e 2 MB no total.'; return;
    }
    state.files = files;
    $('supportFileNames').textContent = files.map(function (f) { return f.name + ' · ' + (f.size / 1024).toFixed(0) + ' KB'; }).join(' · ');
  });
  $('supportPurchase').addEventListener('change', refreshTools);
  $('supportReason').addEventListener('change', refreshTools);
  $('supportForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = $('supportSubmit'), status = $('supportStatus');
    if (!$('supportPurchase').value && document.querySelector('input[name="kind"]:checked').value === 'refund') { status.hidden = false; status.className = 'status err'; status.textContent = 'Selecione a compra relacionada ao reembolso.'; return; }
    if (state.files.reduce(function (sum, f) { return sum + f.size; }, 0) > 2 * 1024 * 1024) return;
    button.disabled = true; status.hidden = false; status.className = 'status'; status.textContent = 'Enviando sua solicitação…';
    Promise.all(state.files.map(function (file) { return toDataUrl(file).then(function (dataUrl) { return { name: file.name, mime: file.type, data_url: dataUrl }; }); })).then(function (attachments) {
      return api('/api/support/submit', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({
        purchase_id: $('supportPurchase').value,
        kind: document.querySelector('input[name="kind"]:checked').value,
        reason: $('supportReason').value,
        description: $('supportDescription').value,
        expected: $('supportExpected').value,
        actual: $('supportActual').value,
        tool: $('supportTool').value,
        attachments: attachments
      }) });
    }).then(function (result) {
      status.className = 'status ok';
      status.textContent = result.duplicate ? 'Já existe uma solicitação aberta para esta compra (' + result.id + '). Ela está ' + result.status + '.' : 'Solicitação ' + result.id + ' recebida. Você pode acompanhar o status nesta página.';
      if (!result.duplicate) { audit('refund_form_submitted', $('supportPurchase').value, { reason: $('supportReason').value, refund_kind: document.querySelector('input[name="kind"]:checked').value }); $('supportForm').reset(); state.files = []; $('supportFileNames').textContent = ''; }
      return refresh();
    }).catch(function (error) { status.className = 'status err'; status.textContent = error.message || 'Não foi possível enviar. Tente novamente.'; }).finally(function () { button.disabled = false; });
  });
  $('supportPurchase').addEventListener('focus', function () { if (this.value) audit('refund_form_opened', this.value); });
  window.RC_auth.onChange(function (user) {
    if (!user) { $('supportGate').hidden = false; $('supportApp').hidden = true; $('supportGateText').textContent = 'Entre com a mesma conta Google usada na compra.'; $('supportLogin').hidden = false; return; }
    $('supportGate').hidden = true; $('supportApp').hidden = false; $('supportLogin').hidden = true;
    audit('support_opened', '', {});
    refresh().catch(function (error) { $('supportGate').hidden = false; $('supportApp').hidden = true; $('supportGateText').textContent = error.message; $('supportLogin').hidden = false; });
  });
  $('supportLogin').addEventListener('click', function () { window.RC_auth.openModal(); });
})();
