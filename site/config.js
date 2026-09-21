/* Configuração PÚBLICA do ReativaConquistas.
   NÃO coloque chaves, tokens ou secrets neste arquivo.

   O navegador acessa somente o Cloudflare Worker.
   Segredos como DEPIX_API_KEY e DEPIX_WEBHOOK_SECRET
   ficam exclusivamente configurados no Worker Cloudflare.
*/

window.RC_CONFIG = {

  /* =========================
     LIMITES DO SITE
     ========================= */

  // Provedor ativo: "depix", "kiwify" ou "hybrid".
  // "hybrid" mantém Depix como principal e Kiwify como link alternativo.
  PAYMENT_PROVIDER: "depix",

  // Limite padrão para usuários grátis.
  FREE_MAX_MB: 10,

  // Promoção temporária para usuários grátis.
  PROMO_MAX_MB: 10,
  PROMO_UNTIL: "",

  // Limite técnico máximo aceito pelo sistema.
  PRE_MAX_MB: Infinity,

  // Quantidade de conversões grátis por dia.
  FREE_DAILY: 3,

  // Quantidade máxima de Behavior Packs que o plano grátis pode remover.
  FREE_MAX_PACKS: 1,


  /* =========================
     INFORMAÇÕES DO SERVIÇO
     ========================= */

  SUPPORT_EMAIL: "ncmine75@gmail.com",

  OPERATOR_NAME: "ReativaConquistas",

  // Preencha somente se realmente quiser exibir documento publicamente.
  OPERATOR_DOC: "",

  OPERATOR_CITY_UF: "Terra Roxa/PR",


  /* =========================
     CLOUDFLARE WORKER
     ========================= */

  // Backend responsável por:
  // - pagamentos
  // - consulta do VIP
  // - webhooks
  // - KV
  // - APIs do site
  WORKER_URL: "https://reativa-pay.rosidomingos032.workers.dev",


  /* =========================
     PLANOS VIP
     ========================= */

  // Passe de 24 horas.
  PASS_24H_PRICE_LABEL: "R$ 5,99",

  // VIP de 30 dias.
  PREMIUM_PRICE_LABEL: "R$ 24,90",

  PREMIUM_DAYS: 30,

  // Valores enviados para o Depix em centavos.
  PASS_24H_CENTS: 599,
  PREMIUM_CENTS_30D: 2490,

  PASS_7D_PRICE_LABEL: "R$ 7,99",
  PASS_7D_CENTS: 799,
  CREATOR_PRICE_LABEL: "R$ 39,90",
  CREATOR_CENTS: 3990,


  /* =========================
     DEPIX
     ========================= */

  // O provedor ativo é controlado por PAYMENT_PROVIDER acima.
  DEPIX_ENABLED: true,

  // false = produção
  // true  = ambiente de testes
  DEPIX_TEST_MODE: false,


  /* =========================
     KIWIFY
     ========================= */

  // Os links ficam públicos no checkout; segredos permanecem no Worker.
  KIWIFY_ENABLED: true,
  KIWIFY_URL_WORLD1: "https://pay.kiwify.com.br/YfzTiEM",
  KIWIFY_URL_7D: "https://pay.kiwify.com.br/sBgHQEA",
  KIWIFY_URL_30D: "https://pay.kiwify.com.br/8vujvs0",
  KIWIFY_URL_CREATOR: "https://pay.kiwify.com.br/jmZC3K3",

  // Alias antigo mantido para compatibilidade com páginas/cache antigos.
  KIWIFY_URL_24H: "https://pay.kiwify.com.br/YfzTiEM"

};
