# Worldify — atualização de 30/09/2026

## Produto
- Marca Worldify nas páginas, metadados, PWA e nova marca vetorial; hero voxel original otimizado em WebP/JPEG.
- Navegação comum por menu, conta com ícone, abas Editar/Pintar/Apagar chunks/Converter, menus nativos recolhíveis e biblioteca de 12 ferramentas.
- Pintura e conversores carregados sob demanda, modo leve, controles de toque e movimento reduzido. Inspeção em 320/390 px e desktop sem transbordamento horizontal.
- Importação .mcworld, .zip, .mctemplate e alias .mctemplet; pasta completa com level.dat/db. Exportação de mundos .mcworld; arquivos .dat isolados somente para diagnóstico.
- Conversor addon beta preserva assets/dependências e prepara metadata do manifest, sem prometer conquistas. Litematic beta limitado a uma região positiva com blocos sólidos sem propriedades/entidades; exporta .mcstructure.
- Recuperados suporte/tickets/admin de atendimento e links de seis texturas do repositório do proprietário no tutorial.

## Pagamentos e créditos
- Catálogo público com world1 (599), worlds2v1 (1190, 2 créditos), vip7 (799) e vip30 (2490), valores em centavos BRL; InfinitePay para novas vendas.
- Identificador novo para o pacote de dois créditos evita reinterpretar recibos antigos. Catálogo legado continua disponível para concessão de compras já feitas.
- Mantidas verificação de UID, preço autoritativo, idempotência do checkout/webhook e correção de migração de benefícios da PR #11.
- Ponte completeOperation/releaseOperation disponível para o editor e pintura; conclusão/reserva passa pelo servidor.
- Limite de auditoria em Durable Object separado de saldos; rejeição de eventos privilegiados enviados pelo cliente.
- Tickets vinculados à conta, limite de envio, anexos validados e administração autenticada. Decisões manuais de atendimento não movimentam dinheiro nem créditos automaticamente.

## Validação
- npm test em site: 12 suítes aprovadas, incluindo roundtrip LevelDB, chunks, templates, checkout de quatro planos e conversão Java/Bedrock independente.
- npm test em worker: autorizado/preço/UID/idempotência, casos legados, tickets, acesso administrativo e limitação atômica aprovados.
- 21st review: sem falhas determinísticas; 10 informações sobre cores da direção visual solicitada.
- Não realizada compra real. Não validado dentro do cliente Minecraft nem em hardware de 2014. Mundos criptografados e APIs ausentes continuam sujeitos a limites do navegador.
