/* Configuração PÚBLICA do site estático — NENHUM segredo aqui.
   Conversão 100% no navegador. Pagamento: Kiwify (links) e/ou AbacatePay
   via Worker Cloudflare (WORKER_URL). Chave abc_* fica SÓ no Worker. */
window.RC_CONFIG = {
  FREE_PER_WEEK: 1,
  SUPPORT_EMAIL: "ncmine75@gmail.com",
  OPERATOR_NAME: "ReativaConquistas",
  OPERATOR_DOC: "",
  OPERATOR_CITY_UF: "Terra Roxa/PR",
  // URL do Worker Cloudflare (ex.: https://reativa-pay.seuuser.workers.dev).
  // Vazio = botões Abacate ficam escondidos e só vale Kiwify/código.
  WORKER_URL: "https://reativa-pay.rosidomingos032.workers.dev",
  // Preços (Kiwify: mínimo R$ 5, taxa 8,99% + R$ 2,49/venda — R$ 6,99 não compensa).
  // Líquido aprox: 9,90->6,52 | 19,90->15,62 | 39,90->33,82
  PRODUCTS: {
    single: { label: "Avulsa — 1 conversão", price: "R$ 9,90", url: "" },
    monthly: { label: "Premium — 30 dias", price: "R$ 19,90", url: "" },
    lifetime: { label: "Vitalício", price: "R$ 39,90", url: "" }
  },
  KIWIFY_HELP_URL: "sucesso.html"
};
