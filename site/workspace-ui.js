/* Shared, framework-free navigation and UI wiring for the existing Bedrock tools. */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text && text !== "—" ? text : (fallback || "");
  }
  function formatSize(bytes) {
    bytes = Math.max(0, +bytes || 0);
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  }
  function iconLink(href, icon, label, id) {
    return '<a href="' + href + '" data-workspace-target="' + id + '"><span class="rc-sidebar-icon" aria-hidden="true">' + icon + '</span>' + label + '</a>';
  }
  function openOnlySection(target) {
    var details = target && target.closest("details");
    document.querySelectorAll("#form details.acc").forEach(function (section) { section.open = section === details; });
    if (details && !details.open) details.open = true;
  }
  function navigateToWorkspaceTarget(link, nav) {
    var target = $(link.getAttribute("data-workspace-target"));
    if (!target) return false;
    openOnlySection(target);
    if (nav) nav.querySelectorAll("a[aria-current]").forEach(function (item) { item.removeAttribute("aria-current"); });
    link.setAttribute("aria-current", "page");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  function buildEditorShell() {
    var converter = $("converter");
    if (!converter || !converter.parentElement || $("rcWorkspaceHeader")) return;
    var parent = converter.parentElement;
    parent.classList.add("rc-editor-layout");

    var heading = document.createElement("section");
    heading.className = "rc-workspace-header";
    heading.id = "rcWorkspaceHeader";
    heading.setAttribute("aria-label", "Mundo e conta atuais");
    heading.innerHTML = '<div class="rc-world-current"><img src="mc/item/grass_block.png" alt=""><div><strong id="rcCurrentWorld">Nenhum mundo carregado</strong><span id="rcCurrentWorldMeta">O arquivo permanece neste navegador</span></div></div>' +
      '<div class="rc-workspace-actions"><details class="rc-plan-popover" id="rcPlanPopover"><summary aria-label="Ver plano e crédito de mundo"><span>Plano</span><strong id="rcPlanLabel">Verificando…</strong></summary><div><b>Seu acesso</b><p id="rcPlanDescription">Consultando o catálogo do servidor.</p><div id="rcBalanceLine" hidden><span class="rc-balance-number" id="rcBalanceNumber">0</span> créditos de mundo</div><p><a class="btn-ghost" href="planos.html">Ver planos</a></p><p><a href="minha-conta.html">Minha conta e pagamentos</a></p></div></details><button type="button" class="btn-ghost" id="rcBackupShortcut">Criar backup</button><button type="button" class="btn-ghost" id="rcChangeWorld">Trocar mundo</button></div>';
    parent.insertBefore(heading, converter);

    var sidebar = document.createElement("nav");
    sidebar.className = "rc-workspace-sidebar";
    sidebar.setAttribute("aria-label", "Ferramentas do mundo");
    sidebar.innerHTML = '<p class="rc-sidebar-caption">Este mundo</p>' +
      iconLink("#worldInfo", "⌂", "Visão geral", "worldInfo") +
      '<p class="rc-sidebar-caption">Ferramentas</p>' +
      iconLink("#accFree", "✦", "Conquistas e ajustes", "accFree") +
      iconLink("#accPlayer", "♙", "Jogador", "accPlayer") +
      iconLink("#accPrem", "▦", "Mundo", "accPrem") +
      iconLink("#accPacks", "▤", "Addons", "accPacks") +
      iconLink("#backupPanel", "◫", "Backups", "backupPanel") +
      '<a href="chunks.html"><span class="rc-sidebar-icon" aria-hidden="true">⌗</span>Restaurar chunks</a>' +
      '<a href="builder-lab.html"><span class="rc-sidebar-icon" aria-hidden="true">▧</span>Builder 3D</a>' +
      '<a href="ferramentas.html"><span class="rc-sidebar-icon" aria-hidden="true">↗</span>Biblioteca</a>';
    parent.insertBefore(sidebar, converter);

    sidebar.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("a[data-workspace-target]");
      if (!link) return;
      if (!navigateToWorkspaceTarget(link, sidebar)) return;
      event.preventDefault();
    });

    var change = $("rcChangeWorld");
    if (change) change.addEventListener("click", function () { var input = $("file"); if (input) input.click(); });
    var backup = $("rcBackupShortcut");
    if (backup) backup.addEventListener("click", function () {
      var panel = $("backupPanel"), save = $("saveBackup");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "center" });
      if (save && !save.disabled) save.focus({ preventScroll: true });
    });
  }

  function buildMobileNav() {
    if ($("rcMobileNav")) return;
    var path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    var isHome = path === "" || path === "index.html";
    var nav = document.createElement("nav");
    nav.className = "rc-mobile-nav";
    nav.id = "rcMobileNav";
    nav.setAttribute("aria-label", "Navegação principal");
    nav.innerHTML = path === "builder-lab.html" ? builderNavMarkup() : publicNavMarkup(path, isHome);
    document.body.appendChild(nav);
    nav.addEventListener("click", function (event) {
      var builderLink = event.target.closest && event.target.closest("a[data-builder-target]");
      if (builderLink) {
        event.preventDefault();
        var builderTarget = $(builderLink.getAttribute("data-builder-target"));
        if (builderTarget && builderTarget.closest(".controls") && !document.querySelector(".editor.rc-builder-controls-open")) {
          var openControls = $("rcBuilderControlsToggle");
          if (openControls) openControls.click();
        }
        if (builderTarget) builderTarget.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      var link = event.target.closest && event.target.closest("a[data-workspace-target]");
      if (!link || !document.body.classList.contains("rc-workspace-active")) return;
      if (!navigateToWorkspaceTarget(link, nav)) return;
      event.preventDefault();
    });
  }

  function publicNavMarkup(path, isHome) {
    return '<a href="index.html"' + (isHome ? ' aria-current="page"' : '') + '><span aria-hidden="true">⌂</span>Início</a>' +
      '<a href="ferramentas.html"' + (path === "ferramentas.html" ? ' aria-current="page"' : '') + '><span aria-hidden="true">▦</span>Ferramentas</a>' +
      '<a href="planos.html"' + (path === "planos.html" ? ' aria-current="page"' : '') + '><span aria-hidden="true">◇</span>Planos</a>' +
      '<a href="minha-conta.html"' + (path === "minha-conta.html" ? ' aria-current="page"' : '') + '><span aria-hidden="true">♙</span>Conta</a>';
  }

  function builderNavMarkup() {
    return '<a href="#preview" data-builder-target="preview" aria-current="page"><span aria-hidden="true">▧</span>Vista 3D</a>' +
      '<a href="#worldMap" data-builder-target="worldMap"><span aria-hidden="true">⌗</span>Mapa</a>' +
      '<a href="#placementControls" data-builder-target="placementControls"><span aria-hidden="true">↔</span>Posição</a>' +
      '<a href="#exportControls" data-builder-target="exportControls"><span aria-hidden="true">↓</span>Exportar</a>';
  }

  function workspaceNavMarkup() {
    return '<a href="#worldInfo" data-workspace-target="worldInfo" aria-current="page"><span aria-hidden="true">⌂</span>Visão geral</a>' +
      '<a href="#accFree" data-workspace-target="accFree"><span aria-hidden="true">✦</span>Ferramentas</a>' +
      '<a href="#backupPanel" data-workspace-target="backupPanel"><span aria-hidden="true">◫</span>Backup</a>' +
      '<a href="minha-conta.html"><span aria-hidden="true">♙</span>Conta</a>';
  }

  function activateWorkspace(active) {
    document.body.classList.toggle("rc-workspace-active", !!active);
    var nav = $("rcMobileNav");
    if (!nav) return;
    var path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    nav.innerHTML = active ? workspaceNavMarkup() : publicNavMarkup(path, path === "index.html");
  }

  function watchFileValidation() {
    var status = $("status"), fileInput = $("file"), fileName = $("fileName");
    if (!status || !fileInput) return;
    var pendingSelection = false;
    var selectedWorldFile = null;
    function inspectStatus() {
      if (!pendingSelection) return;
      var message = String(status.textContent || "").toLocaleLowerCase("pt-BR");
      if (message.indexOf("arquivo permitido") >= 0 || message.indexOf("mundo detectado") >= 0) {
        pendingSelection = false;
        activateWorkspace(true);
        openOnlySection($("accFile"));
        updateWorldHeader();
      } else if (/formato não suportado|excede|excedeu|permite até|não foi possível verificar|está vazio/.test(message)) {
        pendingSelection = false;
        activateWorkspace(false);
      }
    }
    fileInput.addEventListener("change", function () {
      pendingSelection = true;
      selectedWorldFile = fileInput.files && fileInput.files[0] || null;
      if (!selectedWorldFile) activateWorkspace(false);
      if (fileName && !fileName.hidden) updateWorldHeader();
      window.setTimeout(inspectStatus, 80);
    });
    var drop = $("drop");
    if (drop) drop.addEventListener("drop", function (event) {
      pendingSelection = true;
      selectedWorldFile = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0] || null;
      window.setTimeout(inspectStatus, 80);
    });
    window.RC_getSelectedWorldFile = function () { return selectedWorldFile; };
    new MutationObserver(inspectStatus).observe(status, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  function updateWorldHeader() {
    var input = $("file"), file = input && input.files && input.files[0] || (window.RC_getSelectedWorldFile && window.RC_getSelectedWorldFile());
    var world = $("rcCurrentWorld"), meta = $("rcCurrentWorldMeta");
    if (!world || !meta || !file) return;
    var detected = safeText($("wiName") && $("wiName").textContent, "");
    world.textContent = detected || file.name || "Mundo Bedrock";
    meta.textContent = formatSize(file.size) + " · arquivo local · original preservado";
  }

  function updateEntitlement(ent) {
    var label = $("rcPlanLabel"), description = $("rcPlanDescription"), balanceLine = $("rcBalanceLine"), balanceNumber = $("rcBalanceNumber");
    if (!label || !description) return;
    if (!ent || (ent.status !== "ready" && ent.status !== "unauthenticated")) {
      label.textContent = "Indisponível";
      description.textContent = "Não foi possível consultar os benefícios agora. Tente novamente em Minha conta.";
      if (balanceLine) balanceLine.hidden = true;
      return;
    }
    label.textContent = ent.plan_label || (ent.plan === "free" ? "Gratuito" : ent.plan);
    var limit = ent.max_file_mb == null ? "sem limite comercial" : String(ent.max_file_mb).replace(".", ",") + " MB por mundo";
    var expires = ent.expires_at ? " · ativo até " + new Date(ent.expires_at).toLocaleDateString("pt-BR") : "";
    description.textContent = limit + expires + (ent.status === "unauthenticated" ? " · sem conta" : "");
    var worldCredits = Math.max(0, +ent.world_credits || 0);
    if (balanceLine && balanceNumber) {
      balanceLine.hidden = worldCredits <= 0;
      balanceNumber.textContent = String(worldCredits);
    }
  }

  function wireToolLibrary() {
    var grid = $("rcToolGrid");
    if (!grid) return;
    var buttons = Array.prototype.slice.call(document.querySelectorAll("[data-tool-filter]"));
    var search = $("rcToolSearch"), empty = $("rcToolEmpty"), count = $("rcToolCount"), active = "todas";
    function norm(value) {
      return String(value || "").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    function paint() {
      var query = norm(search && search.value), visible = 0;
      grid.querySelectorAll("[data-tool-card]").forEach(function (card) {
        var category = norm(card.getAttribute("data-category")), text = norm(card.textContent), match = (active === "todas" || category.split(/\s+/).indexOf(active) >= 0) && (!query || text.indexOf(query) >= 0);
        card.hidden = !match;
        if (match) visible++;
      });
      if (empty) empty.hidden = visible > 0;
      if (count) count.textContent = String(visible) + (visible === 1 ? " ferramenta" : " ferramentas");
    }
    buttons.forEach(function (button) { button.addEventListener("click", function () {
      active = button.getAttribute("data-tool-filter") || "todas";
      buttons.forEach(function (other) { other.setAttribute("aria-pressed", other === button ? "true" : "false"); });
      paint();
    }); });
    if (search) search.addEventListener("input", paint);
    grid.addEventListener("click", function (event) {
      var link = event.target.closest && event.target.closest("[data-tool-id]");
      if (link && window.RC_pay && window.RC_pay.track) window.RC_pay.track("tool_view", { tool_id: link.getAttribute("data-tool-id"), category: link.getAttribute("data-tool-category") || "" });
    });
    paint();
  }

  function wireBuilderMobileControls() {
    var editor = document.querySelector(".editor"), controls = document.querySelector(".controls");
    if (!editor || !controls || $("rcBuilderControlsToggle")) return;
    controls.id = controls.id || "rcBuilderControls";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "rc-builder-controls-toggle";
    button.id = "rcBuilderControlsToggle";
    button.setAttribute("aria-controls", controls.id);
    button.setAttribute("aria-expanded", "false");
    button.textContent = "Controles";
    editor.parentElement.insertBefore(button, editor);
    var close = document.createElement("button");
    close.type = "button";
    close.className = "rc-builder-sheet-close";
    close.textContent = "Fechar controles";
    controls.insertBefore(close, controls.firstChild);
    function toggleControls(force) {
      var open = typeof force === "boolean" ? force : !editor.classList.contains("rc-builder-controls-open");
      editor.classList.toggle("rc-builder-controls-open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.textContent = open ? "Fechar controles" : "Controles";
      if (!open) button.focus();
    }
    button.addEventListener("click", function () {
      toggleControls();
    });
    close.addEventListener("click", function () { toggleControls(false); });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !editor.classList.contains("rc-builder-controls-open")) return;
      toggleControls(false);
    });
  }

  function wireTheme() {
    var root = document.documentElement;
    document.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-rc-theme-toggle]");
      if (!button) return;
      event.preventDefault();
      var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("rc_theme", next); } catch (e) {}
      document.querySelectorAll(".theme-btn").forEach(function (item) { item.setAttribute("aria-pressed", next === "dark" ? "true" : "false"); });
    });
  }

  function init() {
    buildEditorShell();
    buildMobileNav();
    watchFileValidation();
    wireToolLibrary();
    wireBuilderMobileControls();
    wireTheme();
    var fileName = $("fileName");
    if (fileName) new MutationObserver(updateWorldHeader).observe(fileName, { childList: true, subtree: true, characterData: true, attributes: true });
    if (window.RC_entitlements) {
      updateEntitlement(window.RC_entitlements.state());
      window.RC_entitlements.subscribe(updateEntitlement);
      window.RC_entitlements.load().then(updateEntitlement).catch(function () { updateEntitlement(window.RC_entitlements.state()); });
    }
    if ((location.pathname.split("/").pop() || "").toLowerCase() === "planos.html" && window.RC_pay && window.RC_pay.track) window.RC_pay.track("pricing_opened");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
