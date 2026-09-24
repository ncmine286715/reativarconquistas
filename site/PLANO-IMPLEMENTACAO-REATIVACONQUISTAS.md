# Plano de implementação — ReativaConquistas

Data: 22/09/2026  
Base: `README-FUNCOES-MUNDOS-BEDROCK.md`

Este plano organiza primeiro os pacotes e a ordem técnica. Depois, a implementação segue do que roda com segurança no site atual para o que precisa de Add-On ou servidor. Nenhum arquivo de mundo será enviado ao GitHub ou a um serviço externo por este trabalho.

## 1. Produtos e pacotes propostos

Os nomes abaixo organizam as funções. Não alteram preços, links de pagamento ou condições comerciais existentes.

| Pacote | Funções previstas | Papel |
|---|---|---|
| **Grátis** | Abrir e analisar um mundo; resumo/passaporte; relatório básico; mapa e pins locais; ajuda do Null; limites pequenos das ferramentas atuais. | Ajudar o usuário a entender o mundo e experimentar antes de comprar. |
| **Crédito de mundo** | Uma operação grande e clara: reparar/restaurar, editar em lote pequeno ou exportar uma edição premium. | Compra pontual para resolver uma necessidade imediata. |
| **VIP** | Limites maiores, inventário/kits, restauração de chunks, histórico local ampliado e presets avançados. | Uso pessoal recorrente. |
| **Criador** | Lotes, biblioteca de projetos e estruturas, exportações avançadas, comparação e ferramentas para publicar builds. | Criadores e pessoas que trabalham com vários mundos. |
| **Marketplace** | Estruturas e presets gratuitos e pagos; comissão para o autor; revisão técnica e metadados de compatibilidade. | Adicionar conteúdo e receita sem cobrar por funções de segurança. |

## 2. Ordem de execução

### Fase A — Acesso e orientação do site

- Corrigir a distinção entre o domínio de páginas estáticas e o Worker de pagamentos.
- Fazer o guia do Null aparecer no domínio principal e em todas as páginas públicas.
- Manter o guia detalhado do Builder e adicionar a visão geral do site nele.
- Renovar versões do cache para que o navegador não continue usando arquivos antigos.
- Manter um botão de ajuda disponível após a primeira apresentação.

**Pronto quando:** abrir a página principal mostra a explicação na primeira visita; o botão reabre o guia em outras páginas; o Builder mantém o seu tour sem sobrepor dois guias.

### Fase B — Resumo, diagnóstico e recuperação segura

- Criar passaporte do mundo com os campos já lidos pelo site.
- Melhorar o relatório antes/depois para listar operações efetuadas e limitações detectadas.
- Criar cópias de segurança locais nomeadas para as edições; nunca substituir o original.
- Fazer comparador de diagnósticos para duas cópias do mesmo mundo, indicando o que não é comparado.
- Incluir alertas de packs ativos, chunks selecionadas e formatos que não puderam ser confirmados.

**Pronto quando:** usuário consegue entender o estado do arquivo e baixar o relatório sem enviar o mundo para um servidor. A versão básica está concluída; o conteúdo de chunks e inventários não faz parte do comparador atual.

### Fase C — Mapa e Builder

- Adicionar pins de coordenadas e exportação do mapa como imagem.
- Criar pôster e cartão HTML local com dados efetivamente disponíveis, além de um livro imprimível de objetivos/desafios.
- Implementar contador de blocos e materiais para estruturas compatíveis.
- Melhorar o histórico/desfazer de operações e projetos do Builder.
- Adicionar catálogo local de `.mcstructure`, começando com itens gratuitos e metadados de tamanho/versão.
- Depois, explorar biomas, Nether/End e copiar/colar regiões com validação explícita.

**Pronto quando:** pins e relatórios continuam no dispositivo e toda alteração gravada no mundo passa por verificação antes do download.

### Fase D — Monetização e conteúdo

- Mapear os limites existentes aos pacotes Grátis, Crédito, VIP e Criador.
- Criar página de catálogo com autor, compatibilidade, dimensão, tamanho e prévia.
- Só então decidir a comissão e os limites por plano.
- Não alterar checkout, preço, links ou termos sem revisar o fluxo comercial real.

**Pronto quando:** cada função paga mostra seu benefício e limite antes da compra, e os recursos de segurança permanecem visíveis para todos.

### Fase E — Add-On opcional

- Prototipar um Behavior Pack separado para placares/desafios e leitura de coordenadas durante o jogo.
- Gerar arquivo `.mcaddon` no navegador; ativação é feita pelo usuário no Minecraft.
- Mostrar dependências, versão alvo e efeitos sobre conquistas antes de importar.

**Pronto quando:** protótipo é validado em um mundo de teste e não é descrito como edição ao vivo feita pelo site.

### Fase F — Ideias grandes

- Avaliar conversão Java → Bedrock, IA, colaboração hospedada, replay real e geração de terreno apenas depois de validar demanda.
- Fazer protótipos isolados, não prometer suporte completo antes de testar versões e formatos.

## 3. Limites técnicos do trabalho local

- O projeto atual é composto por páginas estáticas, um Worker de assets para o host `reativarconquistas.rosidomingos032.workers.dev` e o Worker de pagamentos/API `reativa-pay.rosidomingos032.workers.dev`.
- O código do site pode ser corrigido no diretório `site`; publicação depende do projeto e do fluxo de deploy do Cloudflare Pages.
- O endereço Pages estável continua `https://reativarconquistas.pages.dev`; um Worker separado chamado `reativarconquistas` também serve os mesmos assets estáticos em `https://reativarconquistas.rosidomingos032.workers.dev`. O código das páginas usa `reativa-pay.rosidomingos032.workers.dev` para checkout/API.
- O deploy desta execução publicou o Pages `reativarconquistas`, branch `main`, em `https://d511f1f5.reativarconquistas.pages.dev`, e o Worker estático `reativarconquistas`, versão `34a673d0-65e4-49eb-b6fb-9fb0d2d13734`.
- Funções que alteram LevelDB devem recusar formatos desconhecidos e gerar arquivo novo com validação.
- Add-On, IA hospedada, multiplayer em tempo real e controle de um mundo aberto dependem de execução ou infraestrutura adicional; não entram como alterações simples do front-end.

## 4. Estado desta execução

- **Fase A:** implementada e publicada no Pages em `main` e no Worker de assets; guia compartilhado disponível nas páginas públicas. Endereços: `https://reativarconquistas.pages.dev` e `https://reativarconquistas.rosidomingos032.workers.dev`.
- **Fase B:** passaporte JSON, relatório JSON com verificações estruturais limitadas, backup explícito via IndexedDB e comparação local de metadados implementados. Histórico automático e comparação de inventários/chunks continuam planejados.
- **Fase C:** pins locais por arquivo, PNG do mapa, pôster e cartão HTML com dados detectados, JSON de pins, livro de objetivos/desafios imprimível e contador de materiais com CSV implementados. Catálogo vendável e ferramentas de copiar/colar continuam planejados.
- **Acessibilidade e importação:** presets de regras no conversor e guia imprimível de importação adicionados; acompanhamento dentro do jogo não está incluído.
- **Fases D–F:** ordenadas; dependem da validação dos limites comerciais, formatos e/ou Add-On.
