# Ideias de funções para mundos Minecraft Bedrock

Este documento mapeia o que o ReativaConquistas já oferece e o que pode virar produto. A ideia é servir como cardápio de implementação: começar com funções pequenas que resolvem problemas reais, criar recursos pagos com valor claro e deixar as ideias experimentais para depois.

**Site principal:** https://worldify.com.br · **Construtor 3D:** https://worldify.com.br/builder-lab. O site também tem endereços técnicos de fallback em Pages e Workers.dev. O Worker de pagamento/API permanece separado em `reativa-pay.rosidomingos032.workers.dev`.

## Como pensar no produto

Um mundo Bedrock pode ser tratado de três formas diferentes:

1. **Editar o arquivo `.mcworld` no navegador.** O site lê e altera uma cópia do arquivo e entrega um novo mundo para importar. É o caminho atual do ReativaConquistas e pode continuar local, sem enviar o mundo para um servidor.
2. **Gerar um Add-On / Behavior Pack.** O site prepara um pacote para o jogador instalar e ativar no mundo. O código do pacote roda dentro do Minecraft e pode interagir com o mundo enquanto ele está aberto.
3. **Conectar a um mundo ou servidor em execução.** Isso requer integração própria com servidor, hospedagem ou uma ferramenta instalada pelo usuário. Uma página web sozinha não controla um mundo aberto no console ou celular.

As APIs oficiais do Bedrock permitem que scripts de Add-On consultem e alterem blocos, dimensões, entidades, jogadores e placares. Isso abre recursos de jogo ao vivo, mas não significa que o navegador possa executar essas ações diretamente no mundo aberto. Essa separação é uma inferência baseada no fluxo oficial de Add-Ons e nas APIs que rodam no Bedrock.

## O que o site já consegue fazer

### Conversor e ajustes do mundo

- Ler `.mcworld`, `.zip` e `level.dat`; mostrar nome, seed, modo, dificuldade, spawn, coordenadas e estado de conquistas.
- Analisar flags, regras e pacotes ativos sem alterar o arquivo.
- Corrigir as flags de conquistas no arquivo e baixar uma cópia nova.
- Mudar dificuldade, nome, modo de jogo, coordenadas visíveis, ciclo dia/noite, clima e algumas regras de sobrevivência.
- Inspecionar, adicionar e remover Behavior Packs, com aviso de compatibilidade/conquistas.
- Editar o inventário do jogador: hotbar, inventário, armadura, ender chest, experiência, itens, nomes, encantamentos e kits.
- Restaurar chunks selecionadas pela seed, depois de analisar a seleção e gerar outro `.mcworld`.
- Editar ou substituir a imagem de capa do mundo.
- Processar mais de um arquivo em lote conforme os limites do plano.

### Recursos locais acrescentados no plano de implementação

- Abrir o guia do Null no primeiro acesso às páginas públicas e reabri-lo pelo botão fixo **Guia do site**. No Construtor 3D, o tour próprio continua disponível e inclui a visão geral do site.
- Baixar o **passaporte JSON**, o **relatório de diagnóstico/integridade** e outra cópia do arquivo original selecionado. O verificador confere itens que consegue ler, como `level.dat`, diretório `db/` e manifests; não garante a integridade interna de todos os registros LevelDB. Arquivos acima de 100 MB pulam a segunda leitura estrutural para evitar duplicar o uso de memória.
- Guardar e baixar **backups nomeados no armazenamento local do navegador**, comparar dois arquivos por metadados e configurações detectáveis, e seguir o **guia de importação** em Windows, Android, iOS ou console. Não há envio automático do mundo para a conta.
- No mapa 2D, criar pins nomeados por coordenada, guardá-los localmente por arquivo, excluí-los, baixar a imagem PNG e exportar os pins em JSON.
- Gerar um **pôster local do mapa** com nome, seed, spawn, dimensão e contagem de chunks detectadas. Não apresenta biomas ou blocos como se tivessem sido analisados.
- Criar um **cartão de visita HTML independente** com a vista atual do mapa e descrição escrita pelo usuário; ele baixa como arquivo, não é publicado pelo site.
- Criar um **livro local de objetivos**: desafios solo por tema, metas próprias, marcação manual, impressão e importação/exportação JSON. O site não acompanha ações dentro do Minecraft.
- Aplicar presets de regras, incluindo acessibilidade/construção, antes da conversão; as mudanças continuam visíveis nos controles e só são gravadas quando o usuário converte.
- No Construtor 3D, contar blocos sólidos por tipo e baixar a lista em CSV. Pilhas e shulkers são estimativas matemáticas, não uma simulação das receitas ou dos slots de cada item.

