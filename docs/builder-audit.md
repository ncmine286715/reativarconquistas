# Builder: auditoria e implantação por etapas

## Estado observado

- Renderização: Three.js r124, `InstancedMesh` agrupado por material, texturas locais e `OrbitControls`. O terreno é decodificado por `ChunkPreviewManager` em Worker quando disponível, com vizinhança 3×3 no celular ou 5×5 no desktop.
- Coordenadas: `builder-transform.js` e `builder-placement.js` fornecem a transformação usada pela prévia e pelo planejamento de escrita. `builder-core.js` interpreta NBT `.mcstructure`, limita tamanho, paleta e volume, recusa casos complexos incompatíveis e planeja as alterações em chunks existentes.
- A câmera antiga iniciava longe em função do alcance do terreno; botão esquerdo orbitava e o direito fazia pan. O mapa escolhia o centro da chunk independentemente do ponto tocado. O cálculo de Y chamava a montagem do terreno 3D, tornando o caminho 2D dependente de WebGL.
- A prévia carregava Three.js ao abrir o mundo mesmo quando o usuário só precisava do mapa. A estrutura possuía contorno, mas os materiais do fantasma permaneciam opacos. A construção final usa `builder-core.plan` e gera um novo `.mcworld`; mantém o arquivo original em memória.

## Etapa de posicionamento

O mapa passa a ser o modo inicial e converte o toque em coordenada de bloco. Os chunks atravessados pela base são decodificados para estimar Y sem inicializar o renderizador. O modo 3D abre por escolha do usuário, retorna ao mapa se WebGL falhar, mostra um fantasma translúcido e permite acompanhar o terreno com o cursor antes do clique. Há modo de coordenadas, rotação e altura rápidas, download do original e foco adequado à estrutura.

O planejamento de escrita, a verificação de entitlements, os pagamentos e a montagem do `.mcworld` não foram alterados. A validação final continua feita em `builder-core.plan` antes da exportação.

## Biblioteca: dependências reais

O projeto possui `PREMIUM_KV` para pagamentos e um Durable Object de entitlements; não há bucket R2, banco de catálogo de construções nem fonte com licença de redistribuição configurada. A biblioteca pública e os uploads da comunidade precisam de armazenamento de binários provisionado e de validação de `.mcstructure` no servidor antes de receberem arquivos não confiáveis. Nenhuma fonte externa ou publicação automática deve ser ativada sem licença explícita. Não é seguro representar upload apenas validado no navegador como aprovado no catálogo.

Proposta para a próxima etapa: bucket R2 privado para binários e thumbnails, catálogo transacional separado para hash e status, endpoints de envio autenticado e moderação, parser defensivo executado no servidor, render de thumbnail a partir do arquivo validado e fonte autorizada registrada explicitamente. O site só deve exibir registros `published`, com URLs de download controladas. A importação programada pode ser ativada quando houver uma fonte autorizada. Esta etapa não introduz custos ou vínculos de infraestrutura ainda inexistentes.
