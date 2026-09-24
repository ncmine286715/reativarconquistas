/* Guia do ReativaConquistas: explicação inicial + acesso permanente em todas as páginas públicas. */
(function () {
  "use strict";

  var KEY = "rc_site_guide_v1_done";
  var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var general = [
    { title: "Oi! Eu sou o Null", text: "Vou explicar o ReativaConquistas. O site tem ferramentas para analisar, ajustar e restaurar mundos Minecraft Bedrock. Quando você edita um mundo, recebe um arquivo novo; o original continua com você." },
    { title: "Conversor e ajustes", text: "Na página Início, abra um .mcworld para ver as informações do mundo. Você pode usar as opções disponíveis para ajustar configurações e preparar uma cópia para importar no Minecraft." },
    { title: "Ferramentas para o mapa", text: "Use Restaurar chunks para analisar e selecionar uma área com problema. Use Construtor 3D para visualizar o terreno e posicionar uma construção .mcstructure." },
    { title: "Sua conta e ajuda", text: "O menu do site leva para planos, conta e suporte. Se quiser rever esta explicação, toque no botão Guia do site que fica no canto da tela." }
  ];
  var guides = {
    "index.html": [
      general[0],
      { title: "Abra o conversor", text: "Escolha o arquivo .mcworld na área Editar seu mundo. A análise roda nesta página; confira o resumo antes de escolher qualquer mudança." },
      { title: "Ficha do mundo e mapa", text: "Depois da análise, baixe o passaporte JSON e uma cópia do original. No mapa 2D, marque casas, vilas e portais com pins; eles ficam no navegador. Você também pode baixar o mapa em PNG e os pins em JSON." },
      { title: "Proteja e organize suas cópias", text: "Use Backups locais para guardar uma cópia neste navegador, Comparar mundos para ver diferenças de configuração, e o Livro de objetivos para planejar sua próxima sessão. Esses recursos não enviam o arquivo para o site." },
      { title: "Escolha o que quer fazer", text: "Aqui ficam os ajustes de mundo e jogador. As ferramentas Restaurar chunks e Construtor 3D aparecem mais abaixo nesta página e também no menu." },
      { title: "Baixe e importe a cópia", text: "Confira as opções e baixe o resultado. O arquivo original não é substituído. Para recursos pagos, confira os limites e preços em Planos." },
      { title: "Outras ferramentas", text: "Restaurar chunks serve para regenerar uma área selecionada. Construtor 3D serve para posicionar uma .mcstructure sobre o terreno visitado." }
    ],
    "chunks.html": [
      general[0],
      { title: "Abra uma cópia do mundo", text: "Escolha o arquivo .mcworld ou .zip. A página lê o mapa e mostra as chunks já salvas no mundo." },
      { title: "Marque e analise a área", text: "Selecione no mapa somente as chunks problemáticas e toque em Analisar seleção. Confira a lista de dados que serão removidos antes de continuar." },
      { title: "Restaure com cuidado", text: "A restauração remove os dados gravados nas chunks selecionadas para o Minecraft gerar o terreno novamente pela seed. Construções e itens dentro delas não voltam." },
      { title: "Importe o novo arquivo", text: "Depois de baixar, importe o .mcworld no Minecraft e visite a área marcada. O arquivo original permanece separado. Use Início para outros ajustes e Construtor 3D para construções." }
    ],
    "minha-conta.html": [
      general[0],
      { title: "Entre com sua conta", text: "Use o botão de entrada do Google para ver os créditos e o acesso associados à sua conta. Para compras, confira se está usando o mesmo e-mail do pagamento." },
      { title: "Volte às ferramentas", text: "Depois de conferir sua conta, use Converter para editar um mundo, Restaurar chunks para reparar uma área ou Construtor 3D para planejar uma construção." }
    ],
    "sucesso.html": [
      general[0],
      { title: "Confira seu acesso", text: "Esta página confirma e consulta o acesso da compra. Se não aparecer de imediato, aguarde a confirmação e use Verificar novamente." },
      { title: "Continue no site", text: "Volte para Início para escolher uma ferramenta. O arquivo do mundo é processado no navegador e você baixa uma nova cópia quando terminar." }
    ],
    "objetivos.html": [
      general[0],
      { title: "Monte seu desafio", text: "Escolha um tema e gere um desafio da semana ou escreva seus próprios objetivos. Marque as etapas manualmente depois de jogar." },
      { title: "Guarde ou imprima", text: "O livro fica neste navegador. Você pode imprimir ou exportar/importar um JSON para transportar uma cópia; a página não acompanha o jogo." }
    ]
  };
  var steps = guides[file] || [
    general[0],
    { title: "Encontre a ferramenta certa", text: "Use Início para editar configurações do mundo, Restaurar chunks para regenerar uma área ou Construtor 3D para posicionar uma estrutura." },
    { title: "Volte quando quiser", text: "Esta página contém informações e políticas do serviço. O botão Guia do site no canto da tela reabre esta explicação." }
  ];

  var stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "guia-site.css?v=1";
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
  overlay.appendChild(card);
  document.body.appendChild(launcher);
  document.body.appendChild(overlay);

  var index = -1;
  function render(i) {
    if (i < 0) { finish(); return; }
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
    next.focus();
  }
  function finish() {
    index = -1;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    try { localStorage.setItem(KEY, "1"); } catch (e) {}
    launcher.focus();
  }
  launcher.addEventListener("click", function () { render(0); });
  close.addEventListener("click", finish);
  skip.addEventListener("click", finish);
  back.addEventListener("click", function () { if (index > 0) render(index - 1); });
  next.addEventListener("click", function () { render(index + 1); });
  document.addEventListener("keydown", function (event) {
    if (index < 0) return;
    if (event.key === "Escape") { event.preventDefault(); finish(); }
    else if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); render(index - 1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); render(index + 1); }
  }, true);
  try {
    if (file !== "builder-lab.html" && !localStorage.getItem(KEY)) setTimeout(function () { if (index < 0) render(0); }, 900);
  } catch (e) { if (file !== "builder-lab.html") setTimeout(function () { if (index < 0) render(0); }, 900); }
})();