Essas ações rodam no navegador. Os pins ficam no armazenamento local; não são gravados no mundo nem enviados para a conta/site.

### Construtor 3D beta

- Abrir um `.mcworld` e exibir no mapa as regiões já visitadas, spawn e posição do jogador.
- Ler `.mcstructure`, mostrar terreno real em 3D, posicionar, mover e girar a construção.
- Apagar blocos da estrutura ou do terreno, pintar terreno com alguns blocos e remover árvores da área.
- Mostrar mobs no preview para compor a cena. **Esses mobs são visuais no editor; não são gravados no mundo.**
- Ajustar céu do preview, tirar imagem, verificar colisões e exportar outro `.mcworld` com a estrutura aplicada.
- Gerar relatório/raio-X com dados de chunks, altura e registros detectados.

## Funções simples, úteis e boas para atrair usuários

Estas são boas melhorias de baixo risco porque tornam mais fácil entender o mundo antes de mexer nele.

| Função | O que entrega | Esforço | Monetização sugerida |
|---|---|---:|---|
| **Passaporte do mundo** | JSON com os campos efetivamente reconhecidos, diagnóstico e detalhes disponíveis no arquivo. | Implementado | Grátis; atrai usuários para as ferramentas avançadas. |
| **Diagnóstico antes/depois** | Resumo das opções e operações e relatório JSON baixável; valores desconhecidos não são apresentados como confirmados. | Implementado em versão básica | Grátis para análise; lote e histórico ampliado podem ser VIP. |
| **Verificador de integridade** | Confere presença e leitura de arquivos, pasta `db/` e manifests/referências de packs, com avisos sobre o que não foi validado. | Implementado em versão básica | Relatório básico grátis; reparo guiado pode ser pago. |
| **Presets de regras** | Preenche os controles do conversor para sobrevivência tranquila, difícil, construção, ciclo/clima congelados e desafio. | Implementado | Presets básicos grátis; salvar e compartilhar presets no Criador. |
| **Busca e navegação por coordenadas** | Marcar casas, portais, farms, vilas e locais importantes no mapa; copiar coordenadas para usar no jogo. | Baixo | Grátis; exportar/compartilhar mapas pode ser premium. |
| **Gerador de imagem/cartão do mundo** | Exporta pôster PNG e um cartão HTML local com vista do mapa, nome, seed, spawn, dimensão e descrição escolhida. | Implementado em versão básica | Grátis; estilos extras no Criador. |
| **Biblioteca de backups** | Guardar cópias locais nomeadas explicitamente e permitir baixar uma versão anterior. | Implementado | Grátis no aparelho; retenção sincronizada exige infraestrutura futura. |
| **Comparar dois mundos** | Compara metadados, regras, spawn, estado de conquistas e informação detectada de Behavior Packs. Não lê inventários nem diferenças de blocos/chunks. | Implementado em versão básica | Uso avulso por mundo ou incluído no plano Criador. |
| **Checklist de importação** | Instruções específicas para Android, Windows e outras plataformas, com botão de baixar e nome de arquivo claro. | Baixo | Grátis; diminui abandono e pedidos de suporte. |
| **Biblioteca de itens e IDs** | Busca em português por itens, blocos, encantamentos e identificadores; avisa quando o item depende de Add-On. | Baixo | Busca grátis; catálogo de kits e itens prontos premium. |

## Funções pagáveis com valor fácil de explicar

O ideal é cobrar por economia de tempo, recuperação ou conteúdo pronto. Evitar cobrar por uma promessa de “mundo sem risco”: qualquer edição deve ter cópia original e relatório.

