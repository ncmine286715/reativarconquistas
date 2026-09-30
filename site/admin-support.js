(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var base = String((window.RC_CONFIG || {}).WORKER_URL || location.origin || '').replace(/\/+$/, '');
  var statusNames = { received: 'Recebido', in_review: 'Em análise', waiting_customer: 'Aguardando cliente', problem_resolved: 'Resolvido', refund_approved: 'Reembolso aprovado', refund_denied: 'Reembolso negado', refund_completed: 'Reembolso concluído' };
  var reasonNames = { payment_not_granted: 'Pagamento aprovado, plano não liberou', tool_error: 'Erro na ferramenta', incorrect_result: 'Resultado incorreto', download_failed: 'Falha no download', file_rejected: 'Arquivo não aceito', wrong_plan: 'Plano errado', duplicate_purchase: 'Compra duplicada', could_not_use: 'Não consegui usar', cancel: 'Quero cancelar', other: 'Outro' };
  var eventNames = { session_started: 'Sessão iniciada', page_viewed: 'Página visitada', tool_viewed: 'Ferramenta visualizada', checkout_opened: 'Checkout aberto', payment_created: 'Pagamento criado', payment_confirmed: 'Pagamento confirmado pelo servidor', plan_granted: 'Benefício liberado pelo servidor', file_selected: 'Arquivo selecionado', file_analysis_started: 'Análise iniciada', file_analysis_completed: 'Análise concluída', file_analysis_failed: 'Análise falhou', operation_started: 'Operação iniciada', operation_completed: 'Operação concluída', operation_failed: 'Operação falhou', result_generated: 'Resultado gerado', download_requested: 'Download solicitado', download_response_completed: 'Arquivo entregue ao navegador', download_failed: 'Download falhou', client_error: 'Erro técnico do navegador', refund_request_created: 'Solicitação recebida' };
  var selectedCase = '';
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function money(cents) { return ((+cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function when(ms) { return ms ? new Date(+ms).toLocaleString('pt-BR') : '—'; }
  function api(path, options) {
    options = options || {};
    return window.RC_auth.getToken().then(function (token) {
      if (!token) throw new Error('Entre com a conta autorizada.');
      options.headers = options.headers || {}; options.headers.Authorization = 'Bearer ' + token;
      return fetch(base + path, options);
    }).then(function (response) { return response.text().then(function (text) { var data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) {} if (!response.ok) throw Object.assign(new Error(data.error || 'Falha ao consultar o painel.'), { status: response.status }); return data; }); });
  }
  function load() {
    var filter = $('supportAdminFilter').value;
    $('supportAdminRows').innerHTML = '<tr><td colspan="7" class="admin-empty">Atualizando…</td></tr>';
    return api('/api/admin/support' + (filter ? '?status=' + encodeURIComponent(filter) : '')).then(function (data) {
      var cases = data.cases || [];
      $('supportAdminRows').innerHTML = cases.length ? cases.map(function (item) {
        var evidence = item.evidence || {};
        return '<tr><td>' + esc(when(item.created_at)) + '</td><td><b>' + esc(item.email) + '</b><small>' + esc(item.id) + '</small></td><td>' + esc(item.purchase && item.purchase.plan || '—') + '<small>' + esc(money(item.purchase && item.purchase.amount_cents)) + ' · ' + esc(item.purchase && item.purchase.provider || '—') + '</small></td><td>' + esc(item.kind === 'refund' ? 'Reembolso' : 'Suporte') + '<small>' + esc(reasonNames[item.reason] || item.reason) + '</small></td><td>' + (+evidence.operations_completed || 0) + ' concluídas · ' + (+evidence.operations_failed || 0) + ' erros</td><td>' + esc(statusNames[item.status] || item.status) + '</td><td><button type="button" class="btn-ghost" data-case-open="' + esc(item.id) + '">Abrir</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="admin-empty">Nenhuma solicitação neste filtro.</td></tr>';
      Array.prototype.forEach.call(document.querySelectorAll('[data-case-open]'), function (button) { button.addEventListener('click', function () { detail(button.getAttribute('data-case-open')); }); });
    }).catch(function (error) { $('supportAdminRows').innerHTML = '<tr><td colspan="7" class="admin-empty">' + esc(error.message) + '</td></tr>'; });
  }
  function renderTimeline(events) {
    $('supportDetailTimeline').innerHTML = events.length ? events.slice(0, 250).map(function (event) {
      var meta = event.metadata || {};
      var title = eventNames[event.event_type] || event.event_type;
      var detail = [event.tool && ('Ferramenta: ' + event.tool), event.operation_id && ('Operação: ' + event.operation_id), event.file_id && ('Arquivo: ' + event.file_id), meta.file_name && ('Nome: ' + meta.file_name), meta.file_size_bytes && ('Tamanho: ' + Math.round(meta.file_size_bytes / 1024) + ' KB'), meta.file_hash && ('SHA-256: ' + meta.file_hash), meta.error_message && ('Erro: ' + meta.error_message), meta.provider && ('Gateway: ' + meta.provider)].filter(Boolean).join(' · ');
      return '<article class="support-timeline-item"><time>' + esc(when(event.timestamp)) + '</time><b>' + esc(title) + '</b>' + (detail ? '<div>' + esc(detail) + '</div>' : '') + '<details><summary>Metadados</summary><pre>' + esc(JSON.stringify(meta, null, 2)) + '</pre></details></article>';
    }).join('') : '<p class="sub">Não há eventos detalhados registrados para esse período.</p>';
  }
  function detail(id) {
    selectedCase = id; $('supportAdminDetail').hidden = false; $('supportDetailTimeline').textContent = 'Carregando…'; $('supportDetailFiles').textContent = 'Carregando…';
    api('/api/admin/support/detail?id=' + encodeURIComponent(id)).then(function (data) {
      var item = data.case || {}, evidence = item.evidence || {}, purchase = item.purchase || {};
      $('supportDecisionId').value = item.id || id;
      $('supportDetailKind').textContent = item.kind === 'refund' ? 'PEDIDO DE REEMBOLSO' : 'PEDIDO DE SUPORTE';
      $('supportDetailTitle').textContent = item.id + ' · ' + (reasonNames[item.reason] || item.reason);
      $('supportDetailDescription').textContent = item.description || 'Sem descrição.';
      $('supportDetailExpected').textContent = item.expected ? 'Esperava: ' + item.expected : '';
      $('supportDetailActual').textContent = item.actual ? 'Aconteceu: ' + item.actual : '';
      $('supportDetailSummary').innerHTML = '<span><b>Cliente</b>' + esc(item.email) + '</span><span><b>Compra</b>' + esc(purchase.plan || '—') + ' · ' + esc(money(purchase.amount_cents)) + '</span><span><b>Gateway</b>' + esc(purchase.provider || '—') + '</span><span><b>Pagamento</b>Confirmado</span><span><b>Liberação</b>' + (evidence.benefit_granted ? 'Evento registrado' : 'Sem evento vinculado') + '</span><span><b>Uso</b>' + (+evidence.operations_completed || 0) + ' concluídas · ' + (+evidence.operations_failed || 0) + ' falhas</span><span><b>Downloads</b>' + (+evidence.downloads_requested || 0) + ' solicitados</span><span><b>Tags</b>' + esc((evidence.tags || []).join(', ')) + '</span><span><b>Solicitado</b>' + esc(when(item.created_at)) + '</span>';
      var attachments = data.attachments || [];
      $('supportDetailFiles').innerHTML = attachments.length ? attachments.map(function (file) { return '<a href="' + esc(file.data_url) + '" target="_blank" rel="noopener"><img src="' + esc(file.data_url) + '" alt="Anexo de ' + esc(item.id) + '"><small>' + esc(file.name) + ' · ' + esc(Math.round(file.size_bytes / 1024)) + ' KB</small></a>'; }).join('') : '<p class="sub">Nenhum anexo.</p>';
      renderTimeline(data.timeline || []);
      var history = (item.history || []).concat(data.history || []).sort(function (a, b) { return a.at - b.at; });
      $('supportDetailHistory').innerHTML = history.length ? history.map(function (entry) { return '<article class="support-timeline-item"><time>' + esc(when(entry.at)) + '</time><b>' + esc(statusNames[entry.action] || entry.action) + '</b><div>' + esc(entry.actor || 'Cliente') + ' · ' + esc(entry.reason || entry.note || '') + '</div>' + (entry.public_message ? '<small>Cliente: ' + esc(entry.public_message) + '</small>' : '') + '</article>'; }).join('') : '<p class="sub">Sem decisões registradas.</p>';
      $('supportDecisionAction').value = item.status || 'in_review';
      $('supportDecisionReason').value = '';
      $('supportPublicMessage').value = item.public_message || '';
      $('supportRefundAmount').value = item.refund_decision && item.refund_decision.amount_refunded_cents || '';
      $('supportFeeLoss').value = item.refund_decision && item.refund_decision.fee_loss_cents || '';
      $('supportAdminDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (error) { $('supportDetailTimeline').textContent = error.message; });
  }
  $('supportRefresh').addEventListener('click', load);
  $('supportAdminFilter').addEventListener('change', load);
  $('supportDetailClose').addEventListener('click', function () { $('supportAdminDetail').hidden = true; selectedCase = ''; });
  $('supportDecisionForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var button = event.currentTarget.querySelector('button[type="submit"]'), status = $('supportDecisionStatus');
    button.disabled = true; status.hidden = false; status.className = 'status'; status.textContent = 'Registrando decisão…';
    api('/api/admin/support/decision', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ id: $('supportDecisionId').value, action: $('supportDecisionAction').value, reason: $('supportDecisionReason').value, public_message: $('supportPublicMessage').value, amount_refunded_cents: $('supportRefundAmount').value, fee_loss_cents: $('supportFeeLoss').value }) }).then(function () {
      status.className = 'status ok'; status.textContent = 'Decisão registrada no histórico. Se aprovou o reembolso, conclua a devolução pelo painel do gateway e depois marque como concluída.';
      return Promise.all([load(), detail(selectedCase)]);
    }).catch(function (error) { status.className = 'status err'; status.textContent = error.message; }).finally(function () { button.disabled = false; });
  });
  function reveal(user) {
    if (!user) { $('supportAdminGate').hidden = false; $('supportAdminApp').hidden = true; $('supportAdminGateText').textContent = 'Entre com a conta Google autorizada.'; $('supportAdminLogin').hidden = false; return; }
    $('supportAdminGateText').textContent = 'Validando permissão de ' + user.email + '…';
    api('/api/admin/support').then(function () { $('supportAdminGate').hidden = true; $('supportAdminApp').hidden = false; load(); }).catch(function (error) { $('supportAdminGate').hidden = false; $('supportAdminApp').hidden = true; $('supportAdminGateText').textContent = error.status === 403 ? 'Esta conta não tem acesso administrativo.' : error.message; $('supportAdminLogin').hidden = error.status === 403; });
  }
  $('supportAdminLogin').addEventListener('click', function () { window.RC_auth.openModal(); });
  window.RC_auth.onChange(reveal);
})();
