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

  // Limite padrão para usuários grátis.
  FREE_MAX_MB: 10,

  // Promoção temporária para usuários grátis.
  PROMO_MAX_MB: 25,
  PROMO_UNTIL: "2026-09-24T23:59:59-03:00",

  // Limite técnico máximo aceito pelo sistema.
  PRE_MAX_MB: 500,

  // Quantidade de conversões grátis por dia.
  FREE_DAILY: 2,

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
  PASS_24H_PRICE_LABEL: "R$ 5,90",

  // VIP de 30 dias.
  PREMIUM_PRICE_LABEL: "R$ 19,90",

  PREMIUM_DAYS: 30,

  // Valores enviados para o Depix em centavos.
  PASS_24H_CENTS: 590,
  PREMIUM_CENTS_30D: 1990,


  /* =========================
     DEPIX
     ========================= */

  // Depix é o sistema principal de pagamento Pix.
  DEPIX_ENABLED: true,

  // false = produção
  // true  = ambiente de testes
  DEPIX_TEST_MODE: false,


  /* =========================
     FALLBACK DE PAGAMENTO
     ========================= */

  // Mantidos apenas como fallback caso seja necessário
  // voltar temporariamente para a Kiwify.
  //
  // Com DEPIX_ENABLED = true, o fluxo normal utiliza Depix.
  KIWIFY_URL_24H: "https://pay.kiwify.com.br/YfzTiEM",
  KIWIFY_URL_30D: "https://pay.kiwify.com.br/8vujvs0"

};