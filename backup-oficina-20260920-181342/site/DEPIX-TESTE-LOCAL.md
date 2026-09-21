# Depix — teste local (NÃO commitar / NÃO subir p/ o GitHub)

Backup da versão Kiwify (só cópia, nada apagado): `site/backup-kiwify-2026-09-20/`
(contém config.js, pagamento.js, index.html, sucesso.html, sucesso.js, worker-index.js, wrangler.toml)

## Preços de teste (iguais em todo o site)
- Passe 24h: **R$ 5,90** = 590 centavos (`PASS_24H_CENTS`)
- VIP 30 dias: **R$ 19,90** = 1990 centavos (`PREMIUM_CENTS_30D`)
- Mínimo do Depix: R$ 5,00 — os dois valores passam.

## Arquivos mexidos (só local)
- `site/config.js` → `DEPIX_ENABLED: true`, `DEPIX_TEST_MODE: true`, Kiwify zerada (links no backup)
- `site/pagamento.js` → modal agora pede CPF/CNPJ, cria cobrança via `POST /api/depix/create`
- `site/index.html`, `site/sucesso.html` → `?v=17` / `?v=14` (evita cache no teste)
- `site/sucesso.js` → aceita `?checkout_id=chk_...`
- `worker/src/index.js` → `/api/depix/create`, `/api/depix/status`, `/api/depix/webhook` (HMAC), `/api/depix/simulate`, `/api/config` com `depix_configured`
- `worker/wrangler.toml` → `DEPIX_TEST_MODE = "1"` (só comentário + var, nenhum segredo)

NENHUM segredo foi gravado em arquivo. O `whsec_...` e a chave `sk_...` entram só via `wrangler secret`.

## Falta você fazer (2 comandos, no terminal, pasta `worker/`)
1. Pegar no painel Depix (My Business): a **API key de teste** (`sk_test_...`).
2. Rodar e colar quando pedir (o valor não aparece na tela — normal):
   - `wrangler secret put DEPIX_API_KEY` → cole o `sk_test_...`
   - `wrangler secret put DEPIX_WEBHOOK_SECRET` → cole o `whsec_...`
3. Subir o Worker de teste: `wrangler dev` (local) ou `wrangler deploy` (URL de teste).
   No painel Depix, o `callback_url` é `<URL-do-worker>/api/depix/webhook`.

## Testar o Pix sem dinheiro real
1. `AbrirSite.bat` (ou `python -m http.server` na pasta `site/`) e abrir o modal de pagamento.
2. Usar e-mail de teste + CPF válido de teste (ex.: 529.982.247-25).
3. Pagar o QR de teste, ou forçar aprovado via: `POST /api/depix/simulate {"id":"chk_..."}` (só funciona com `sk_test_`).
4. Voltar em `sucesso.html?checkout_id=chk_...` → tem que mostrar "Pix confirmado / VIP liberado".
5. Conferir VIP: `GET /api/premium?email=...` tem que voltar `premium_until_ms` futuro.

## Voltar p/ Kiwify (se precisar)
Copie os arquivos de `site/backup-kiwify-2026-09-20/` de volta p/ `site/` (e o `worker-index.js` p/ `worker/src/index.js`).