| Produto | Descrição | Por que alguém pagaria | Esforço |
|---|---|---|---:|
| **Reparo guiado do mundo** | Diagnóstico identifica problema provável, explica consequência e monta um novo arquivo com as correções selecionadas. | Recuperar uma base ou evitar perder um mundo é uma necessidade urgente. | Médio/alto |
| **Lote de mundos** | Aplicar as mesmas mudanças em vários `.mcworld` e empacotar os resultados com relatório individual. | Criadores, famílias e administradores poupam trabalho repetitivo. | Baixo/médio |
| **Histórico e desfazer** | Cada exportação recebe versão, data, operações e opção de voltar à cópia anterior. | Segurança e conveniência recorrentes. | Médio |
| **Packs sem conflito** | Conferir manifests, UUIDs, dependências, nomes duplicados e referências quebradas; explicar como resolver. | Add-Ons são uma fonte frequente de erro e frustração. | Médio |
| **Instalador/organizador de Add-Ons** | Organizar packs do mundo, conferir dependências e montar `.mcaddon` ou pacote para importar. | Resolve instalação e manutenção, não só conversão. | Médio/alto |
| **Loja de `.mcstructure`** | Casas, farms, mapas de decoração e construções verificadas, com preview 3D, tamanho, blocos e instruções. | Conteúdo pronto tem valor direto e permite comissão por criador. | Médio |
| **Pacotes por estilo** | Combos de estruturas e presets: medieval, moderno, survival, vila, farm, Nether/End. | Aumenta valor médio do carrinho. | Médio |
| **Kit de player** | Editor simples para restaurar inventário de backup, organizar slots e aplicar kits compatíveis com a versão. | Conveniência e recuperação de itens. | Baixo/médio |
| **Mapa de construções** | Mapa interativo pesquisável com pins e exportação de imagem/arquivo para compartilhar. | Útil para mundos grandes e comunidades. | Médio |
| **Relatório de valor do mundo** | Lista construções, biomas e regiões visíveis, jogadores, entidades/records reconhecidos e tamanho do arquivo. | Criadores podem usar para apresentar, vender ou arquivar o mapa. | Médio |
| **Assistente de atualização** | Detecta versão antiga, pacotes e registros que merecem backup; prepara um arquivo de trabalho para validar no jogo. | A atualização pode quebrar packs ou revelar incompatibilidades. | Alto |

### Modelos de cobrança que combinam com o site

- **Grátis:** abrir e analisar, ferramentas pequenas, limites claros por tamanho/operações.
- **Crédito por mundo:** cobrar uma vez por reparo pesado, lote ou exportação premium.
- **Passe temporário:** acesso ampliado para quem está resolvendo um problema agora.
- **Criador:** limite maior, lote, histórico, exportações avançadas e ferramentas de publicação.
- **Marketplace:** comissão em estruturas/presets feitos por criadores; oferecer conteúdo gratuito para manter o catálogo vivo.
- **Serviço assistido opcional:** o usuário escolhe explicitamente enviar um mundo para análise humana. Não misturar isso com o fluxo local nem enviar arquivos em segundo plano.

## Funções grandes para uma segunda fase

### Mapa e mundo

- **Camada de biomas:** colorir o mapa por bioma e mostrar bordas aproximadas.
- **Modo Nether e End completo:** mapa e preview por dimensão, com troca rápida entre dimensões.
- **Busca por conteúdo:** localizar chunks com baús, spawners, vilas, portal, entidades ou blocos importantes quando os dados puderem ser lidos com confiança.
- **Pintura de regiões:** preencher, substituir, nivelar, limpar vegetação, trocar água/lava e criar caminhos com pincéis e limites de segurança.
- **Copiar e colar áreas:** selecionar uma região do mesmo mundo ou de outro, ver preview, espelhar, girar e exportar.
- **Mesclar mundos:** copiar áreas selecionadas entre saves. Tratar separadamente blocos, block entities, entidades, jogadores, dimensão e coordenadas; não prometer uma fusão perfeita até suportar cada tipo.
- **Mapa de altura:** alternar entre superfície, altura, cavernas conhecidas e blocos especiais.
- **Planejador de rotas:** desenhar linha no mapa e exportar pontos/coordenadas para seguir dentro do jogo.
- **Calculadora de materiais:** analisar uma estrutura e mostrar quantidade de cada bloco, caixas necessárias e custo em shulkers.
- **Contador de blocos e área:** medir volume, perímetro, diferença de altura e materiais removidos/substituídos.

