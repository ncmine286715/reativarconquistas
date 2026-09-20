/* Configuração PÚBLICA do site — NENHUM segredo aqui.
   Conversão 100% no navegador. Premium via conta + DePix (Worker).
   As chaves sk_live_/whsec_ ficam SOMENTE nos Secrets do Worker Cloudflare. */
window.RC_CONFIG = {
  // Modelo: mundos de até FREE_MAX_MB são grátis (FREE_DAILY/dia).
  // Acima disso (mundos gigantes, mais processamento) é VIP.
  FREE_MAX_MB: 10,
  // PROMOÇÃO: até 23/09/2026, o grátis vale 25 MB (auto-expira, sem deploy)
  PROMO_MAX_MB: 25,
  PROMO_UNTIL: "2026-09-24T23:59:59-03:00",
  PRE_MAX_MB: 500,
  // Limites leves do grátis (margem pro VIP sem forçar):
  // mundos até FREE_MAX_MB (ou PROMO), 1 por vez, FREE_DAILY conversões/dia.
  // FREE_MAX_PACKS = behavior packs existentes que o grátis pode remover.
  // VIP = recursos liberados e sem quota diária; limite técnico PRE_MAX_MB.
  FREE_DAILY: 2,
  FREE_MAX_PACKS: 1,
  SUPPORT_EMAIL: "ncmine75@gmail.com",
  OPERATOR_NAME: "ReativaConquistas",
  OPERATOR_DOC: "",
  OPERATOR_CITY_UF: "Terra Roxa/PR",
  // URL do Worker Cloudflare (API de contas + pagamento).
  // API usada para consultar VIP, criar checkout DePix e receber webhooks.
  WORKER_URL: "https://reativa-pay.rosidomingos032.workers.dev",
  PREMIUM_PRICE_LABEL: "R$ 19,90",
  PASS_24H_PRICE_LABEL: "R$ 5,90",
  PREMIUM_DAYS: 30,
  // Preços em centavos (usados pelo Depix p/ teste e produção).
  // Mínimo do Depix: 500 (R$ 5,00) — 590 e 1990 estão OK.
  PASS_24H_CENTS: 590,
  PREMIUM_CENTS_30D: 1990,
  // DePix (Pix via api.depixapp.com, através do Worker — NENHUM segredo aqui).
  // Produção: as credenciais ficam somente nos Secrets do Worker.
  DEPIX_ENABLED: true,
  DEPIX_TEST_MODE: false
};
