# ReativaConquistas — como colocar no ar (produção)

> **Modelo atual: site no Cloudflare Pages + API no Cloudflare Worker (contas + AbacatePay). Tudo no plano grátis.**

- Site: `site/` → Worker de assets via `wrangler-site.toml` (`https://worldify.com.br`); Pages permanece em `https://reativarconquistas.pages.dev` como fallback técnico.
- API: `worker/` → Worker (`https://reativa-pay.<conta>.workers.dev`)
- Pagamento: AbacatePay (Pix/cartão), Premium liberado na conta do usuário
- Segredos (`ABACATEPAY_API_KEY`, `WEBHOOK_SECRET`): **só como secrets do Worker**, nunca no git

## 1. Antes de publicar

1. `site/config.js` já está com seu e-mail (`ncmine75@gmail.com`) e cidade (Terra Roxa/PR).
   Quando sair o MEI do seu pai, adicione `OPERATOR_DOC` com o CNPJ e atualize
   `site/termos.html` (1.2) e `site/privacidade.html` (§1).
2. Produção no AbacatePay: gere a chave **de produção** (`abc_...`, sem `_dev_`),
   crie o produto "Premium 30 dias" e anote o ID (`prod_...`).

## 2. Ir para produção (sair do sandbox)

```bash
cd worker
# chave de PRODUÇÃO (não aparece no terminal nem vai pro git):
npx wrangler secret put ABACATEPAY_API_KEY
# atualize o wrangler.toml: ABACATEPAY_PRODUCT_ID = "prod_... (produção)"
npx wrangler deploy
```

`PUBLIC_BASE_URL` e `ALLOWED_ORIGINS` devem apontar para o domínio oficial (`https://worldify.com.br`). O antigo `pages.dev` fica liberado durante a transição. Publique o site com `npx wrangler deploy --config wrangler-site.toml`; publique API e pagamentos com `npx wrangler deploy --config worker/wrangler.toml`.
`WEBHOOK_SECRET` já está gravado; cadastre no AbacatePay (produção):
`https://<worker>/api/abacate/webhook?secret=VALOR`.

## 3. Publicar o site

```bash
npx wrangler pages deploy site --project-name reativarconquistas --branch main
```

(ou conecte o repo no dashboard do Pages 1x: Settings → Builds → Connect Git —
aí cada `git push` publica sozinho.)

## 4. Rodar local (offline)

2 cliques em `AbrirSemPython.bat` (site 100% no navegador, sem Python).
`py -3 reativar_conquistas.py --server 8080 --open` continua existindo,
mas o site publicado não usa mais o Python.
