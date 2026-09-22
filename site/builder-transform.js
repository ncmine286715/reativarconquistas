/* ReativaConquistas Builder -- a única fonte de verdade para posição e rotação.
   Tanto o preview quanto a escrita no LevelDB chamam este módulo. */
(function () {
  "use strict";
  function fail(message) { var e = new Error(message); e.code = "BUILDER_STATE_ROTATION"; throw e; }
  function turns(value) {
    value = Number(value || 0);
    if (!isFinite(value) || value % 90) fail("Rotação inválida.");
    return ((value / 90) % 4 + 4) % 4;
  }
  function size(size, rotation) {
    var t = turns(rotation);
    return t % 2 ? [size[2], size[1], size[0]] : [size[0], size[1], size[2]];
  }
  /* Rotação no sentido horário vista de cima. A origem permanece no canto
     mínimo da bounding box final, para que coordenada e preview coincidam. */
  function local(position, originalSize, rotation) {
    var x = position.x, y = position.y, z = position.z, t = turns(rotation);
    if (t === 1) return { x: originalSize[2] - 1 - z, y: y, z: x };
    if (t === 2) return { x: originalSize[0] - 1 - x, y: y, z: originalSize[2] - 1 - z };
    if (t === 3) return { x: z, y: y, z: originalSize[0] - 1 - x };
    return { x: x, y: y, z: z };
  }
  function world(position, originalSize, offset, rotation) {
    var p = local(position, originalSize, rotation);
    return { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z };
  }
  /* Única conversão entre coordenadas do mundo e o espaço do Three.js. A
     primeira versão mantém os três eixos com a mesma orientação do Bedrock. */
  function worldToThree(x, y, z) { return { x: Number(x), y: Number(y), z: Number(z) }; }
  function threeToWorld(x, y, z) { return { x: Number(x), y: Number(y), z: Number(z) }; }
  function cycle(v, values, t) {
    var i = values.indexOf(v);
    return i < 0 ? v : values[(i + t) % values.length];
  }
  function intCycle(v, values, t) { return typeof v === "number" ? cycle(v, values, t) : v; }
  function rotateStates(blockNode, rotation) {
    var t = turns(rotation), N = window.RC_nbt2;
    if (!t) return N.encode({ t: N.T_COMPOUND, n: "", v: blockNode.v });
    var states = blockNode && blockNode.v && blockNode.v.map && blockNode.v.map.states;
    if (!states || states.t !== N.T_COMPOUND) fail("Estados de bloco inválidos.");
    var map = states.v.map, order = states.v.order || [], i, n, node;
    for (i = 0; i < order.length; i++) {
      n = order[i]; node = map[n];
      if (!node) continue;
      if (n === "facing_direction") {
        node.v = typeof node.v === "number" ? intCycle(node.v, [2, 5, 3, 4], t) : (typeof node.v === "string" ? cycle(node.v, ["north", "east", "south", "west"], t) : node.v);
      }
      else if (n === "direction" || n === "weirdo_direction") node.v = intCycle(node.v, [3, 0, 2, 1], t);
      else if (n === "ground_sign_direction" && typeof node.v === "number") node.v = (node.v + t * 4) % 16;
      else if ((n === "cardinal_direction" || n === "minecraft:cardinal_direction" || n === "torch_facing_direction" || n === "minecraft:block_face") && typeof node.v === "string") node.v = cycle(node.v, ["north", "east", "south", "west"], t);
      else if ((n === "pillar_axis" || n === "portal_axis") && typeof node.v === "string" && t % 2) node.v = node.v === "x" ? "z" : (node.v === "z" ? "x" : node.v);
      else if (n === "rail_direction") fail("Rail direcional ainda não possui tabela de rotação validada.");
      else if (n === "vine_direction_bits") fail("Vinhas direcionais ainda não possuem tabela de rotação validada.");
    }
    ["wall_connection_type_", "minecraft:connection_"].forEach(function (prefix) {
      var source = { north: map[prefix + "north"], east: map[prefix + "east"], south: map[prefix + "south"], west: map[prefix + "west"] };
      if (!source.north && !source.east && !source.south && !source.west) return;
      ["north", "east", "south", "west"].forEach(function (direction) {
        var key = prefix + direction;
        if (map[key]) map[key] = source[cycle(direction, ["north", "east", "south", "west"], (4 - t) % 4)];
      });
    });
    return N.encode({ t: N.T_COMPOUND, n: "", v: blockNode.v });
  }
  window.RC_builderTransform = { turns: turns, size: size, local: local, world: world, worldToThree: worldToThree, threeToWorld: threeToWorld, rotateStates: rotateStates };
})();
