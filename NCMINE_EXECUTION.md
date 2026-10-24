# NCMINE_EXECUTION — Missão 04 (Worldify)

Registro vivo. Só marca como feito o que foi executado e verificado.

## 1. Estado encontrado (2026-10-23)
- Produção `https://worldify.com.br/` serve arquivos **idênticos** ao working tree local (md5 de index.html, app.js, pagamento.js, sw.js, termos.html conferidos), incluindo alterações que **não estavam commitadas** (planos mensais/anuais v6, InfinitePay).
- Branch em produção: `fix/pagamento-blindado` (HEAD `b3dc62d` + working tree sujo). Remoto: `origin/fix/worldify-clear-plans`.
- Checkpoint: commit `dfb5ac4` + tag `checkpoint-prod-2026-10-23` na branch `redesign/mission-04`. **Rollback do código = voltar a esse commit.**
- Provedor de pagamento ativo: `PAYMENT_PROVIDER = "infinitepay"` (AbacatePay/Depix/Kiwify só legado).
- Stack real: frontend vanilla JS (sem React), Worker `worker/src/index.js`, Durable Object `EntitlementDO`, KV `PREMIUM_KV`, Firebase Auth. Three.js r124 já vendorizado em `site/vendor/`.
- Decisão de arquitetura: **não migrar para React**. O editor (~17 mil linhas de JS vanilla, NBT/LevelDB) é acoplado ao DOM; migrar traria risco de regressão sem ganho. O redesign é feito em camada (`worldify-black.css`) + módulos novos.

## 2. Testes (baseline)
| Teste | Resultado |
|---|---|
| `npm run test:billing` | PASS |
| `tests/frontend/plan-comparison.cjs` | PASS |
| `worker/tests/plans-v4.mjs`, `purchase-v4.mjs`, `tests/frontend/worldify.cjs` | **FALHAM desde o checkpoint** (esperam catálogo v4 `essential7v4…`; produção usa v6). Pendente: atualizar os testes para v6. |

