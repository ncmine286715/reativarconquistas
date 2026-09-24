/* Guia do ReativaConquistas: explicação inicial + acesso permanente em todas as páginas públicas. */
(function () {
  "use strict";

  var KEY = "rc_site_guide_v2_done";
  var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var guides = {
    "index.html": [
      { target: "#toolNav", title: "Escolha sua ferramenta", text: "As funções ficam separadas por assunto. Toque em uma categoria para ir direto até ela; você pode explorar antes de enviar o mundo." },
      { target: "#drop", title: "Abra seu mundo", text: "Selecione um .mcworld, .zip ou level.dat. O site analisa a cópia aqui no navegador e mostra o diagnóstico antes de qualquer edição." },
      { target: "#diffOpt", title: "Dificuldade", text: "Escolha Pacífico, Fácil, Normal ou Difícil. Se quiser conservar o valor do mundo, mantenha a opção atual." },
      { target: "#coordOpt", title: "Coordenadas", text: "Ligue ou desligue a exibição de XYZ sem alterar as outras configurações." },
      { target: "#renameOpt", title: "Nome do mundo", text: "Renomeie a cópia que será baixada. O arquivo original continua com você." },
      { target: "#keepOpt", title: "Manter inventário", text: "Escolha se o jogador conserva os itens após morrer. O requisito de plano aparece antes de gerar a cópia." },
      { target: "#modeOpt", title: "Modo de jogo", text: "Manter o modo atual é grátis. Para mudar para Sobrevivência, Criativo ou Aventura, confira o plano indicado." },
      { target: "#hardcoreOpt", title: "Recuperar Hardcore", text: "Esta ferramenta só atua quando o marcador Hardcore existe. Faça backup e confira o resultado no jogo." },
      { target: "#accPacks > summary", title: "Addons em seu lugar", text: "Coloque ou remova pacotes aqui. Behavior packs podem impedir conquistas; o diagnóstico avisa quando encontrar um." },
      { target: "#accPlayer > summary", title: "Inventário do jogador", text: "Edite itens, equipamento e experiência nesta seção, separada das regras do mundo." },
      { target: "#accExplore > summary", title: "Mapa e proteção", text: "Depois do upload, use mapa 2D, comparação e backups locais para conhecer e proteger o mundo." },
      { target: "#operationActions", title: "Conquistas e download", text: "Revise os ajustes, aceite os termos e gere uma nova cópia. Esta etapa também prepara as flags de conquistas." },
      { target: "#toolChunks", title: "Restaurar chunks", text: "Se uma região estiver corrompida, abra a ferramenta própria para selecionar e revisar as chunks antes de regenerar." },
      { target: "#toolBuilder", title: "Construtor 3D", text: "Abra o Builder para posicionar uma .mcstructure no terreno e exportar outra cópia do mundo." },
      { target: "#planos h2", title: "Limites e planos", text: "Veja o custo e o limite de cada opção antes de comprar. O botão Guia do site reabre este tour quando precisar." }
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
  stylesheet.href = "guia-site.css?v=2";
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
  mascot.alt = "Null, o guia do ReativaConquistas";
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
    if (index < 0) originalScroll = window.scrollY;
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
  try {
    if (file !== "builder-lab.html" && !localStorage.getItem(KEY)) setTimeout(function () { if (index < 0) render(0); }, 900);
  } catch (e) { if (file !== "builder-lab.html") setTimeout(function () { if (index < 0) render(0); }, 900); }
})();
