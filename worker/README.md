# Worker AbacatePay (Cloudflare) — ReativaConquistas

Código **separado** do site: a chave `abc_*` mora **só aqui** (via `secret`),
nunca no JavaScript do navegador. O site (`site/pagamento.js`) chama este
Worker, e o Worker chama o AbacatePay.

## 1x — publicar

```bash
cd worker
npm i
# KV (pendentes + premium por e-mail)
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
# Fluxo: site -> POST /api/abacate/create -> checkout Abacate (sandbox não
# cobra de verdade) -> volta em /sucesso.html?id=... -> status confirma.
```

## Endpoints

| Método | Rota | O que faz |
|---|---|---|
| POST | `/api/abacate/create` | `{email, name}` → `{url, id}` (checkout 30 dias) |
| GET | `/api/abacate/status?id=` | `{status, paid, email, premium_until_ms?}` (libera se pagou) |
| POST | `/api/abacate/webhook` | AbacatePay avisa → reconfere na API → libera |
| GET | `/api/premium?email=` | `{premium_until_ms}` (lido do KV) |
| GET | `/api/config` | flags públicas |

Segurança: o webhook **nunca** confia só no POST — reconfere cada cobrança
na API do AbacatePay antes de liberar. Limite: 10 checkouts/hora por IP.
