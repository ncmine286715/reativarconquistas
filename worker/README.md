# Worker AbacatePay (Cloudflare) — ReativaConquistas

Código **separado** do site: a chave `abc_*` mora **só aqui** (via `secret`),
nunca no JavaScript do navegador. O site (`site/pagamento.js`) chama este
Worker, e o Worker chama o AbacatePay.

## 1x — publicar

```bash
cd worker
npm i
# KV (pendências, recibos de pagamento, registros e migração legada por e-mail)
wrangler kv namespace create PREMIUM_KV
# -> cole os ids em wrangler.toml (id + preview_id)

# SEGREDO (a chave NUNCA vai p/ o git):
wrangler secret put ABACATEPAY_API_KEY
# cole: abc_dev_... (sandbox) ou abc_... (produção)

wrangler deploy
# -> anota a URL: https://reativa-pay.<sua-conta>.workers.dev
```

## Ligar no site

1. Em `site/config.js`: `WORKER_URL: "https://reativa-pay.<sua-conta>.workers.dev"`.
2. Em `wrangler.toml`: `PUBLIC_BASE_URL` = seu domínio final e
   `ALLOWED_ORIGINS` = seu domínio (ex.: `https://seudominio.com.br`).
   Rode `wrangler deploy` de novo após mudar vars.
3. (Recomendado) Gere um `WEBHOOK_SECRET`, cadastre no AbacatePay a URL
   `https://<worker>/api/abacate/webhook?secret=VALOR`.

## Teste local

```bash
wrangler dev
# Worker em http://localhost:8787 -> WORKER_URL local p/ testar.
# Fluxo principal: site -> POST /api/depix/create -> Pix -> webhook/status
# confirma e concede ao UID Google. AbacatePay é fallback configurável.
```

## Planos (produtos AbacatePay)

O Worker vende 2 planos; cada um é um **produto separado** no dashboard
AbacatePay (Produtos → Novo produto → pagamento único):

| Plano | Produto sugerido | Preço | Var no `wrangler.toml` | Dias liberados |
|---|---|---|---|---|
| Resolver 1 mundo (`world1`) | "Resolver 1 mundo" | R$ 5,99 | `ABACATEPAY_PRODUCT_ID_WORLD1` | 1 crédito para um projeto; consome na primeira operação concluída e permite reedições do mesmo projeto por 30 dias após cada edição |
| Passe 7 dias (`vip7`) | "Passe 7 dias" | R$ 7,99 | Pix Depix principal | 7 |
| Passe 30 dias (`vip30`) | "Passe 30 dias" | R$ 24,90 | `ABACATEPAY_PRODUCT_ID` | 30 |
| Criador (`creator`) | "Criador" | R$ 39,90 | Pix Depix principal | 30 |

O produto antigo `ABACATEPAY_PRODUCT_ID_24H` só serve para pagamentos legados de
24 horas. Ele não é usado como crédito `world1`. O fallback AbacatePay aceita
World1 e VIP 30 dias; configure IDs de produto dedicados antes de ativá-lo.

DePix recebe `request_id` também como `idempotency_key`. O Durable Object impede
dois checkouts pendentes na mesma conta até o vencimento do provedor (20 minutos
para DePix; no fallback AbacatePay, a validade informada pelo provedor ou até 24
horas quando ela não vem na resposta). Reabrir o mesmo plano reutiliza o link.
Se o retorno do provedor se perder, a conta mostra que a criação está sendo
confirmada e uma repetição com o mesmo identificador recupera a mesma cobrança.
Não inicie outro plano enquanto essa cobrança estiver pendente.

Depois de criar o produto, cole o `prod_...` na var e rode `wrangler deploy`.
Var vazia = plano desligado (o site recebe 502 com mensagem clara).

## Endpoints

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/abacate/create` | compatibilidade legada; o checkout principal usa `/api/depix/create` |
| GET | `/api/abacate/status?id=` | `{status, paid, email, plan?, premium_until_ms?}` (libera se pagou, pelos dias do plano) |
| POST | `/api/abacate/webhook` | AbacatePay avisa → reconfere na API → libera pelos dias do plano |
| GET | `/api/config` | catálogo público dos planos e configuração dos provedores |
| GET | `/api/entitlements` | saldo de crédito de mundo e validade do plano da conta Google |
| POST | `/api/entitlements/check` | valida plano, tamanho, lote e reserva crédito/quota com `operation_id` |
| POST | `/api/entitlements/complete` | confirma a operação concluída; consome crédito/quota uma vez |
| POST | `/api/entitlements/release` | libera reservas de operação que falhou |

Segurança: o webhook **nunca** confia só no POST — reconfere cada cobrança
na API do AbacatePay antes de liberar. Limite: 10 checkouts/hora por IP.

## Kiwify (venda imediata, sem esperar o AbacatePay)

1. Na Kiwify, crie os produtos (pagamento único) e anote o **ID de cada
   produto** (UUID na página do produto, ex.: `93081353-...`).
2. Em cada produto: **Webhooks → Adicionar** → evento **Compra aprovada** →
   URL `https://<worker>/api/kiwify/webhook?secret=VALOR` (invente o VALOR).
3. No Worker, grave o segredo sem colocá-lo no git:
   `wrangler secret put KIWIFY_SECRET` (o mesmo valor usado em `?secret=`).
   Se o painel enviar o token em header, grave também `wrangler secret put KIWIFY_TOKEN`.
   IDs recomendados: `KIWIFY_PID_WORLD1`, `KIWIFY_PID_7D`, `KIWIFY_PID_30D` e
   `KIWIFY_PID_CREATOR`. `KIWIFY_PID_24H` fica reservado a compras antigas.
   Sem IDs, o Worker reconhece nomes exatos de produto e rejeita qualquer
   produto desconhecido.
   Depois `wrangler deploy`.
4. Em `site/config.js`, escolha `PAYMENT_PROVIDER: "kiwify"` ou `"depix"`;
   `"hybrid"` mantém Depix como principal. Os quatro links Kiwify são:
   `KIWIFY_URL_WORLD1`, `KIWIFY_URL_7D`, `KIWIFY_URL_30D` e `KIWIFY_URL_CREATOR`.
5. O webhook guarda o recibo de compra. O cliente deve entrar com a conta
   Google que usa o mesmo e-mail do checkout para vincular o recibo verificado
   ao Firebase UID; os benefícios passam a seguir o UID da conta.

Reembolso/chargeback chegam no log (`klog`) mas **não revogam sozinhos**:
confira e encerre manualmente se precisar.
