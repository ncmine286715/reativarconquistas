# Deploy grátis (sem servidor, sem deixar cliente na mão)

O site agora é 100% estático: conversão roda no navegador, sem Python, sem `premium.json`.
Qualquer host estático grátis serve. Recomendado: **Cloudflare Pages**.

## Opção A — Cloudflare Pages (recomendado, grátis)
1. Suba esta pasta num repositório GitHub (privado pode).
2. dash.cloudflare.com → Pages → Connect to Git → escolha o repo.
3. Build: **nada** (sem comando, sem dependências). Output: **`site`**.
4. Publish. URL: `https://seuprojeto.pages.dev` (depois troque pelo seu domínio).
5. Cada `git push` publica sozinho. Nunca dorme, nunca apaga código.

## Opção B — GitHub Pages (grátis)
1. Repo → Settings → Pages → Deploy from branch → `main` → pasta `/site` (ou `/docs` — copie o conteúdo de `site/` se precisar).
2. URL: `https://seuuser.github.io/seurepo/`.

## Teste antes de divulgar
1. Abra o site publicado, converta um `.mcworld` pequeno (modo grátis).
2. Ative um código de teste: `py -3 gerar_codigos.py M 1` → ative no botão **Tenho código** → converta em Criativo + strip.
3. Teste no celular (a maioria do tráfego Minecraft vem de lá).

## O que NÃO precisa mais
- Render/Railway/Fly, disco persistente, `ABACATEPAY_*`, SMTP, `data/*.json`.
- O `reativar_conquistas.py` continua útil offline (arrastar .mcworld), mas o site não usa mais.
