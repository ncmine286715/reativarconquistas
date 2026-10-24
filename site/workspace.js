/* Worldify — shell do editor (barra, ferramentas, visualização, painel, status).
   Apenas reorganiza os nós existentes: IDs, handlers e portões de plano continuam intactos.
   O shell só liga com um mundo carregado; sem mundo, a página fica como antes. */
(function () {
  'use strict';
  var byId = function (id) { return document.getElementById(id); };
  var ORDER = { wfAchievements: 10, accFree: 20, accPlayer: 30, accPrem: 40, accPacks: 50, accChunks: 60, wfInformation: 70, wfBuilder: 80, wfExport: 90 };
  var GROUPS = { 10: 'Mundo', 30: 'Jogador', 40: 'Regras', 50: 'Pacotes', 60: 'Mapa', 80: 'Criar', 90: 'Finalizar' };
  var LABELS = { accPacks: 'Add-ons', wfInformation: 'Diagnóstico' };

  function start() {
    var api = window.WF_editor, form = byId('form');
    if (!api || !form || form.getAttribute('data-ws-ready')) return;
    form.setAttribute('data-ws-ready', '1');

    /* ---- barra superior ---- */
    var bar = document.createElement('header'); bar.className = 'wf-ws-bar';
    bar.innerHTML = '<div class="wf-ws-id"><img src="mc/item/grass_block.png" width="36" height="36" alt=""><div><strong id="wsName">Seu mundo</strong><small id="wsMeta">Cópia de trabalho</small></div></div>' +
      '<span class="wf-ws-chip" id="wsChip"><i></i>Editando uma cópia · o original não muda</span>' +
      '<div class="wf-ws-actions"><button type="button" class="btn-ghost" id="wsReplace">Trocar mundo</button><button type="button" class="primary" id="wsExport">Exportar</button></div>';
    var main = document.createElement('section'); main.className = 'wf-ws-main'; main.setAttribute('aria-label', 'Visualização do mundo');
    var status = document.createElement('footer'); status.className = 'wf-ws-status';
    status.innerHTML = '<span id="wsCount">Nenhuma alteração</span><span class="wf-ws-sep" aria-hidden="true"></span><span id="wsPlan" class="wf-ws-plan"></span><button type="button" id="wsExport2">Revisar e exportar ›</button>';
    form.insertBefore(bar, form.firstChild);
    form.insertBefore(main, byId('accFile').nextSibling);
    form.appendChild(status);

    /* ---- painel Exportar ---- */
    var exp = api.add('wfExport', 'Exportar', 'export', 'Nova cópia', 'Revise o que mudou e baixe uma nova cópia do mundo.');
    exp.body.insertAdjacentHTML('beforeend',
      '<h4 class="wf-ws-h">Alterações nesta sessão</h4><ul id="wsChanges" class="wf-ws-list"><li class="muted">Nenhuma alteração além do padrão.</li></ul>' +
      '<h4 class="wf-ws-h">Validação</h4><ul id="wsChecks" class="wf-ws-list"></ul>' +
      '<div id="wsExportActions" class="wf-ws-export"></div>');
    var actions = exp.body.querySelector('#wsExportActions');
    ['accept', 'submit', 'diagnose'].forEach(function (id) { var n = id === 'accept' ? (byId('accept') && byId('accept').closest('label')) : byId(id); if (n) actions.appendChild(n); });
    var diag = byId('diagnose'); if (diag) diag.removeAttribute('style');
    var wfChanges = byId('wfChanges'); if (wfChanges) wfChanges.hidden = true;

    /* ---- World Studio (já existente) ---- */
    var builder = api.nav.querySelector('a.wf-editor-tool'); if (builder) { builder.id = 'wfBuilder'; builder.querySelector('span').textContent = 'World Studio ↗'; }

    /* ---- ordem, grupos e nomes ---- */
    function arrange() {
      Array.prototype.forEach.call(api.nav.children, function (el) {
        var id = el.id === 'wfBuilder' ? 'wfBuilder' : el.getAttribute('aria-controls');
        if (!id || !ORDER[id]) return;
        el.style.order = ORDER[id];
        if (LABELS[id]) { var sp = el.querySelector('span'); if (sp) sp.textContent = LABELS[id]; }
      });
      if (!api.nav.querySelector('.wf-ws-label')) Object.keys(GROUPS).forEach(function (o) {
        var l = document.createElement('span'); l.className = 'wf-ws-label'; l.textContent = GROUPS[o]; l.style.order = (+o) - 1; l.setAttribute('aria-hidden', 'true'); api.nav.appendChild(l);
      });
    }
    arrange();
    Object.keys(LABELS).forEach(function (id) { var h = document.querySelector('#' + id + ' .wf-panel-heading h3'); if (h) h.textContent = LABELS[id]; });

    /* ---- resumo de alterações (diferença para o estado logo após o diagnóstico) ---- */
    var fields = function () { return Array.prototype.filter.call(form.querySelectorAll('input,select,textarea'), function (el) { return el.type !== 'file' && el.id !== 'accept' && !el.closest('.wf-tool-dock') && !el.closest('.wf-folder-input'); }); };
    var snap = null;
    function val(el) { return el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? '1' : '0') : el.value; }
    function take() { snap = new Map(); fields().forEach(function (el) { snap.set(el, val(el)); }); render(); }
    function labelOf(el) {
      var l = el.closest('label'); var b = l && l.querySelector('b');
      var t = (b && b.textContent) || (l && l.firstChild && l.textContent) || (el.id && (document.querySelector('label[for="' + el.id + '"]') || {}).textContent) || el.getAttribute('aria-label') || el.name || el.id;
      return String(t || 'Opção').replace(/\s+/g, ' ').trim().slice(0, 60);
    }
    function shown(el) { if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'ativado' : 'desativado'; if (el.tagName === 'SELECT') return (el.options[el.selectedIndex] || {}).text || el.value; return el.value || '—'; }
    function render() {
      var list = byId('wsChanges'), n = 0; list.textContent = '';
      if (snap) fields().forEach(function (el) {
        if (!snap.has(el) || snap.get(el) === val(el)) return; n++;
        if (n > 14) return;
        var li = document.createElement('li'); var b = document.createElement('b'); b.textContent = labelOf(el); li.appendChild(b); li.appendChild(document.createTextNode(' → ' + shown(el))); list.appendChild(li);
      });
      if (n > 14) { var more = document.createElement('li'); more.className = 'muted'; more.textContent = '+ ' + (n - 14) + ' outras alterações'; list.appendChild(more); }
      if (!n) { var e = document.createElement('li'); e.className = 'muted'; e.textContent = 'Nenhuma alteração além do padrão.'; list.appendChild(e); }
      byId('wsCount').textContent = n ? n + (n === 1 ? ' alteração' : ' alterações') : 'Nenhuma alteração';
      var checks = byId('wsChecks'); checks.textContent = '';
      var add = function (cls, t) { var li = document.createElement('li'); li.className = cls; li.textContent = t; checks.appendChild(li); };
      add('ok', 'Você baixa uma nova cópia; o arquivo original não é modificado.');
      var ach = byId('reactivateAchievements');
      if (ach && ach.checked) add('warn', 'Conquistas: a cópia vira Sobrevivência sem cheats e remove behavior packs. A liberação final é decisão do Minecraft.');
      var note = byId('compatibilityNotice'); if (note && !note.hidden && note.textContent.trim()) add('warn', note.textContent.trim());
      var acc = byId('accept'); add(acc && acc.checked ? 'ok' : 'warn', acc && acc.checked ? 'Termos aceitos.' : 'Aceite os termos para liberar o download.');
      var q = byId('quotaText'); byId('wsPlan').textContent = q ? q.textContent.trim().slice(0, 80) : '';
    }
    form.addEventListener('change', render); form.addEventListener('input', render);
    document.addEventListener('wf-world-diagnosed', function () { setTimeout(take, 900); });

    /* ---- liga/desliga ---- */
    function setLoaded(on, detail) {
      var ws = form.getAttribute('data-workspace') || 'edit';
      var active = on && ws !== 'paint' && ws !== 'convert';
      form.classList.toggle('wf-ws-on', active);
      document.body.classList.toggle('wf-ws-active', active);
      if (!on) { snap = null; return; }
      var nm = detail && detail.file ? detail.file.name : 'Seu mundo';
      byId('wsName').textContent = nm.replace(/\.(mcworld|zip|mctemplate|mctemplet)$/i, '');
      var size = detail && detail.file ? (detail.file.size / 1048576).toFixed(detail.file.size > 1048576 ? 1 : 2) + ' MB' : '';
      byId('wsMeta').textContent = [nm.split('.').pop().toUpperCase(), size].filter(Boolean).join(' · ');
      var mp = byId('mapPreview'); if (mp && mp.parentNode !== main) main.appendChild(mp);
      var cards = form.querySelector('.wf-world-actions'); if (cards && cards.parentNode !== main) main.insertBefore(cards, main.firstChild);
      render();
    }
    document.addEventListener('wf-world-selected', function (e) { setTimeout(function () { setLoaded(!!e.detail.file, e.detail); }, 0); });
    document.addEventListener('wf-workspace', function (e) { setTimeout(function () { setLoaded(document.body.classList.contains('wf-world-loaded'), null); }, 0); });

    byId('wsReplace').onclick = function () { var f = byId('file'); if (f) f.click(); };
    var openExport = function () { api.open('wfExport'); render(); var t = api.tray; if (t && t.scrollIntoView) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    byId('wsExport').onclick = openExport; byId('wsExport2').onclick = openExport;
    var cap = byId('quotaText'); if (cap && window.MutationObserver) new MutationObserver(render).observe(cap, { childList: true, characterData: true, subtree: true });
  }

  if (window.WF_editor) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start(); }
  else document.addEventListener('wf-editor-ready', start);
})();