## 3. Entregue nesta etapa
- `site/worldify-black.css`: tema preto (#000 / #09090B / #111114 / #27272A), tokens redefinidos para o editor herdar; tema claro/escuro unificado; botões brancos pill; planos redesenhados (sem gradiente verde); banner de consentimento ajustado.
- `site/hero3d.js` + canvas no hero: cena voxel original (casa → seleção → estrutura posicionada → chunk destacado → terreno transformado → câmera recua). Three.js carregado só após `load` + ociosidade; InstancedMesh (1 draw call por grupo); sombras só em desktop; pausa fora da tela/aba oculta; poster estático em: sem WebGL, "Modo leve", saveData, ≤2 GB RAM/≤2 núcleos, movimento reduzido.
- Título: "Seu mundo. Sem limites."; CTA de envio permanece imediato (não depende do 3D).
- Verificação visual: capturas Chromium em 1440×900 e 390×844 (hero em 4 instantes, planos).

## 4. Pendente / bloqueios
- **21st.dev**: `21st search` retorna `catalog search failed` sem login. Precisa de `npx @21st-dev/cli login` (navegador) feito pelo usuário. Componentes reais do 21st **ainda não integrados**.
- Editor reorganizado (ver seção 6). Ainda faltam: auditoria funcional profunda de cada ferramenta, inventário (slots/drag-and-drop), seleção de chunks por toque, tema escuro nos painéis do Jogador/Chunks revisados só visualmente.
- Auditoria funcional das ferramentas (NBT, inventário, add-ons, chunks), World Studio com `.mcstructure`, testes de integridade com mundos reais: **não iniciados**.
- Auditoria de segurança (CORS, tokens, webhooks, replay): **não iniciada**. Existe `SECURITY-REVIEW.md` anterior.
- SEO/páginas de conteúdo: **não iniciado**.
- Publicação em produção: **não realizada** (somente após aprovação do layout e testes críticos).

## 5. Publicação
- Preview: Worker version `7ca3f743-828a-40b7-82fd-f111bfdaa96d` enviada com `wrangler versions upload` (**não promovida**; produção continua na versão anterior).
- Para promover: `npx wrangler versions deploy 7ca3f743-828a-40b7-82fd-f111bfdaa96d@100% -c wrangler-site.toml`.
- Rollback: `npx wrangler rollback` (Worker) ou checkout da tag `checkpoint-prod-2026-10-23`.
- Commits: `dfb5ac4` (checkpoint), `e806dd3` (tema preto + hero 3D + planos). Nada enviado ao GitHub ainda.

## 6. Editor reorganizado (2026-10-24)
- `site/workspace.js` + `site/worldify-workspace.css`: com um mundo carregado, o `#form` vira um shell: barra superior (nome, tamanho, aviso "editando uma cópia", Trocar mundo, Exportar), ferramentas laterais agrupadas (Mundo, Jogador, Regras, Pacotes, Mapa, Criar, Finalizar), visualização central (mapa e diagnóstico), painel contextual à direita e barra de status (nº de alterações, plano, "Revisar e exportar").
- Mobile (<720 px): barra inferior com rolagem horizontal e painéis como folha deslizante; tablet: sidebar + painel abaixo.
- Painel **Exportar** novo: resumo de alterações (diferença para o estado pós-diagnóstico), validações reais lidas do DOM, aceite dos termos, botão de download e Diagnóstico. Nenhuma ferramenta removida: os nós originais (IDs/handlers/portões de plano) foram apenas reposicionados. "Addons" → "Add-ons", "Detalhes" → "Diagnóstico", "Construir" → "World Studio ↗" (link para o Construtor 3D existente).
- `worldify-editor.js` expõe `WF_editor.add/tray/nav` (e evento `wf-editor-ready`).
- Corrigido: seletor `.rc-consent` no tema preto; `#converter` com `backdrop-filter` prendia elementos `fixed`.
- **Teste**: `tests/e2e/workspace-export.cjs` (Playwright): sem mundo o shell fica desligado; com `preview-world.mcworld` aparecem todas as ferramentas; download bloqueado até aceitar termos; exportado = mesma lista de arquivos, **só `level.dat` alterado** (5 arquivos do banco idênticos byte a byte), zip íntegro, sem erros de página. PASS. Execução: `PLAYWRIGHT_CORE=… CHROME=… node tests/e2e/workspace-export.cjs`.
- Evidência visual: capturas Chromium desktop 1440, tablet 820 e celular 390 com painéis Exportar, Mundo, Regras, Jogador, Add-ons, Chunks.
- Limitação: testado só com o mundo de exemplo (10 KB) e com a opção padrão de conquistas; mundos grandes, ZIP inválido, cancelamento e abertura no Bedrock real **não** foram testados.

## 7. Publicação em produção (2026-10-24)
- Deploy: `wrangler deploy -c wrangler-site.toml` (frontend; `worker/` e `wrangler*.toml` idênticos ao checkpoint, então pagamentos/webhooks/entitlements **não mudaram**). Branch `redesign/mission-04` enviada ao GitHub.
- Design aplicado também em ferramentas, minha-conta, chunks, importar, sucesso, suporte, termos, privacidade, reembolso, objetivos e 404. `builder-lab` e `world-studio` ficaram **fora** do tema preto (têm tema 3D próprio; conflito de contraste).
- Bug anterior corrigido: com a cota grátis esgotada, `openPayModal("vip30")` retornava em silêncio (plano legado inexistente no catálogo v6) e o usuário não via nada. Agora cai no plano elegível recomendado e abre o login/checkout. Testado até o modal de login; **checkout logado/pagamento real não foi exercitado** (sem login Google, sem cobrança).
- Novo: o status do app é espelhado no painel Exportar (a mensagem original ficava abaixo do shell).
- Verificado no domínio: arquivos servidos iguais ao local (diferença só de CRLF), `/api/config` = infinitepay, vendas ativas, shell do editor renderizando em worldify.com.br.
- Não verificado em produção: exportação ponta a ponta (cota grátis do IP de teste esgotada por meus próprios testes; o E2E passou localmente e o shell renderiza em produção).
- Rollback: `npx wrangler rollback` ou checkout da tag `checkpoint-prod-2026-10-23`.
- **Pendentes (não feitos)**: 21st.dev (login), inventário com slots/drag-and-drop, chunks por toque, World Studio com `.mcstructure`, auditoria de segurança, SEO/conteúdo, testes com mundos grandes/ZIP inválido/cancelamento, abertura no Bedrock real. Testes antigos `plans-v4`/`purchase-v4`/`worldify.cjs` seguem falhando (esperam catálogo v4).

## 8. Ajuste de cor (2026-10-24)
- Feedback: o preto não pode ser a única cor. Base continua preta, com destaque em cor: CTAs em gradiente violeta→azul, cor própria por plano (Básico azul-céu, Essencial âmbar, Pro violeta, Criador rosa, Studio laranja), ciano para status/aviso de cópia, brilho sutil no fundo.
- Removida a barra branca: era o `#status` vazio com fundo branco (agora some quando vazio). Botão verde "Testar meu mundo grátis" trocado pelo gradiente de destaque.
- Cena 3D do hero clareada.
- E2E local passa até o download; o download depende da cota grátis por IP no servidor (esgotada pelos testes). Rodar de outro IP/dia seguinte.
