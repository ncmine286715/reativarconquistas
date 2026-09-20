# COFRE + CONTEXTO — ReativaConquistas

> ⚠️ REGRA DE OURO: este arquivo NUNCA tem senhas, chaves ou tokens.
> Aqui fica só **o nome** de cada segredo e **onde ele mora**.
> Valores ficam em 2 lugares: dashboard da Cloudflare e um gerenciador
> de senhas (ex.: Bitwarden, grátis). Se algum segredo vazar no chat,
> gere outro na hora.

## 1. Onde mora cada segredo (só NOMES, sem valores)

| Nome | Onde está | Pra que serve |
|---|---|---|
| `ABACATEPAY_API_KEY` | Cloudflare → `reativa-pay` → Settings → Variables (Secret) | Senha do vendedor p/ falar com o AbacatePay. Hoje é `abc_dev_...` (teste). Produção = `abc_...` |
| `WEBHOOK_SECRET` | Mesmo lugar (Secret) | Tranca o aviso de pagamento do AbacatePay |
| `KIWIFY_SECRET` | Mesmo lugar (Secret) | Senha entre a Kiwify e o vendedor (vai no `?secret=` da URL do webhook) |
| Conta Google / Firebase | Console do Firebase | Login com Google (sem senha nossa) |

## 2. Produtos (IDs públicos — esses PODEM ficar aqui)

| Plano | Preço | AbacatePay (prod_) | Kiwify checkout | Kiwify ID produto |
|---|---|---|---|---|
| Passe 24h | R$ 5,90 | `prod_sfQEAQQcWr2P2UtJG4yqUsSq` | https://pay.kiwify.com.br/YfzTiEM | (preencher: página do produto na Kiwify) |
| VIP 30 dias | R$ 19,90 | `prod_ZC3tefGJJZtyGBPqyYdgq5Yk` | https://pay.kiwify.com.br/8vujvs0 | (preencher: página do produto na Kiwify) |

> ⚠️ Na Kiwify o VIP 30 dias está como R$ 19,99 — mudar pra **R$ 19,90** pra igualar o site.
> ⚠️ Tokens R2/API colados no chat um dia: **já rodar** (gerar novos no dashboard).

## 3. Como o dinheiro anda (contexto pra próxima IA)

- Site estático (`site/`) no Cloudflare Pages. Conversão de mundos 100% no navegador (JSZip + NBT próprio em `converter.js`).
- Vendedor = Worker Cloudflare `reativa-pay` (`worker/src/index.js`), KV `PREMIUM_KV`.
- **Kiwify (venda imediata):** botões do site → checkout Kiwify → webhook "Compra aprovada" → `POST /api/kiwify/webhook?secret=...` → libera 1 ou 30 dias pelo NOME do produto ("24h" = 1 dia). Ver o que chegou: `GET /api/kiwify/log?secret=...`
- **AbacatePay (reserva/futuro):** modal no site → checkout → volta em `sucesso.html?id=` → libera. Precisa conta verificada + CNPJ (MEI do pai serve).
- VIP é por **e-mail**: cliente tem que pagar com o mesmo e-mail da conta Google.
- Comandos: `npx wrangler deploy` (na pasta `worker/`), ver config: `/api/config`.

## 4. Backups (como voltar atrás)

| Backup | Onde | Como usar |
|---|---|---|
| Git `backup-antes-kiwify` (tag + branch) | Neste repo | `git checkout backup-antes-kiwify` volta o código; `wrangler deploy` volta o vendedor |
| Versões do Worker | Cloudflare → `reativa-pay` → Deployments | Rollback em 1 clique, sem terminal |
| Regra antes de mudança grande | — | `git add -A` + `git commit` + `git tag backup-<assunto>` |

## 5. Pendências (atualizar conforme resolve)

- [ ] Kiwify: IDs dos 2 produtos (UUID) → `KIWIFY_PID_24H` / `KIWIFY_PID_30D` no Worker (hoje funciona pelo nome, mas ID é mais seguro)
- [ ] Kiwify: VIP 30 dias de R$ 19,99 → R$ 19,90
- [ ] AbacatePay: verificação com CNPJ do MEI + chave `abc_...` de produção + recriar os 2 produtos lá
- [ ] Teste real de compra (sandbox não cobra) nos 2 planos
