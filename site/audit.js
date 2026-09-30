/* Structured, privacy-minimal usage evidence. Money and entitlement events are server-only. */
(function () {
  'use strict';
  var base = String((window.RC_CONFIG || {}).WORKER_URL || location.origin || '').replace(/\/+$/, '');
  var sessionId = '';
  try { sessionId = sessionStorage.getItem('wf_audit_session') || ''; } catch (e) {}
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(sessionId)) {
    sessionId = 'SES_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now() + Math.random().toString(36).slice(2));
    try { sessionStorage.setItem('wf_audit_session', sessionId); } catch (e) {}
  }
  var context = { operation_id: '', file_id: '', tool: '' }, sentSession = false, lastError = 0;
  function randomId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch (e) {}
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  var eventMap = {
    page_view: 'page_viewed', tool_view: 'tool_viewed', tool_opened: 'tool_opened', pricing_view: 'pricing_viewed',
    plan_view: 'pricing_viewed', checkout_opened: 'checkout_opened', world_analysis_started: 'file_analysis_started',
    world_analysis_completed: 'file_analysis_completed', operation_started: 'operation_started',
    operation_completed: 'operation_completed', operation_failed: 'operation_failed', download_started: 'download_requested',
    download_completed: 'download_response_completed', tool_selected: 'tool_opened',
    support_opened: 'support_opened', refund_form_opened: 'refund_form_opened', refund_form_submitted: 'refund_form_submitted'
  };
  function safeText(value, limit) { return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit || 180); }
  function safeMetadata(data) {
    var allowed = ['plan', 'provider', 'source', 'tool', 'page', 'status', 'phase', 'settings', 'file_name', 'file_extension', 'file_size_bytes', 'file_hash', 'file_id', 'operation_id', 'result_size_bytes', 'error_code', 'error_category', 'error_message', 'http_status', 'reason', 'world_size_mb', 'worlds'];
    var out = {};
    allowed.forEach(function (key) { if (data && data[key] != null) out[key] = typeof data[key] === 'string' ? safeText(data[key], key === 'error_message' ? 300 : 180) : data[key]; });
    return out;
  }
  function submit(eventType, data) {
    if (['session_started', 'page_viewed', 'tool_viewed', 'pricing_viewed'].indexOf(eventType) >= 0) return;
    if (!window.RC_auth || !window.RC_auth.getToken) return;
    var payload = {
      event_type: eventType, session_id: sessionId, purchase_id: safeText(data && data.purchase_id, 180),
      operation_id: safeText(data && data.operation_id || context.operation_id, 120),
      file_id: safeText(data && data.file_id || context.file_id, 100),
      page: location.pathname, tool: safeText(data && data.tool || context.tool, 60),
      app_version: safeText((window.RC_CONFIG || {}).APP_VERSION || 'worldify-static-2026-09-26', 80),
      status: safeText(data && data.status, 40), metadata: safeMetadata(data),
      device: { language: safeText(navigator.language, 40), timezone: safeText(Intl.DateTimeFormat().resolvedOptions().timeZone, 60), screen_resolution: screen.width + 'x' + screen.height }
    };
    window.RC_auth.getToken().then(function (token) {
      if (!token) return;
      return fetch(base + '/api/audit/events', { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + token }, body: JSON.stringify(payload), keepalive: true });
    }).catch(function () {});
  }
  function record(event, data) {
    data = data || {};
    var type = eventMap[event];
    if (!type) return;
    if (data.operation_id) context.operation_id = safeText(data.operation_id, 120);
    if (data.file_id) context.file_id = safeText(data.file_id, 100);
    if (data.tool) context.tool = safeText(data.tool, 60);
    if (type === 'operation_started' && !context.operation_id) context.operation_id = 'OP_' + randomId().slice(0, 18).toUpperCase();
    submit(type, data);
    if (type === 'operation_completed') submit('result_generated', data);
    if (type === 'operation_completed' || type === 'operation_failed' || type === 'download_response_completed') context.operation_id = '';
  }
  function fileSelected(file, tool) {
    if (!file) return;
    var fileId = 'FIL_' + randomId().slice(0, 18).toUpperCase();
    context.file_id = fileId;
    if (tool) context.tool = safeText(tool, 60);
    var name = safeText(String(file.name || 'mundo').split(/[\\/]/).pop(), 100);
    var ext = (name.match(/\.([a-z0-9]{1,10})$/i) || [])[1] || '';
    var metadata = { file_name: name, file_extension: ext.toLowerCase(), file_size_bytes: +file.size || 0, file_id: fileId };
    // Hash only files up to 1 MB so diagnostics never duplicate a large world in memory.
    if (file.size <= 1024 * 1024 && crypto.subtle && crypto.subtle.digest) {
      file.arrayBuffer().then(function (buffer) { return crypto.subtle.digest('SHA-256', buffer); }).then(function (digest) {
        metadata.file_hash = Array.from(new Uint8Array(digest)).map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
        submit('file_selected', metadata);
      }).catch(function () { submit('file_selected', metadata); });
    } else submit('file_selected', metadata);
  }
  document.addEventListener('change', function (event) {
    var target = event.target;
    if (target && target.matches && target.matches('input[type="file"]')) Array.prototype.slice.call(target.files || []).slice(0, 5).forEach(function (file) { fileSelected(file); });
  });
  window.addEventListener('error', function (event) {
    if (Date.now() - lastError < 3000) return;
    lastError = Date.now();
    submit('client_error', { error_code: 'JS_RUNTIME', error_category: 'frontend', error_message: safeText(event.message || 'Erro JavaScript', 240), phase: 'window.error' });
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (Date.now() - lastError < 3000) return;
    lastError = Date.now();
    var reason = event.reason && (event.reason.message || event.reason.name) || 'Promise rejeitada';
    submit('client_error', { error_code: 'UNHANDLED_REJECTION', error_category: 'frontend', error_message: safeText(reason, 240), phase: 'unhandledrejection' });
  });
  function session(user) { if (user && !sentSession) { sentSession = true; submit('session_started', {}); } }
  if (window.RC_auth && window.RC_auth.onChange) window.RC_auth.onChange(session);
  window.WorldifyAudit = { record: record, fileSelected: fileSelected, setContext: function (value) { context = Object.assign(context, value || {}); }, sessionId: sessionId };
})();
