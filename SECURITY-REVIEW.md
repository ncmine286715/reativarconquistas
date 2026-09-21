# Revisão de segurança — ReativaConquistas

## Correções aplicadas

- `localStorage` não é mais usado como autoridade para VIP, plano ou crédito. O estado válido vem do entitlement autenticado no Worker.
- Operações premium passam por `/api/entitlements/check`; os recursos solicitados são avaliados no servidor, sem confiar em `premium: true` enviado pelo navegador.
- A quota gratuita passou a ser contada no Worker e, quando disponível, no Durable Object para evitar corrida entre requisições.
- O servidor Python ignora `premium_email` enviado no multipart e só aceita Premium associado a uma sessão do servidor.
- Status de cobrança no servidor Python exige sessão e vínculo com a cobrança; webhooks AbacatePay agora exigem segredo configurado.
- CORS não aceita `Origin: null` nem `Access-Control-Allow-Origin: *`.
- Pages e Worker passaram a enviar CSP, `frame-ancestors`, `X-Frame-Options`, `X-Content-Type-Options`, Referrer/Permissions Policy e isolamento cross-origin.
- Uploads Python rejeitam caminhos perigosos e conteúdo descompactado acima do limite; quota, rate limit e gravação JSON ficaram mais resistentes a concorrência/interrupção.
- Chaves de service account, `.env`, caches Wrangler e certificados foram adicionados ao `.dockerignore`.

## Reconhecimento do pesquisador

O reconhecimento de 9.999 dias fica disponível somente no Worker, através do secret `SECURITY_REWARD_EMAIL`. O endereço não deve ser colocado em `site/`, no bundle publicado, no GitHub ou no `localStorage`.

Para ativar o reconhecimento para um único endereço:

```powershell
cd worker
npx wrangler secret put SECURITY_REWARD_EMAIL
# quando solicitado, informe somente o e-mail autorizado
npx wrangler deploy
```

O Worker compara o e-mail normalizado da conta Google autenticada com esse secret e devolve o plano `creator`; sem autenticação correspondente, o benefício não é concedido. A configuração é intencionalmente server-side e auditável — não é um backdoor oculto no JavaScript.

## Limitação estrutural importante

O conversor principal ainda executa no navegador. Portanto, nenhum código JavaScript pode impedir um usuário tecnicamente capaz de alterar o bundle, chamar `RC_convert` diretamente ou remover qualquer bloqueio visual. As correções acima fecham o bypass por estado local no fluxo oficial e protegem as APIs, mas não transformam processamento local em controle de monetização inviolável.

Para exigir segurança real de cobrança, as operações premium precisam ser processadas por um endpoint autenticado no backend, que receba o arquivo, valide o entitlement e só então devolva o resultado. Enquanto esse processador não estiver publicado, não se deve anunciar o controle local como uma barreira de segurança.

## Ações obrigatórias de implantação

1. Publicar novamente o Worker e o site para que as correções entrem em produção.
2. Configurar `WEBHOOK_SECRET`/`DEPIX_WEBHOOK_SECRET` e manter `ALLOWED_ORIGINS` com domínios explícitos, sem `*`.
3. Revogar e gerar novamente a chave privada do Firebase Admin que existe localmente. Ela não está versionada, mas estava dentro do contexto Docker antes da correção do `.dockerignore`; imagens antigas devem ser consideradas comprometidas.
4. Usar armazenamento persistente para dados de conta e Premium; o disco efêmero do plano gratuito do Render não é adequado.
5. Executar `node worker/tests/entitlements.mjs`, `npm test` dentro de `site` e verificar em produção os headers/CORS com uma requisição `OPTIONS` de uma origem permitida e de `Origin: null`.