### Construção e criação

- **Prévia de construção antes de colar:** mostrar bloco por bloco, transparência, colisões, líquido, altura e o que será substituído.
- **Pincel 3D:** esfera, cubo, cilindro, linha, parede, esfera oca e preenchimento limitado.
- **Gerador de terreno decorativo:** fazer ilha, montanha, cratera ou ponte como estrutura exportável, sem alegar regeneração vanilla perfeita.
- **Galeria de blueprint:** favoritar, etiquetar e filtrar `.mcstructure` por tamanho, estilo e versão.
- **Exportar modelo 3D:** GLB para visualizar/compartilhar e, futuramente, preparar impressão 3D. O Structure Block oficial do Bedrock já tem modo de exportação 3D.
- **Câmera de tour:** salvar posições de câmera e gerar um vídeo curto do preview para compartilhar.
- **Coautor no editor:** várias pessoas posicionam estruturas numa cena compartilhada. Na primeira versão, sincroniza somente o projeto do editor; não altera o Minecraft ao vivo.
- **Projetos salvos:** guardar coordenadas, estruturas e planos de edição sem armazenar o mundo original.

### Jogador e sobrevivência

- **Presets de kit:** kits iniciante, construção, exploração, Nether e recuperação, editáveis e compartilháveis.
- **Backup de player:** salvar inventário/XP antes de uma operação e restaurar a cópia quando necessário.
- **Comparador de inventário:** comparar o estado salvo entre dois mundos ou backups do mesmo player.
- **Configuração de desafio:** pacote de regras e instruções para “100 dias”, ilha, hardcore ou speedrun; diferenciar claramente configuração do arquivo de conteúdo que precisa de Add-On.
- **Gerador de livro de objetivos:** criar lista de metas e checklist imprimível/compartilhável baseada no tema escolhido.
- **Perfil de acessibilidade:** presets de regras, coordenadas, dificuldade e instruções; explicar quando uma mudança afeta conquistas.

O planejador de objetivos e os presets de regra já oferecem uma primeira versão local para desafios e acessibilidade. Contagem automática de ações, pontuação em tempo real e objetivos confirmados dentro do jogo precisam de Add-On.

## Ideias malucas e virais

São boas para chamar atenção, mas exigem protótipo e teste de compatibilidade antes de virar promessa comercial.

