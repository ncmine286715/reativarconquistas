/* Guia do Worldify: explicação inicial + acesso permanente em todas as páginas públicas. */
(function () {
  "use strict";

  var KEY = "rc_site_guide_v3_done";
  var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var guides = {
    "index.html": [
      { target: "#accFile > summary", title: "Comece pelo mundo", text: "Envie seu arquivo para ver o mapa. As ferramentas de edição ficam organizadas nas seções abaixo." },
      { target: "#drop", title: "Envie seu mundo", text: "Selecione o arquivo e veja o diagnóstico antes de editar." },
      { target: "#accFree > summary", title: "Ajuste o mundo", text: "Nome, dificuldade, coordenadas e regras do mundo ficam juntos." },
      { target: "#accPlayer > summary", title: "Edite jogador e addons", text: "Inventário e pacotes têm áreas próprias logo abaixo." },
      { target: "#operationActions", title: "Gere a cópia", text: "Confira as mudanças e baixe seu novo mundo." }
    ],
    "chunks.html": [
      { target: "#drop", title: "Abra uma cópia", text: "Escolha o .mcworld ou .zip. A página vai carregar o mapa do mundo." },
      { target: "#selModeBtn", title: "Marque a área", text: "Selecione apenas as chunks problemáticas. O mapa aparece depois da análise do arquivo." },
      { target: "#analyzeBtn", title: "Confira antes de restaurar", text: "Analise a seleção e veja o que pode ser removido daquela área." },
      { target: "#resetBtn", title: "Baixe um novo mundo", text: "A restauração gera uma cópia. Construções e itens nas chunks selecionadas podem desaparecer." }
    ],
    "minha-conta.html": [
      { target: "#box", title: "Sua conta", text: "Entre com Google para ver créditos e acessos vinculados a esta conta." },
      { target: "#actions", title: "Volte à operação", text: "Depois do pagamento, retorne à ferramenta que estava usando e confira se o benefício apareceu." }
    ],
    "sucesso.html": [
      { target: "main", title: "Confira seu acesso", text: "A confirmação da compra aparece aqui. Use Verificar novamente se o pagamento ainda estiver em processamento." }
    ],
    "objetivos.html": [
      { target: "#makeChallenge", title: "Crie um desafio", text: "Escolha um tema e gere uma lista de objetivos para jogar." },
      { target: "#goalForm", title: "Adicione suas metas", text: "Escreva objetivos próprios e marque as tarefas manualmente conforme jogar." },
      { target: "#exportGoals", title: "Guarde o livro", text: "Exporte JSON ou imprima. Esta página não acompanha ações dentro do Minecraft." }
    ]
  };
  var steps = guides[file] || [
    { target: "main", title: "Encontre o que precisa", text: "Esta página reúne informações do serviço. Volte ao Início para escolher uma ferramenta." },
    { target: ".topbar", title: "Volte quando quiser", text: "Use o menu para voltar ao site. O botão Guia do site reabre esta explicação." }
  ];

  var stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "guia-site.css?v=3";
  document.head.appendChild(stylesheet);

  var launcher = document.createElement("button");
  launcher.id = "rcSiteGuideLauncher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Abrir a explicação do site");
  var question = document.createElement("span");
  question.className = "rc-guide-question";
  question.setAttribute("aria-hidden", "true");
  question.textContent = "?";
  var label = document.createElement("span");
  label.textContent = "Guia do site";
  launcher.appendChild(question);
  launcher.appendChild(label);

  var overlay = document.createElement("section");
  overlay.id = "rcSiteGuide";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("aria-label", "Explicação do site pelo Null");
  var shade = document.createElement("div");
  shade.className = "rc-guide-shade";
  var spotlight = document.createElement("div");
  spotlight.className = "rc-guide-spotlight";
  spotlight.hidden = true;
  var card = document.createElement("div");
  card.className = "rc-guide-card";
  var mascot = document.createElement("img");
  mascot.className = "rc-guide-mascot";
  mascot.src = "assets/null-apresenta.png";
  mascot.alt = "Null, o guia do Worldify";
  var balloon = document.createElement("div");
  balloon.className = "rc-guide-balloon";
  var heading = document.createElement("div");
  heading.className = "rc-guide-heading";
  var progress = document.createElement("span");
  progress.className = "rc-guide-progress";
  var close = document.createElement("button");
  close.className = "rc-guide-close";
  close.type = "button";
  close.setAttribute("aria-label", "Fechar explicação");
  close.textContent = "×";
  heading.appendChild(progress);
  heading.appendChild(close);
  var title = document.createElement("h2");
  title.className = "rc-guide-title";
  var text = document.createElement("p");
  text.className = "rc-guide-text";
  text.setAttribute("aria-live", "polite");
  var actions = document.createElement("div");
  actions.className = "rc-guide-actions";
  var back = document.createElement("button");
  back.type = "button";
  back.textContent = "← Voltar";
  var next = document.createElement("button");
  next.type = "button";
  next.className = "rc-guide-next";
  var skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Sair";
  actions.appendChild(back);
  actions.appendChild(next);
  actions.appendChild(skip);
  balloon.appendChild(heading);
  balloon.appendChild(title);
  balloon.appendChild(text);
  balloon.appendChild(actions);
  card.appendChild(mascot);
  card.appendChild(balloon);
  overlay.appendChild(shade);
  overlay.appendChild(spotlight);
  overlay.appendChild(card);
  document.body.appendChild(launcher);
  document.body.appendChild(overlay);

  var index = -1;
  var activeTarget = null;
  var originalScroll = 0;
  var originalDetails = [];
  var updateFrame = 0;

  function positionSpotlight() {
    updateFrame = 0;
    if (index < 0 || !activeTarget || overlay.hidden) return;
    var rect = activeTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var left = Math.max(6, rect.left - 6);
    var top = Math.max(6, rect.top - 6);
    spotlight.style.left = left + "px";
    spotlight.style.top = top + "px";
    spotlight.style.width = Math.max(18, Math.min(window.innerWidth - left - 6, rect.width + 12)) + "px";
    spotlight.style.height = Math.max(18, Math.min(window.innerHeight - top - 6, rect.height + 12)) + "px";
    card.classList.toggle("rc-guide-card-top", rect.top + rect.height / 2 > window.innerHeight * 0.53);
  }
  function schedulePosition() {
    if (updateFrame) return;
    updateFrame = window.requestAnimationFrame(positionSpotlight);
  }
  function targetFor(step) {
    if (!step.target) return null;
    var target = document.querySelector(step.target);
    if (!target) return null;
    var section = target.closest && target.closest("details.acc");
    if (section) section.open = true;
    if (target.hidden || target.closest("[hidden]")) return null;
    return target.getClientRects().length ? target : null;
  }
  function render(i) {
    if (i >= steps.length) { finish(); return; }
    if (i < 0) return;
    if (index < 0) {
      originalScroll = window.scrollY;
      originalDetails = Array.prototype.map.call(document.querySelectorAll('details.acc'), function (section) {
        return { element: section, open: section.open };
      });
    }
    index = i;
    var step = steps[index];
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    mascot.src = index === 0 ? "assets/null-apresenta.png" : "assets/null-guia.png";
    title.textContent = step.title;
    text.textContent = step.text;
    progress.textContent = "PASSO " + (index + 1) + " DE " + steps.length;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? "Concluir" : "Próximo →";
    activeTarget = targetFor(step);
    shade.hidden = !!activeTarget;
    spotlight.hidden = !activeTarget;
    card.classList.remove("rc-guide-card-top");
    if (activeTarget) {
      activeTarget.scrollIntoView({ behavior: "smooth", block: "center" });
      schedulePosition();
      window.setTimeout(schedulePosition, 360);
    }
    next.focus();
  }
  function finish() {
    if (index < 0) return;
    index = -1;
    activeTarget = null;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    spotlight.hidden = true;
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
    originalDetails.forEach(function (item) { item.element.open = item.open; });
    originalDetails = [];
    window.scrollTo({ top: originalScroll, behavior: "smooth" });
    launcher.focus();
  }
  launcher.addEventListener("click", function () { render(0); });
  close.addEventListener("click", finish);
  skip.addEventListener("click", finish);
  shade.addEventListener("click", finish);
  back.addEventListener("click", function () { if (index > 0) render(index - 1); });
  next.addEventListener("click", function () { render(index + 1); });
  window.addEventListener("scroll", schedulePosition, { passive: true });
  window.addEventListener("resize", schedulePosition);
  document.addEventListener("keydown", function (event) {
    if (index < 0) return;
    if (event.key === "Escape") { event.preventDefault(); finish(); }
    else if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); render(index - 1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); render(index + 1); }
    else if (event.key === "Tab") {
      var controls = Array.prototype.slice.call(card.querySelectorAll("button:not([disabled])"));
      var first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  // Help remains available from the launcher; never interrupt the upload flow.
})();
