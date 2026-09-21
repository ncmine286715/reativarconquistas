# Auditoria do editor Bedrock

Data: 20/09/2026

## Resumo executivo

Foi corrigida a recuperação Hardcore. O editor agora reconhece somente o marcador Bedrock `IsHardcore` como evidência de Hardcore, exige que ele esteja ativo, altera apenas esse byte e `PlayerHasDied` quando o campo existe, e relê o `.mcworld` gerado antes de entregá-lo.

Também foi corrigido o acesso ao modo de jogo: `Manter o modo atual` continua gratuito; qualquer alteração explícita exige entitlement pago nos três níveis do fluxo (UI, submit e API local). A operação local não é antifraude contra alguém que altere o próprio JavaScript no DevTools; uma cobrança realmente resistente a adulteração exigiria processamento/assinatura de entitlement no servidor, incompatível com a arquitetura local atual.

Fontes técnicas consultadas: [Minecraft Hardcore Bedrock](https://www.minecraft.net/en-us/article/hardcore-mode-bedrock-edition), [LevelSettings do protocolo Bedrock 1.26.44](https://mojang.github.io/bedrock-protocol-docs/1.26.44/types/level-settings/) e [notas oficiais 1.21.40](https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.21.40?view=minecraft-bedrock-stable). Elas sustentam que Hardcore é estado do mundo e que o Bedrock expõe `Is Hardcore`/`isHardcore` para criadores; a implementação usa a tag NBT observada nos saves (`IsHardcore`).

## Matriz de funções existentes

| Função | Antes | Problema encontrado | Alteração | Teste | Estado final |
|---|---|---|---|---|---|
| Reativação de conquistas | Limpava `commandsEnabled`, `cheatsEnabled` e `hasBeenLoadedInCreative` | Não é garantia de conquistas; behavior packs ativos continuam relevantes | Mantida como alteração técnica; diagnóstico continua avisando sobre packs | Round-trip NBT/ZIP e preservação de entradas | PARCIAL |
| Hardcore | Aceitava aliases especulativos, alterava `GameType` e podia concluir sem marcador real | Podia editar campo errado e prometer recuperação sem detectar Hardcore | Exige `IsHardcore=1`; zera só `IsHardcore` e `PlayerHasDied` presente; valida releitura | `converter-roundtrip.cjs` | CORRIGIDO |
| Modo de jogo | Seleção livre no plano grátis | Alteração estava liberada na UI e no conversor | `keep` é gratuito; Survival/Creative/Adventure exigem entitlement pago e `paidEntitlement` | Teste de rejeição `PAID_GAME_MODE` | CORRIGIDO |
| Dificuldade | Edita `Difficulty` inteiro | Sem problema estrutural encontrado; resultado do jogo depende da versão | Mantida edição mínima | Round-trip pelo conversor | FUNCIONANDO |
| Gamerules | Edita bytes `keepinventory`, `showcoordinates`, `dodaylightcycle`, `doweathercycle` | Cobertura limitada às regras expostas | Mantida; não foram inventadas tags adicionais sem fixture real | Parser/round-trip existente | PARCIAL |
| Renomear mundo | Reconstrói somente a string `LevelName` e espelho `levelname.txt` | Operação de tamanho variável exige reconstrução cuidadosa | Mantida; validação NBT do resultado adicionada ao fluxo ZIP | Validação do corpo NBT e ZIP | FUNCIONANDO |
| Foto do mundo | Substitui ícone por `world_icon.jpeg` | Requer JPEG válido | Mantida; valida presença no ZIP gerado | Validação de saída | FUNCIONANDO |
| Remover behavior packs | Remove pastas e `world_behavior_packs*.json` | Não remove necessariamente todos os resíduos/referências e não prova achievements | Mantida com aviso; não promete garantia de achievements | Apenas limite/fluxo existente; sem mundo real | PARCIAL |
| Instalar addons | Empacota manifest e arquivos em `behavior_packs`/`resource_packs` | Dependências e colisões de UUID não são resolvidas | Não alterada | Sem fixture de addon completo | PARCIAL |
| Inventário/hotbar/armadura/ender chest/XP | Escreve player NBT via novo log LevelDB | Fluxo depende de player válido e biblioteca LevelDB | Mantido; LevelDB usa put mínimo e valida releitura | `editor-core.cjs` para preservação LevelDB | PARCIAL |
| Reset de chunks | Deleta registros de chunk/atores via log LevelDB | É de alto risco e exige backup | Mantido com preflight/limites; não reescreve SST | `editor-core.cjs` | PARCIAL |
| Mapa 2D/raio-X | Leitura de chunks/biomas para visualização | Não é mutação de mundo | Sem alteração nesta auditoria | Fora do escopo de round-trip mutável | FUNCIONANDO |
| Lote | Processa múltiplos arquivos | Limites dependem do plano | Mantida validação de limite no submit; modo pago carrega entitlement | Sintaxe e fluxo existente | FUNCIONANDO |

## Hardcore: diagnóstico técnico

O bug principal era de contrato: a função não exigia que `IsHardcore` existisse nem estivesse ativo. Além disso, tratava aliases (`hardcore`, `isHardcore`, etc.) como equivalentes e alterava `GameType`/`ForceGameType`, o que violava a regra de alteração mínima.

O novo fluxo é:

`entrada → localizar level.dat → ler NBT → exigir IsHardcore=1 → alterar IsHardcore=0 e PlayerHasDied=0 se presente → validar NBT → gerar ZIP → reabrir ZIP → reler NBT → validar os mesmos estados`.

Isso recupera o marcador mundial. O resultado dentro do Minecraft ainda depende da versão do jogo e do estado salvo do jogador; a interface não promete garantia universal de recuperação.

## Reativação de conquistas

A operação técnica continua limitada a campos conhecidos e não recria o NBT inteiro. Ela não é chamada de “garantia de conquistas”: behavior packs personalizados, conteúdo bloqueado, Realm/servidor e outros estados do jogo podem continuar impedindo achievements. O diagnóstico expõe `hardcore`, `hardcoreDetected`, flags, gamerules, seed, spawn e behavior packs encontrados.

## Novas funções adicionadas

| O que faz | Por que é útil | Arquivos/tags alterados | Plano | Como foi testada |
|---|---|---|---|---|
| Validação pós-geração do `.mcworld` | Evita entregar ZIP/NBT que só “não deu erro” no JavaScript | Nenhuma tag adicional; relê `level.dat` e `world_icon.jpeg` | Todos | ZIP round-trip e parser NBT |
| Diagnóstico explícito de Hardcore | Distingue marcador ausente, ativo e desligado | Leitura de `IsHardcore` | Grátis | Fixture sintética e leitura do diagnóstico |
| Bloqueio técnico de alteração de modo | Alinha UI, submit e conversor com o modelo comercial | `GameType` só com entitlement pago | Resolver 1 mundo, 7 dias, 30 dias, Criador | Rejeição sem entitlement |

## Ideias pesquisadas mas não implementadas

- Inserção de `.mcstructure`: não é segura com a arquitetura atual. Exige interpretar paletas, versões, subchunks e atualizar registros LevelDB de chunks sem perder estados/blocos/entidades; não há fixture real nem teste de abertura no Bedrock neste workspace.
- Edição de posição, dimensão, fome, vida, efeitos e spawn de jogador: os registros podem variar entre `~local_player`, UUIDs e versões; implementar sem fixtures reais poderia escrever o jogador errado.
- Gerenciador completo de addons/dependências: remover JSON não prova que referências, UUIDs, scripts ou packs órfãos deixaram o mundo consistente.
- Mais gamerules: baixo risco conceitual, mas cada tag precisa ser confirmada contra fixtures recentes; não foi adicionada uma lista especulativa.
- Garantia automática de achievements: não é tecnicamente honesto prometer isso somente editando três flags de `level.dat`.

## Preservação e backup

As operações existentes geram um arquivo novo para download e não sobrescrevem o input. O editor já orienta manter o original; Hardcore agora reforça isso na descrição. A estratégia recomendada para o usuário é manter o `.mcworld` original até abrir e validar a cópia no jogo.

## Validação executada

- `node tests/editor-core.cjs` — PASS: deleção de chunks/atores, preservação de player e registros não selecionados, WAL e sequência 64-bit.
- `node tests/converter-roundtrip.cjs` — PASS: Hardcore, preservação de `GameType`/dificuldade/arquivo desconhecido, ZIP, rejeição de Hardcore inativo e bloqueio do modo pago.
- `node --check site/app.js` — PASS.
- `node --check site/pagamento.js` — PASS.
- `node --check worker/src/index.js` — PASS.
- `git diff --check` — PASS, apenas avisos de conversão de final de linha do Git.

Não havia mundos `.mcworld` reais/fixtures Hardcore no projeto para teste manual no Minecraft. Portanto, a validação realizada é de formato e round-trip sintético; a validação final dentro do jogo ainda deve ser feita com uma cópia de um mundo Hardcore real exportado pela versão alvo.
