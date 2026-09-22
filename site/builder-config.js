/* Limites de estabilidade do Builder. São limites do cliente para evitar
   travamento; o Worker deve repetir estes valores ao autorizar a operação. */
(function () {
  "use strict";
  window.RC_BUILDER_CONFIG = Object.freeze({
    MAX_STRUCTURE_BYTES: 20 * 1024 * 1024,
    MAX_SIDE: 128,
    MAX_VOLUME: 120000,
    MAX_PALETTE: 4096,
    MAX_AFFECTED_CHUNKS: 64,
    MAX_PREVIEW_BLOCKS: 120000,
    MIN_Y: -64,
    MAX_Y: 319
  });
})();