1. **“DNA do mundo”** — primeira versão implementada como pôster do mapa com seed e metadados conhecidos. Biomas, idade, blocos mais comuns e construções detectadas continuam futuros; não devem ser inferidos sem ler esses dados.
2. **Museu 3D do save** — passeio navegável pelas áreas visitadas, com placas automáticas para bases, portais e coordenadas favoritas.
3. **Raio-X arqueológico** — transformar chunks conhecidas em camadas de superfície/subsolo e destacar cavernas, minérios e construções reconhecidas.
4. **Cartão de visita do mundo** — primeira versão implementada como arquivo HTML independente com vista, descrição e metadados conhecidos. Hospedagem compartilhada, versão e publicação de Add-Ons continuam opcionais/futuros.
5. **“Arruma minha base”** — escolher uma estrutura, indicar estilo e terreno, e receber propostas de layout/decoração. A primeira versão pode apenas recomendar blocos e estruturas do catálogo.
6. **Gerador de vila** — montar um plano de vila por módulos, com ruas, casas e farms, posicionáveis no preview como estruturas.
7. **Câmera drone automática** — criar voo virtual pela base e renderizar clipe com títulos, seed e coordenadas.
8. **Desafio da semana** — o site já sorteia um conjunto manual de objetivos por tema. Acompanhamento automático da pontuação dentro do mundo continua dependendo de Add-On.
9. **NPC guia do mundo** — Add-On que adiciona um personagem com diálogos e dicas baseadas num roteiro criado no site.
10. **Mobs para a foto** — permitir poses/cenas no preview e exportar uma lista/comandos ou Add-On para tentar reproduzir a cena no jogo.
11. **“Mundo antes e depois”** — comparar imagens e mapa das áreas editadas, com um vídeo de transformação.
12. **World Time Machine** — histórico navegável de versões, com mapa de calor mostrando onde cada cópia mudou.
13. **Leilão/galeria comunitária de builds** — criadores publicam estruturas, recebem avaliações e ganham comissão por venda.
14. **Assistente por texto** — “quero uma vila medieval perto do rio”; retorna um plano de edição e itens do catálogo. Só executar depois do usuário aprovar o plano.
15. **Detector de farms** — reconhecer padrões conhecidos e estimar produção teórica; exibir como estimativa, nunca como medição real do mundo.
16. **Salas de colaboração ao vivo** — várias pessoas planejam uma build por link; versão avançada usa servidor próprio para salvar projetos compartilhados.
17. **Conversor Java → Bedrock** — importar `.schematic`/`.schem`/`.litematic` e converter blocos, estados e conteúdo para `.mcstructure`. Grande alcance, alto custo de compatibilidade.
18. **Replay real dentro do Minecraft** — um Add-On registra eventos/posições durante o jogo e exporta dados para o site montar um replay. É diferente do tour gerado só pelo preview.
19. **Pacote de aventura criado no site** — montar objetivos, diálogos, placares e eventos como Behavior Pack importável.
20. **Mundo em miniatura para impressão** — selecionar uma área, gerar malha 3D simplificada e exportar STL/GLB. Precisa tratar escala, cavidades, faces internas e limite de polígonos.

## Add-On opcional: recursos que acontecem dentro do jogo

Um Add-On pode complementar o editor quando a função precisa de mundo carregado, eventos ou entidades em execução. A documentação oficial de Script API mostra operações para consultar/alterar blocos, procurar e criar entidades, interagir com jogadores e manter placares.

Exemplos de módulos que o site poderia gerar ou distribuir:

- **Scanner no jogo:** jogador usa um item para guardar coordenada, bioma e nome do local.
- **Placar de desafio:** contagem de dias, mortes, mobs, blocos quebrados ou objetivos concluídos.
- **NPCs e missões:** diálogos, itens de missão, progresso e recompensa.
- **Eventos agendados:** ondas de mobs, meteoros cenográficos, corridas e mini games.
- **Ferramentas de construção ao vivo:** selecionar área e preencher/substituir blocos por script, dentro dos limites suportados pelo jogo.
- **Controle de mobs:** criar, remover ou organizar entidades em regiões carregadas.
- **Teleporte e pontos de retorno:** portais, homes e pontos favoritos, se a experiência com Add-On estiver ativada.
- **Painel para host:** placar, status de desafio, mensagens e ações de operador.
- **Pacote de boas-vindas:** livro, NPC ou tutorial que explica o mapa e os comandos do mundo.
- **Exportador de coordenadas:** mandar uma lista de lugares marcados no jogo para um arquivo que o site transforma em mapa.

**Importante para conquistas:** comandos, cheats e determinados tipos de pacote podem mudar o estado de conquistas. Explicar isso antes da ativação e nunca prometer “conquistas garantidas” quando o usuário instala conteúdo que altera o mundo.

## Dependências que continuam em planejamento

- Mercado e catálogo de estruturas exigem arquivos publicados com autorização, metadados, revisão e fluxo de entrega. O Construtor aceita estruturas fornecidas pelo usuário; isso não é um marketplace.
- Histórico sincronizado, salas ao vivo, coautoria, placares remotos e links de compartilhamento exigem serviço de backend, autenticação e regras de privacidade.
- Leitura completa de biomas, blocos, cavernas e comparação de chunks exige decodificação compatível do LevelDB e com as versões do jogo. A pasta `db/` presente não prova que os registros estão íntegros.
- Gerar Add-On, importar Java, fazer replay real ou alterar um mundo aberto não é uma função de uma página estática isolada. Cada recurso precisa de implementação e validação própria.

