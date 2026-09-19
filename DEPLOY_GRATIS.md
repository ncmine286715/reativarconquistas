# Deploy grátis (Cloudflare Pages + Worker)

O site é estático (`site/`): conversão roda no navegador. A API (`worker/`)
cuida de contas + AbacatePay. Ambos têm plano grátis.

## Site (Pages)

```bash
npx wrangler pages deploy site --project-name reativarconquistas --branch main
```

URL: `https://reativarconquistas.pages.dev` (depois troque pelo seu domínio
no dashboard do Pages). Build: **nada** (sem comando, sem dependências).

## API (Worker)

```bash
cd worker
npx wrangler deploy
```

Segredos (1x, nunca no git): `wrangler secret put ABACATEPAY_API_KEY`
e o `WEBHOOK_SECRET` (ver `worker/README.md`).

## Teste antes de divulgar

1. Abra o site publicado, converta um `.mcworld` pequeno (modo grátis).
2. Crie uma conta (Entrar), clique **Pagar com Pix**, pague no sandbox
   e confirme o Premium liberando em Minha conta.
3. Teste no celular (a maioria do tráfego Minecraft vem de lá).
