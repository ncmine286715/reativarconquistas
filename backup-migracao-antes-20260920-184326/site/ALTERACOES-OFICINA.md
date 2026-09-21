# Oficina Bedrock — correções e interface

## Fluxo

Escolha o mundo, abra as ferramentas desejadas e use **Gerar e baixar meu mundo**. O mapa fica em **Regenerar terreno**. No inventário: escolha um slot, selecione um item e confirme em **Aplicar no slot**.

A Kiwify e seus links foram mantidos. Os nomes Explorador, Passe Aventura e Passe Construtor são apenas a apresentação dos planos existentes; duração e valores não foram alterados.

## Correções

- Reset funciona também em bancos menores que o lote de processamento. Atores são apagados por vínculo com o chunk, sem inferir dimensão pela posição.
- Chaves binárias são reconstruídas a partir da representação do leitor, evitando o byte extra em prefixos compartilhados.
- Gravação mantém os logs pendentes, respeita a sequência acima de 32 bits, considera sequências mais recentes no WAL e preserva caminhos em mundos dentro de subpastas.
- Inventário salva campos ausentes, slot selecionado, quantidade e jogador escolhido. Dados adicionais dos itens são mantidos quando o item é editado sem trocar seu tipo.
- Equipamentos que já estavam no mundo não bloqueiam edições gratuitas do inventário.
- Cotas de terreno e inventário só são consumidas depois de todas as etapas de geração terminarem.
- Removidos controles duplicados e chamada a uma função inexistente no mapa.
- Ilustração vetorial própria em `assets/world-island.svg`, ícones locais e estilos em `workshop.css`.

## Verificação

Execute `npm test` na pasta `site` (Node 18+). O teste gera seu próprio banco de exemplo e verifica remoção de chunks/atores, preservação dos demais registros, subchunks negativos, caminhos e sequências de gravação.

Também foram executados testes de navegador com o mundo de exemplo local: upload, edição de item, seleção, download combinado, releitura da saída, troca de jogador e arquivos dentro de subpastas. Nenhum arquivo do mundo foi enviado a serviço externo. Layout verificado em desktop e celular.

A importação final no aplicativo Minecraft não foi testada neste ambiente. O site não foi publicado.