## Priorização recomendada

| Ordem | Entrega | Por quê |
|---:|---|---|
| 1 | Passaporte + relatório de diagnóstico melhorado | Baixo risco, reutiliza a leitura que já existe e aumenta confiança. |
| 2 | Histórico local e backup com desfazer | Protege todo o restante e reduz medo de exportar. |
| 3 | Busca de coordenadas, pins e exportação de mapa | Valor rápido para quase todo mundo e fácil de demonstrar. |
| 4 | Calculadora de materiais e biblioteca de `.mcstructure` | Cria catálogo vendável ligado ao Builder Lab. |
| 5 | Comparar mundos + operações em lote | Benefício claro para usuário pagante e criador. |
| 6 | Auditor de Add-Ons e dependências | Resolve problema comum sem prometer compatibilidade universal. |
| 7 | Camadas de bioma e Nether/End | Amplia o mapa a partir dos dados do mundo. |
| 8 | Copiar/colar regiões e pincel 3D | Grande valor, mas precisa de validação forte de exportação. |
| 9 | Add-On de desafios e placares | Abre recursos ao vivo sem confundir com edição offline. |
| 10 | IA, conversão Java, replay real e colaboração hospedada | Investimento alto; prototipar só depois de provar demanda. |

## Limites que precisam aparecer na interface

- **O navegador não acessa o mundo aberto no Minecraft por conta própria.** O fluxo normal é importar um arquivo, gerar outro e o usuário abrir esse novo mundo no jogo.
- **O preview não é o jogo.** Mobs, luz, água, redstone, block entities e blocos de Add-On podem aparecer incompletos ou apenas visuais.
- **Dados gravados no LevelDB são sensíveis a formato e versão.** Recusar formato desconhecido com erro claro é melhor do que exportar arquivo duvidoso.
- **Uma chunk regenerada pela seed perde o conteúdo salvo nela.** Mostrar a seleção e analisar antes de apagar.
- **Nether/End, grandes mundos, entidades, baús e Add-Ons devem ter suporte explicitamente indicado.** Não anunciar suporte geral quando apenas parte dos registros foi tratada.
- **A seed não é um mapa completo por si só.** Biomas e terreno precisam ser decodificados ou gerados com versão/configurações compatíveis; estimativas devem ser rotuladas como estimativas.
- **Preservar conquistas é uma promessa delicada.** Informar quais flags foram editadas, quais packs seguem ativos e quais opções podem bloquear conquistas no próprio jogo.
- **Nunca sobrescrever o original.** Gerar arquivo novo, validar o pacote e oferecer um relatório de alterações.

## Referências oficiais

- [Extensões de arquivo do Minecraft](https://learn.microsoft.com/en-us/minecraft/creator/documents/minecraftfileextensions?view=minecraft-bedrock-stable) — formatos `.mcworld`, `.mcpack` e `.mcstructure`.
- [Introdução a Structure Blocks](https://learn.microsoft.com/en-us/minecraft/creator/documents/structures/introductiontostructureblocks?view=minecraft-bedrock-stable) — salvar/carregar estruturas e exportação 3D.
- [World e Dimension APIs](https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/world-apis?view=minecraft-bedrock-stable) — dimensões, blocos, entidades e biomas via Script API.
- [Classe Dimension](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable) — operações de bloco, consulta de entidades e spawn.
- [Classe Player](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/player?view=minecraft-bedrock-stable) — operações disponíveis para jogadores em scripts.
- [Classe Scoreboard](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/scoreboard?view=minecraft-bedrock-stable) — placares e objetivos.
- [Introdução a comandos](https://learn.microsoft.com/en-us/minecraft/creator/documents/commandsintroduction?view=minecraft-bedrock-stable) — comandos e aviso de que habilitar cheats desativa conquistas daquele mundo.
- [Fluxo de desenvolvimento de Add-Ons](https://learn.microsoft.com/en-us/minecraft/creator/documents/addondevelopmentworkflow?view=minecraft-bedrock-stable) — estrutura de Behavior Pack e Resource Pack.
