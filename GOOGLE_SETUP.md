# Google, SEO e mensuração — ReativaConquistas

## Estado implementado

- O domínio oficial é `https://worldify.com.br`. `SITE_URL`, canonical, Open Graph, dados estruturados, sitemap e robots foram sincronizados para esse domínio. `PUBLIC_BASE_URL` e `ALLOWED_ORIGINS` do Worker também usam o domínio raiz; o antigo `pages.dev` permanece aceito durante a transição. `www.worldify.com.br` não resolve no DNS e não deve ser usado até configurar DNS e redirecionamento para o domínio raiz.
- A verificação por arquivo está em `site/googlee400a800a1425492.html`. Cloudflare Pages redireciona arquivos `.html` para URLs sem extensão; `functions/googlee400a800a1425492.html.js` responde o conteúdo original com status 200 no endereço exato. `GOOGLE_SITE_VERIFICATION` é opcional e fica vazio; se receber um **token meta** diferente, coloque-o em `site/config.js` e rode `node site/scripts/sync-seo.mjs`.
- `robots.txt`, `sitemap.xml`, canonical e Open Graph são estáticos para robôs. O script de sincronização gera URLs a partir de `SITE_URL`. Nenhum `lastmod` foi inventado.
- Páginas públicas indexáveis: home, ferramentas, chunks, Construtor 3D, importação, objetivos, privacidade, termos e reembolso. Admin, conta, retorno de pagamento e 404 têm `noindex`; APIs continuam protegidas pelo backend, não por robots.txt.
- GA4 direto usa o Measurement ID fornecido `G-NK8ZN0XFJM`. A tag é carregada **uma vez, depois de consentimento para medição**. Por isso há um único carregador em `analytics.js` por página, em vez de colar o snippet repetido no HTML. A escolha pode ser alterada na Política de Privacidade.
- GTM, Google Ads e AdSense estão desativados, sem IDs. Quando `GOOGLE_TAG_MANAGER_ID` estiver definido, o carregador usa GTM em vez de GA4 direto. Configure a tag GA4 e regras de consentimento no GTM antes de ativá-lo; não configure as duas rotas ao mesmo tempo.
- Eventos não dão acesso ao plano. `purchase` é emitido apenas quando o endpoint autenticado de status retorna `paid: true`, plano, ID e valor após a concessão pelo backend. O navegador evita reenviar o mesmo ID e GA4 recebe `transaction_id`. Um navegador diferente ainda depende da deduplicação do GA4 por ID.

## Configuração manual

### A. Domínio e Search Console

1. O domínio oficial configurado é `worldify.com.br`, ligado ao Worker `reativarconquistas`, que serve os arquivos de `site/`. O projeto Pages continua como endereço técnico de fallback.
2. Crie propriedade de **Domínio** `worldify.com.br` no Search Console e valide pelo registro DNS TXT. O arquivo de verificação existente serve para propriedade de prefixo de URL.
3. Depois de publicar, abra `/googlee400a800a1425492.html`, `/robots.txt` e `/sitemap.xml` no domínio oficial. Envie `/sitemap.xml` no Search Console.
4. Solicite indexação da home, `/ferramentas`, `/chunks` e `/builder-lab`. Acompanhe **Pages/Indexing**, HTTPS, Core Web Vitals e resultados aprimorados aplicáveis. Indexação e sitelinks são decisões do Google.

### B. GA4, eventos e conversões

