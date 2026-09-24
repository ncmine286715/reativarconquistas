/* Configuração PÚBLICA do ReativaConquistas.
   NÃO coloque chaves, tokens ou secrets neste arquivo.

   O navegador acessa somente o Cloudflare Worker.
   Segredos como DEPIX_API_KEY e DEPIX_WEBHOOK_SECRET
   ficam exclusivamente configurados no Worker Cloudflare.
*/

window.RC_CONFIG = {

  /* Marca e integrações públicas. SITE_URL deve ser o único domínio canônico. */
  SITE_NAME: "ReativaConquistas",
  SITE_URL: "https://worldify.com.br",
  SITE_DESCRIPTION: "Edite mundos Minecraft Bedrock no navegador e baixe uma cópia do resultado.",
  SITE_LOGO: "/logo.png",
  SITE_OG_IMAGE: "/hero.png",
  GOOGLE_ANALYTICS_ID: "G-NK8ZN0XFJM",
  GOOGLE_TAG_MANAGER_ID: "",
  GOOGLE_SITE_VERIFICATION: "",
  GOOGLE_ADS_ID: "",
  ADSENSE_CLIENT_ID: "",

  /* =========================
     LIMITES DO SITE
     ========================= */

  // Provedor ativo: "depix", "kiwify" ou "hybrid".
  // "hybrid" mantém Depix como principal e Kiwify como link alternativo.
  PAYMENT_PROVIDER: "depix",

  // Limite padrão para usuários grátis.

  // Promoção temporária para usuários grátis.

  // Limite técnico máximo aceito pelo sistema.

  // Quantidade de conversões grátis por dia.

  // Quantidade máxima de Behavior Packs que o plano grátis pode remover.


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
  KIWIFY_ENABLED: false,
  // O link antigo YfzTiEM pertence ao passe de 24h, não ao crédito World1.
  KIWIFY_URL_WORLD1: "",
  KIWIFY_URL_7D: "https://pay.kiwify.com.br/sBgHQEA",
  KIWIFY_URL_30D: "https://pay.kiwify.com.br/8vujvs0",
  KIWIFY_URL_CREATOR: "https://pay.kiwify.com.br/jmZC3K3"

};
