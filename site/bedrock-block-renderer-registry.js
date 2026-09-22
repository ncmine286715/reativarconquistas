/* Regras visuais centralizadas para o preview Bedrock. */
(function () {
  "use strict";
  var defs = {
    "minecraft:grass_block": { type: "cube", top: "grass_block_top", side: "grass_block_side", bottom: "dirt" },
    "minecraft:dirt": { type: "cube", texture: "dirt" },
    "minecraft:stone": { type: "cube", texture: "stone" },
    "minecraft:cobblestone": { type: "cube", texture: "cobblestone" },
    "minecraft:sand": { type: "cube", texture: "sand" },
    "minecraft:gravel": { type: "cube", texture: "gravel" },
    "minecraft:clay": { type: "cube", texture: "clay" },
    "minecraft:bedrock": { type: "cube", texture: "bedrock" },
    "minecraft:oak_log": { type: "cube", side: "oak_log", top: "oak_log_top", bottom: "oak_log_top" },
    "minecraft:birch_log": { type: "cube", side: "birch_log", top: "birch_log_top", bottom: "birch_log_top" },
    "minecraft:spruce_log": { type: "cube", side: "spruce_log", top: "spruce_log_top", bottom: "spruce_log_top" },
    "minecraft:jungle_log": { type: "cube", side: "jungle_log", top: "jungle_log_top", bottom: "jungle_log_top" },
    "minecraft:oak_planks": { type: "cube", texture: "oak_planks" },
    "minecraft:birch_planks": { type: "cube", texture: "birch_planks" },
    "minecraft:spruce_planks": { type: "cube", texture: "spruce_planks" },
    "minecraft:leaves": { type: "cube", texture: "oak_leaves", alphaTest: 0.25 },
    "minecraft:oak_leaves": { type: "cube", texture: "oak_leaves", alphaTest: 0.25 },
    "minecraft:birch_leaves": { type: "cube", texture: "birch_leaves", alphaTest: 0.25 },
    "minecraft:spruce_leaves": { type: "cube", texture: "spruce_leaves", alphaTest: 0.25 },
    "minecraft:glass": { type: "cube", texture: "glass", transparent: true, opacity: 0.42 },
    "minecraft:water": { type: "cube", texture: "water_still", transparent: true, opacity: 0.62 },
    "minecraft:iron_ore": { type: "cube", texture: "iron_ore" },
    "minecraft:coal_ore": { type: "cube", texture: "coal_ore" },
    "minecraft:gold_ore": { type: "cube", texture: "gold_ore" },
    "minecraft:diamond_ore": { type: "cube", texture: "diamond_ore" }
  };
  function name(n) { return String(n || "minecraft:unknown_block"); }
  var stateCache = new WeakMap();
  function states(block) {
    if (!block) return {};
    if (block.states) return block.states;
    if (stateCache.has(block)) return stateCache.get(block);
    var node = block.node, out = {};
    if (!node && block.raw) { try { node = window.RC_nbt2.parse(block.raw).root; } catch (e) {} }
    var map = node && node.v && node.v.map && node.v.map.states;
    map = map && map.v && map.v.map;
    Object.keys(map || {}).forEach(function (k) { out[k] = map[k].v; });
    stateCache.set(block, out);
    return out;
  }
  function surface(n, s) {
    var wood = s.wood_type || s.new_log_type || s.old_log_type || 'oak';
    var aliases = { grass: 'grass_block', grass_path: 'dirt_path_top', stonebrick: 'stone_bricks', monster_egg: 'stone_bricks', wooden_door: 'oak_door', trapdoor: 'oak_trapdoor', flowing_water: 'water', noteblock: 'note_block', reeds: 'sugar_cane', web: 'cobweb', snow_layer: 'snow', lit_furnace: 'furnace', lit_redstone_ore: 'redstone_ore' };
    n = aliases[n] || n;
    if (n === 'planks' || n === 'wooden_slab' || n === 'double_wooden_slab') return wood + '_planks';
    if (n === 'log' || n === 'log2') return wood + '_log';
    if (n === 'leaves' || n === 'leaves2') return (s.old_leaf_type || s.new_leaf_type || 'oak') + '_leaves';
    if (n === 'fence') return wood + '_planks';
    if (n === 'tallgrass') return s.tall_grass_type === 'fern' ? 'fern' : 'short_grass';
    if (n === 'red_flower') return 'poppy';
    if (n === 'yellow_flower') return 'dandelion';
    if (n === 'carpet' || n === 'wool') return (s.color || 'white') + '_wool';
    if (n === 'stained_glass' || n === 'stained_glass_pane') return (s.color || 'white') + '_stained_glass';
    if (n === 'glass_pane') return 'glass';
    if (n === 'carrots' || n === 'potatoes') return n + '_stage3';
    if (n === 'sweet_berry_bush') return 'sweet_berry_bush_stage3';
    if (n === 'chest' || n === 'trapped_chest') return 'barrel_side';
    if (n === 'bed') return 'red_wool';
    if (n === 'campfire') return 'campfire_log';
    if (n === 'enchanting_table') return 'enchanting_table_top';
    if (/_stairs$|_slab$|_fence$|_fence_gate$|_wall$/.test(n)) {
      n = n.replace(/_(stairs|slab|fence_gate|fence|wall)$/, '');
      if (/^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)$/.test(n)) return n + '_planks';
      var bases = { stone: 'cobblestone', normal_stone: 'stone', stone_brick: 'stone_bricks', brick: 'bricks', nether_brick: 'nether_bricks', red_nether_brick: 'red_nether_bricks', quartz: 'quartz_block_side', purpur: 'purpur_block', end_brick: 'end_stone_bricks', sandstone: 'sandstone', smooth_sandstone: 'sandstone_top', smooth_quartz: 'quartz_block_side' };
      return bases[n] || n;
    }
    if (/_carpet$/.test(n)) return n.replace(/_carpet$/, '_wool');
    if (/_door$/.test(n)) return n + (s.upper_block_bit ? '_top' : '_bottom');
    return n;
  }
  function get(block) {
    var s = states(block), short = surface(name(block && block.name).replace(/^minecraft:/, ''), s), n = 'minecraft:' + short, d = defs[n];
    if (!d) {
      if (/^.*_log$/.test(n)) d = { type: "cube", side: short, top: short + "_top", bottom: short + "_top" };
      else if (/^.*_leaves$/.test(n)) d = { type: "cube", texture: short, alphaTest: 0.25 };
      else d = { type: "cube", texture: short };
    }
    if (d.texture) d = { type: d.type, top: d.texture, side: d.texture, bottom: d.texture, transparent: d.transparent, opacity: d.opacity, alphaTest: d.alphaTest };
    else d = Object.assign({}, d);
    if (/glass/.test(short)) { d.transparent = true; d.opacity = 0.6; }
    if (/leaves/.test(short)) { d.tint = /birch/.test(short) ? 0x80a755 : (/spruce/.test(short) ? 0x619961 : 0x78b84a); d.alphaTest = 0.4; }
    if (short === 'grass_block') d.topTint = 0x86b951;
    if (short === 'water') d.tint = 0x428bce;
    if (/short_grass|fern|poppy|dandelion|carrots|potatoes|berry|torch|door|vine|sapling|wheat/.test(short)) d.alphaTest = 0.4;
    if (short === 'farmland') { d.top = s.moisturized_amount > 0 ? 'farmland_moist' : 'farmland'; d.side = 'dirt'; d.bottom = 'dirt'; }
    if (/_log$/.test(short) && s.pillar_axis && s.pillar_axis !== 'y') d.axis = s.pillar_axis;
    return d;
  }
  function signature(block) { return JSON.stringify(get(block)); }
  window.RC_BedrockBlockRendererRegistry = { get: get, signature: signature, states: states };
})();