1. Confirme na propriedade GA4 que `G-NK8ZN0XFJM` pertence ao fluxo web correto. O ID é público; não coloque credenciais de API no navegador.
2. Aceite a medição no site e abra GA4 DebugView. Em ambiente local, `?analytics_debug=1` habilita logs no console e `debug_mode` nos eventos. Use Tag Assistant para inspecionar o Consent Mode e a ausência de tags antes da escolha.
3. Eventos implementados: `page_view`, `sign_up`, `login`, `world_selected`, `world_analysis_started`, `world_analysis_completed`, `tool_view`, `tool_opened`, `tool_started`, `tool_completed`, `paywall_view`, `pricing_view`, `plan_view`, `plan_selected`, `begin_checkout`, `pix_requested`, `pix_created`, `payment_pending`, `payment_failed`, `payment_expired`, `benefit_activated`, `download_started` e `purchase` confirmado. Estados de pagamento só são registrados quando o backend informa um status reconhecível. Alguns eventos da lista desejada não são emitidos porque o navegador não consegue comprovar o fato: `download_completed` (download do navegador) e `pix_copy` (cópia no checkout externo). Não interprete ausência como zero de negócio.
4. Marque `purchase` como evento principal de conversão. `sign_up` e `begin_checkout` podem ser secundários. Não marque `page_view` como venda.
5. Registre dimensões personalizadas no GA4 para `tool`, `plan`, `tool_origin`, `utm_content` e outras dimensões de evento que quiser analisar nos relatórios. Fonte, mídia e campanha da URL também seguem as UTMs padrão. Configure relatórios de funil com os eventos acima; este projeto não cria um painel próprio.
6. Para validar `purchase` sem pagamento real, use os testes automatizados e uma cobrança de teste confirmada no backend autorizado. Verifique `transaction_id`, `value`, `currency=BRL`, item/plano e que atualizar a página não envia outra compra. O valor vem do catálogo confirmado pelo Worker, não do botão.
7. Se for usar Google Ads, conecte a propriedade GA4 e importe `purchase` após validá-lo. Não há campanha nem gasto habilitado pelo código.

### C. Consentimento, UTMs e privacidade

- `analytics.js` carrega GA4 somente após aceite; ao recusar, nenhuma tag de analytics é carregada. O Consent Mode direto inicia com `analytics_storage`, `ad_storage`, `ad_user_data` e `ad_personalization` negados; somente `analytics_storage` é concedido após aceite. Anúncios não são ativados.
- UTMs permitidas (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) são guardadas somente na sessão. Também são guardados caminho de entrada e host de referência. URLs e parâmetros de eventos são filtrados para evitar email, CPF e nome de arquivo. Não coloque dados pessoais em UTMs.
- A telemetria própria existente continua separada do GA4. A Política de Privacidade foi atualizada para mencionar GA4 opcional. Revise juridicamente texto, retenção, consentimento e base legal antes de ampliar coleta ou ativar Ads/AdSense.
- Para AdSense futuro, crie conteúdo original útil e solicite aprovação ao Google. Não inclua anúncios em checkout, Pix, processamento ou editor. `ADSENSE_CLIENT_ID` permanece vazio.

### D. Verificações técnicas

- Execute `npm test` em `site/`, `node site/tests/google-measurement.cjs` e os testes do Worker antes de deploy.
- Confira desktop e mobile, com e sem login, e um acesso pago de teste. O fluxo crítico deve continuar funcional quando a tag Google é bloqueada pela rede.
- Verifique no navegador se a CSP permite o Google tag após consentimento e continua bloqueando origens desconhecidas. Revise CSP antes de ativar GTM com outras tags.
- No Firebase Console, adicione `worldify.com.br` em **Authentication → Settings → Authorized domains**. Sem esse passo, login Google e operações de compra autenticadas podem falhar. `www.worldify.com.br` só deve ser adicionado quando passar a resolver e redirecionar corretamente.
- Confira a resposta HTTP 404 para rota inexistente no Pages e no Worker estático, além do `noindex` para admin/conta/retorno.
- Monitore LCP, INP e CLS com dados reais no Search Console e PageSpeed Insights. Não há métricas reais no repositório; nenhuma nota foi presumida.

## Checklist

- [ ] Domínio oficial confirmado e `SITE_URL` sincronizado
- [ ] Search Console criado e propriedade verificada
- [ ] Sitemap enviado e páginas principais inspecionadas
- [ ] GA4 e Measurement ID confirmados
- [ ] Consentimento validado no Tag Assistant
- [ ] Eventos vistos no DebugView
- [ ] `purchase` confirmado e sem duplicação em retorno/reload
- [ ] GTM configurado, se for utilizado no futuro
- [ ] Google Ads conectado, se for utilizado no futuro
- [ ] Política de Privacidade revisada
- [ ] AdSense solicitado, se fizer sentido no futuro
- [ ] Páginas principais indexadas e Core Web Vitals monitorados

## Referências oficiais

- [Search Console e propriedade de domínio](https://support.google.com/webmasters/answer/9008080)
- [Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) e [robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Canonical](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) e [dados estruturados](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data)
- [Consent Mode](https://developers.google.com/tag-platform/security/guides/consent) e [deduplicação de compras por transaction ID](https://support.google.com/analytics/answer/12313109)
- [404 em Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)
