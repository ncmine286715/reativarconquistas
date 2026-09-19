# ReativaConquistas — como colocar no ar (produção)

> **Modelo atual: site estático + Kiwify (sem servidor, sem AbacatePay).**
> Leia `KIWIFY_SETUP.md` (venda com CPF) + `DEPLOY_GRATIS.md` (Cloudflare Pages).
> Abaixo, o modo servidor antigo (Python + AbacatePay) — mantido só como referência/offline.

Site pronto: layout branco + laranja, planos Grátis (1/semana) x Premium 30 dias,
Termos + Privacidade (LGPD) + Reembolso, checkout AbacatePay (Pix) e servidor sem dependências.

## 1. Antes de publicar (obrigatório p/ não tomar processo)

1. `site/config.js` já está com seu e-mail (`ncmine75@gmail.com`) e cidade (Terra Roxa/PR).
   Quando sair o MEI do seu pai, adicione `OPERATOR_DOC` com o CNPJ e atualize
   `site/termos.html` (1.2) e `site/privacidade.html` (§1).
2. No dashboard AbacatePay (conta de **produção**, no CPF do seu pai), gere a chave
   (`abc_...`, sem `_dev_`) e configure no servidor:
   - Variável `ABACATEPAY_API_KEY` com ela (nunca no frontend! É segredo.)
   - `ABACATEPAY_PRODUCT_ID` com o produto de produção (R$ 6,99, pagamento único)
   - `PUBLIC_BASE_URL=https://seudominio.com.br` (p/ o AbacatePay voltar ao seu site)
   - Opcional: `ABACATEPAY_WEBHOOK_SECRET=algo-aleatorio` e cadastre o webhook
     `https://seudominio.com.br/api/abacate/webhook?secret=algo-aleatorio`

## 2. Rodar local

```bat
py -3 reativar_conquistas.py --server 8080 --open
```
(ou 2 cliques no `Iniciar.bat`, que carrega o `.env` sozinho)

### Testar o pagamento de verdade
Sem modo teste no código: o teste real é pagar **1 vez você mesmo (R$ 6,99)**
com Pix e conferir se o Premium ativa e o dinheiro cai na AbacatePay.
Depois peça o reembolso/estorno no dashboard se quiser — ou considere os R$ 6,99
o custo do teste. Fluxo: criar conta → Assinar → pagar → retorno libera na hora.

## 3. Publicar (opção fácil: Render.com — grátis)

1. Suba esta pasta p/ um repositório GitHub privado.
2. Em render.com → New → Web Service → conecte o repo:
   - **Build:** (vazio — sem dependências)
   - **Start:** `python reativar_conquistas.py --server $PORT`
   - **Env vars:** `ABACATEPAY_API_KEY`, `PUBLIC_BASE_URL`, `PREMIUM_PRICE_CENTS=699`
3. Aponte seu domínio (ex.: Hostinger/Cloudflare) p/ a URL do Render + ative HTTPS.

Alternativas: Railway, Fly.io, VPS (systemd + nginx + certbot). O servidor é stdlib puro.

## 4. Como o dinheiro entra (produto AbacatePay)

> 1. No **dashboard de produção** → Produtos → Novo produto:
>    nome `Premium 30 dias`, preço **R$ 6,99**, tipo **pagamento único**.
> 2. Copie o **ID do produto** (ex.: `prod_abc123xyz`) e configure no servidor:
>    `ABACATEPAY_PRODUCT_ID=prod_abc123xyz`.
> 3. Confira em `https://seudominio.com.br/api/config` que
>    `product_configured` está `true`.

- Grátis: 1 conversão / 7 dias por rede (controle por IP + navegador).
- Premium R$ 6,99 / 30 dias: ilimitado + Criativo + remover behavior packs + trocar foto + renomear o mundo.
- Página **Minha conta** (`minha-conta.html`): status do plano, cota, histórico das últimas 50 conversões (só metadados), encerrar sessões em outros aparelhos e excluir a conta (LGPD).
- Checkout: `POST /api/abacate/create` → AbacatePay (Pix/cartão) → cliente paga → volta p/ `/sucesso.html?id=...` → `GET /api/abacate/status` confirma e libera 30 dias.
- Webhook `/api/abacate/webhook` libera mesmo se o cliente fechar a página.
- Premium fica em `data/premium.json` (e-mail → validade). Backup dessa pasta!
- ⚠️ **Disco persistente é obrigatório**: no plano grátis do Render o disco apaga a
  cada restart (e com ele o `premium.json` = clientes pagos perdem o Premium).
  Use Render Disk / Railway Volume / VPS com disco real. Alternativa futura: banco
  externo (Postgres).

## 8. Contas, captcha e código no e-mail (já incluso)

- **Fluxo:** Criar conta (nome + e-mail + senha + captcha de soma) → confirmar
  e-mail com código de 6 dígitos → pagar → Premium vinculado à conta.
- **Senha:** guardada só como hash PBKDF2 (200 mil rodadas) em `data/users.json`;
  sessões de 30 dias em `data/sessions.json`. Sem dependências externas.
- **Captcha próprio:** pergunta de soma (`/api/captcha/new`) + campo honeypot +
  rate-limit (10 tent./min por IP). **Upgrade recomendado:** Cloudflare Turnstile
  (grátis): coloque o widget no modal de registro e valide o token no servidor
  (`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`) — ~15 linhas.
- **Código no e-mail:** precisa de SMTP (Gmail: senha de app — ver `.env.example`).
  Sem SMTP as contas nascem já verificadas — configure antes de lançar.
- **Endpooints:** `POST /api/auth/register|login|logout|send-code|verify-code`,
  `GET /api/auth/me` (Bearer token). O pagamento (`/api/abacate/create`) exige
  conta logada e verificada — usa o e-mail da conta, sem redigitação.

## 5. Privacidade / jurídico incluído

- Checkbox de aceite obrigatório antes de converter e antes de pagar.
- Mundos **não ficam salvos** (apagados após entrega); logs mínimos por 6 meses (Marco Civil).
- Aviso “sem afiliação Mojang/Microsoft” no topo, hero, checkout e rodapé.
- Sem garantia de conquistas (regras da Mojang) + arrependimento 7 dias (CDC art. 49).
- E-mail de suporte e cidade já configurados — não pule a emissão de recibos/notas.

## 6. Trocar preço / regra

- Preço: `PREMIUM_PRICE_CENTS` (centavos) + texto em `site/config.js` (`PREMIUM_PRICE_LABEL`).
- Cota grátis: `FREE_PER_WEEK`. Vigência: `PREMIUM_DAYS`.

## 7. Suporte a falhas comuns

- “AbacatePay recusou”: confira a chave (dev x produção) e `PUBLIC_BASE_URL` https válido.
- “Cota acabou” injusto (mesma escola/rede): o Premium resolve; ou aguarde 7 dias.
- Arquivo >100 MB: compacte ou divida; limite configurável em `MAX_UPLOAD_MB`.
