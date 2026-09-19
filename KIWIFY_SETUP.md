# Kiwify — colocar à venda (CPF, sem CNPJ, sem AbacatePay)

Taxa Kiwify (2026): **8,99% + R$ 2,49 por venda**. Mínimo por produto: **R$ 5,00**.
Por isso R$ 6,99 NÃO compensa (líquido ~R$ 3,87). Preços sugeridos (já no `site/config.js`):

| Produto | Preço | Líquido aprox |
|---|---|---|
| Avulsa — 1 conversão | R$ 9,90 | ~R$ 6,52 |
| Premium — 30 dias | R$ 19,90 | ~R$ 15,62 |
| Vitalício | R$ 39,90 | ~R$ 33,82 |

## 1. Conta (5 min, CPF)
1. kiwify.com.br → criar conta (e-mail + senha).
2. Financeiro → Identidade → **CPF** do responsável + conta bancária (Pix).
3. Sem CNPJ, sem mensalidade. Recebe Pix em ~2 dias, cartão em ~15 dias (ou 2 dias com antecipação).

## 2. Criar os 3 produtos (pagamento único, SEM assinatura)
Para cada um (Avulsa / Premium 30 dias / Vitalício):
1. Produtos → Criar produto → tipo **pagamento único** (não recorrência).
2. Entrega: **área externa** → URL do seu site (ex.: `https://seusite.com/sucesso.html`).
3. Preço conforme tabela acima.
4. Na descrição da área de membros, cole: "Seu código chega neste e-mail + área de membros. Ative em: SEUSITE/sucesso.html ou no botão Tenho código."

## 3. Códigos (você gera, Kiwify entrega)
1. Troque o segredo em `gerar_codigos.py` E em `site/codes.js` (mesmo texto, 30+ chars).
2. Gere lotes (NÃO commite, NÃO suba pro GitHub):
   ```
   py -3 gerar_codigos.py A 50
   py -3 gerar_codigos.py M 50
   py -3 gerar_codigos.py V 30
   ```
3. Entrega fase 1 (manual, 2 min/venda): Kiwify avisa a venda → você responde o e-mail/WhatsApp com 1 código não usado do lote + link `seusite.com/sucesso.html?codigo=RC-XXXX-XXXX-XXXX`.
4. Controle: marque os usados numa planilha simples (data, e-mail, código).
5. Fase 2 (automática, quando vender todo dia): webhook Kiwify → Cloudflare Worker grátis gera e envia o código sozinho. Me peça quando chegar lá.

## 4. Ligar os botões do site
Em `site/config.js`, preencha as 3 URLs de checkout:
```
single: { ..., url: "https://pay.kiwify.com.br/SEU-AVULSO" },
monthly: { ..., url: "https://pay.kiwify.com.br/SEU-MENSAL" },
lifetime: { ..., url: "https://pay.kiwify.com.br/SEU-VITALICIO" },
```
Suba o site de novo (Cloudflare Pages publica sozinho via GitHub).

## 5. Reembolso (não tomar processo)
- 7 dias CDC: cliente pede na Kiwify (estorna sozinha) ou no seu e-mail.
- Não usado → 100%. 30 dias usado → proporcional. Avulsa/vitalício → caso a caso (código nem ativado = 100%).
- Texto já está em `site/reembolso.html`. Não prometa desbloqueio de conquistas em lugar nenhum.
