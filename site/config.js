/* Configuração PÚBLICA do site — NENHUM segredo aqui.
   Conversão 100% no navegador. Premium via conta + AbacatePay (Worker).
   Chave abc_* fica SÓ no Worker Cloudflare. */
window.RC_CONFIG = {
  // Modelo: mundos de até FREE_MAX_MB são grátis e ilimitados.
  // Acima disso (mundos gigantes, mais processamento) é VIP.
  FREE_MAX_MB: 10,
  PRE_MAX_MB: 500,
  SUPPORT_EMAIL: "ncmine75@gmail.com",
  OPERATOR_NAME: "ReativaConquistas",
  OPERATOR_DOC: "",
  OPERATOR_CITY_UF: "Terra Roxa/PR",
  // URL do Worker Cloudflare (API de contas + pagamento).
  WORKER_URL: "https://reativa-pay.rosidomingos032.workers.dev",
  PREMIUM_PRICE_LABEL: "R$ 19,90",
  PASS_24H_PRICE_LABEL: "R$ 6,90",
  PREMIUM_DAYS: 30,
  // Checkout Kiwify (venda imediata): links pay.kiwify.com.br de cada plano.
  // Preenchido = botão vai direto p/ a Kiwify. Vazio = usa o modal AbacatePay.
  KIWIFY_URL_24H: "https://pay.kiwify.com.br/YfzTiEM",
  KIWIFY_URL_30D: "https://pay.kiwify.com.br/8vujvs0"
};
