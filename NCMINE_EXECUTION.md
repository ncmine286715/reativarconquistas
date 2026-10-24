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
- Reorganização do editor em Mundo/Jogador/Regras/Add-ons/Chunks/World Studio/Exportar (layout desktop/mobile): **não iniciada**.
- Auditoria funcional das ferramentas (NBT, inventário, add-ons, chunks), World Studio com `.mcstructure`, testes de integridade com mundos reais: **não iniciados**.
- Auditoria de segurança (CORS, tokens, webhooks, replay): **não iniciada**. Existe `SECURITY-REVIEW.md` anterior.
- SEO/páginas de conteúdo: **não iniciado**.
- Publicação em produção: **não realizada** (somente após aprovação do layout e testes críticos).

## 5. Publicação
- Preview: Worker version `7ca3f743-828a-40b7-82fd-f111bfdaa96d` enviada com `wrangler versions upload` (**não promovida**; produção continua na versão anterior).
- Para promover: `npx wrangler versions deploy 7ca3f743-828a-40b7-82fd-f111bfdaa96d@100% -c wrangler-site.toml`.
- Rollback: `npx wrangler rollback` (Worker) ou checkout da tag `checkpoint-prod-2026-10-23`.
- Commits: `dfb5ac4` (checkpoint), `e806dd3` (tema preto + hero 3D + planos). Nada enviado ao GitHub ainda.
