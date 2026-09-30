/* Worldify visual workspace. Existing control nodes and server gates stay intact. */
(function () {
  'use strict';
  function start() {
    var form = document.getElementById('form');
    if (!form) return;
    var byId = function (id) { return document.getElementById(id); };
    var oldMenu = byId('wfEditMenu'), fileSection = byId('accFile');
    var panels = [], active = '', loaded = false;
    var descriptions = {
      'Conquistas': 'Prepare uma cópia em Sobrevivência, sem cheats, para voltar a conquistar.',
      'Mundo': 'Ajuste o nome, a dificuldade e a identidade da sua cópia.',
      'Regras': 'Escolha como o mundo funciona: criaturas, clima, ciclos e inventário.',
      'Jogador': 'Revise seus itens, armadura, experiência e Ender Chest.',
      'Addons': 'Veja os pacotes do mundo e escolha quais manter na cópia.',
      'Chunks': 'Selecione a área no mapa. O Minecraft regenera os chunks apagados pela seed.',
      'Detalhes': 'Confira o diagnóstico do arquivo, os marcadores e as opções do mapa.'
    };
    var nav = document.createElement('nav');
    nav.className = 'wf-editor-dock'; nav.setAttribute('aria-label', 'Ferramentas do mundo');
    var tray = document.createElement('section'); tray.className = 'wf-panel-tray'; tray.hidden = true;
    form.insertBefore(nav, oldMenu); form.insertBefore(tray, oldMenu);
    function panel(id, label, icon, existing, note) {
      var el = existing ? byId(existing) : document.createElement('details');
      el.id = existing || id; el.classList.add('wf-editor-panel'); el.classList.add('acc');
      var summary = el.querySelector('summary');
      if (!summary) { summary = document.createElement('summary'); el.appendChild(summary); }
      summary.textContent = label;
      var body = el.querySelector('.acc-body');
      if (!body) { body = document.createElement('div'); body.className = 'acc-body'; el.appendChild(body); }
      var head = document.createElement('header'); head.className = 'wf-panel-heading';
      var glyph = document.createElement('img'); glyph.src = 'assets/icons/' + icon + '.svg'; glyph.width = 24; glyph.height = 24; glyph.alt = ''; head.appendChild(glyph);
      var title = document.createElement('h3'); title.textContent = label;
      var hint = document.createElement('span'); hint.textContent = note; hint.className = 'wf-access-note';
      var close = document.createElement('button'); close.type = 'button'; close.className = 'wf-panel-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Fechar ' + label); close.onclick = function () { choose(''); button.focus(); };
      head.appendChild(title); head.appendChild(hint); head.appendChild(close); body.insertBefore(head, body.firstChild);
      var description = document.createElement('p'); description.className = 'wf-panel-description'; description.textContent = descriptions[label]; body.insertBefore(description, head.nextSibling);
      tray.appendChild(el); el.hidden = true;
      var button = document.createElement('button'); button.type = 'button'; button.className = 'wf-editor-tool'; button.setAttribute('aria-label', label); button.setAttribute('aria-controls', el.id); button.setAttribute('aria-expanded', 'false'); button.title = label + ' · ' + descriptions[label];
      var img = document.createElement('img'); img.src = 'assets/icons/' + icon + '.svg'; img.width = 32; img.height = 32; img.alt = '';
      var text = document.createElement('span'); text.textContent = label;
      button.appendChild(img); button.appendChild(text); nav.appendChild(button);
      var item = { id: el.id, el: el, body: body, button: button };
      panels.push(item); button.onclick = function () { choose(active === item.id ? '' : item.id); };
      return item;
    }
    function move(selector, destination) { var el = document.querySelector(selector); if (el) destination.body.appendChild(el); }
    var achievement = panel('wfAchievements', 'Conquistas', 'achievement', '', 'Até 10 MB grátis');
    move('#achievementsOpt', achievement);
    move('#operationActions', achievement);
    var world = panel('', 'Mundo', 'world', 'accFree', 'Básico grátis · extras pagos');
    ['#modeOpt', '#hardcoreOpt', '#iconOpt'].forEach(function (s) { move(s, world); });
    panel('', 'Regras', 'rules', 'accPrem', 'Grátis · tempo e inventário pagos');
    panel('', 'Jogador', 'player', 'accPlayer', 'Inventário básico grátis');
    panel('', 'Addons', 'addon', 'accPacks', 'Limites do seu plano');
    panel('', 'Chunks', 'chunks', 'accChunks', 'Até 8 chunks grátis por operação');
    var info = panel('wfInformation', 'Detalhes', 'info', '', 'Diagnóstico local');
    move('#worldInfo', info);
    // Keep the actual diagnosis fields on the world card; technical reports
    // remain in Details. Reparenting preserves seed copying and all IDs.
    var mapPreview = byId('mapPreview');
    var summary = document.createElement('section'); summary.className = 'wf-world-summary'; summary.setAttribute('aria-label', 'Dados do seu mundo');
    var identity = document.createElement('div'); identity.className = 'wf-world-identity';
    identity.innerHTML = '<img src="mc/item/grass_block.png" width="40" height="40" alt=""><div></div>';
    identity.lastChild.appendChild(byId('wiName')); identity.lastChild.appendChild(byId('wiSize'));
    summary.appendChild(identity); summary.appendChild(byId('worldInfo').querySelector('.wi-grid'));
    var secondary = byId('mapSecondaryTools'); mapPreview.insertBefore(summary, secondary);
    var mapTitle = mapPreview.querySelector('.wi-title'); mapTitle.innerHTML = 'Seu mundo <span id="wfMapLoaded" class="wf-map-loaded">Lendo mapa…</span>';
    window.addEventListener('rc-map-ready', function () { byId('wfMapLoaded').textContent = '✓ Carregado'; });
    var cards = document.createElement('nav'); cards.className = 'wf-world-actions'; cards.setAttribute('aria-label', 'Ações rápidas do mundo'); cards.hidden = true;
    cards.innerHTML = '<button type="button" class="wf-world-action wf-action-achievements" id="wfRestoreAchievements"><img src="assets/actions/trophy.svg" width="64" height="64" alt=""><span><small>GRÁTIS ATÉ 10 MB</small><b>Reativar conquistas</b><em>Revise as configurações da sua cópia.</em></span><i aria-hidden="true">›</i></button><a class="wf-world-action" href="builder-lab.html"><img src="assets/actions/build.svg" width="64" height="64" alt=""><span><small>BETA</small><b>Construtor 3D</b><em>Posicione estruturas no seu mundo.</em></span><i aria-hidden="true">›</i></a><button type="button" class="wf-world-action" id="wfManageChunks"><img src="assets/actions/chunks.svg" width="64" height="64" alt=""><span><small>ATÉ 8 CHUNKS GRÁTIS</small><b>Regenerar chunks</b><em>O Minecraft recria a área pela seed.</em></span><i aria-hidden="true">›</i></button>';
    form.insertBefore(cards, nav);
    byId('wfRestoreAchievements').onclick = function () { choose('wfAchievements'); if (tray.scrollIntoView) tray.scrollIntoView({ block: 'nearest' }); };
    byId('wfManageChunks').onclick = function () { choose('accChunks'); if (tray.scrollIntoView) tray.scrollIntoView({ block: 'nearest' }); };
    move('.map-export-tools', info);
    move('#mapPinsList', info);
    var mapTools = document.querySelector('.map-icon-tools'), mapWrap = byId('mapWrap');
    if (mapTools && mapWrap) mapWrap.parentNode.insertBefore(mapTools, mapWrap.nextSibling);
    var zoom = document.createElement('div'); zoom.className = 'wf-map-zoom'; zoom.setAttribute('role','group'); zoom.setAttribute('aria-label','Zoom do mapa'); zoom.appendChild(byId('mapZoomIn')); zoom.appendChild(byId('mapZoomOut')); mapWrap.appendChild(zoom);
    var builder = document.createElement('a'); builder.className = 'wf-editor-tool'; builder.href = 'builder-lab.html'; builder.setAttribute('aria-label', 'Construtor 3D'); builder.title = 'Construtor 3D'; builder.innerHTML = '<img src="assets/icons/build.svg" width="32" height="32" alt=""><span>Construir ↗</span>'; nav.appendChild(builder);
    oldMenu.hidden = true;
    function choose(id) {
      active = id;
      form.setAttribute('data-workspace', id === 'accChunks' ? 'chunks' : 'edit');
      if (id === 'accChunks') {
        byId('reactivateAchievements').checked = false;
        byId('wfChanges').textContent = 'Conquistas desativadas · revisar';
      }
      panels.forEach(function (p) { var selected = p.id === id; p.el.hidden = !selected; p.el.open = selected; p.button.setAttribute('aria-expanded', String(selected)); });
      tray.hidden = !id;
      if (id) {
        var chosen = panels.filter(function (p) { return p.id === id; })[0];
        if (chosen) window.WF_motion(chosen.el);
      }
    }
    window.WF_editor = { open: choose };
    // Existing deep links and payment return paths still find the original nodes.
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]'); if (!link) return;
      var target = byId(link.getAttribute('href').slice(1));
      var owner = panels.filter(function (p) { return target && (p.el === target || p.el.contains(target)); })[0];
      if (owner) choose(owner.id);
    });
    document.addEventListener('wf-workspace', function (e) {
      var name = e.detail.name;
      var dock = document.querySelector('.wf-tool-dock');
      if (name === 'paint' || name === 'convert') byId('converter').insertBefore(dock, byId('wfExtraWorkspace'));
      else if (loaded) form.insertBefore(dock, nav);
      if (name === 'chunks') choose('accChunks');
      else if (name === 'edit') choose('');
    });
    document.addEventListener('wf-world-selected', function (e) {
      loaded = !!e.detail.file;
      document.body.classList.toggle('wf-world-loaded', loaded);
      form.classList.toggle('wf-has-world', loaded);
      cards.hidden = !loaded;
      byId('wfMapLoaded').textContent = 'Lendo mapa…';
      ['wiSeed','wiMode','wiDiff','wiStatus'].forEach(function (id) { byId(id).textContent = '—'; });
      byId('seedCopy').hidden = true;
      if (loaded) byId('wiName').textContent = e.detail.file.name;
      var dock = document.querySelector('.wf-tool-dock');
      if (loaded) {
        form.insertBefore(dock, nav);
        byId('wfWorldTitle').textContent = e.detail.file.name.replace(/\.(mcworld|zip|mctemplate|mctemplet)$/i, '');
        choose(form.getAttribute('data-workspace') === 'chunks' ? 'accChunks' : '');
        fileSection.open = true;
        window.WF_motion(fileSection);
      } else {
        byId('converter').insertBefore(dock, byId('wfExtraWorkspace'));
        byId('wfWorldTitle').textContent = 'Seu próximo mundo.';
        choose('');
      }
    });
    document.addEventListener('wf-world-diagnosed', function (e) {
      var name = e.detail.name; if (name && loaded) byId('wfWorldTitle').textContent = name;
    });
    form.addEventListener('change', function () {
      byId('wfChanges').textContent = byId('reactivateAchievements').checked ? 'Conquistas ativadas · revisar' : 'Conquistas desativadas · revisar';
    });
    byId('wfChanges').onclick = function () { choose('wfAchievements'); };
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href]');
      if (link && /#planos$/.test(link.getAttribute('href'))) document.body.classList.add('wf-show-plans');
    });
    var initial = window.URLSearchParams ? new URLSearchParams(location.search) : null;
    if (initial && initial.get('workspace') === 'chunks') choose('accChunks');
  }
  window.WF_motion = function (el) {
    if (!el || !el.animate || document.documentElement.getAttribute('data-light-mode') === 'true' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    if (el._wfAnimation) el._wfAnimation.cancel();
    el._wfAnimation = el.animate([{ opacity: 0, transform: 'translateY(10px) scale(.985)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
