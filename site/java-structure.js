/* Importação local e conservadora de uma região Litematica para o Builder. */
(function () {
  'use strict';
  function readNbt(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), at = 0;
    function need(n) { if (n < 0 || at + n > bytes.length) throw new Error('Arquivo Java incompleto.'); }
    function u8() { need(1); return view.getUint8(at++); }
    function i16() { need(2); var v = view.getInt16(at); at += 2; return v; }
    function i32() { need(4); var v = view.getInt32(at); at += 4; return v; }
    function i64() { need(8); var v = view.getBigInt64(at); at += 8; return v; }
    function str() { var n = i16(); need(n); var s = new TextDecoder().decode(bytes.subarray(at, at + n)); at += n; return s; }
    function payload(type, depth) {
      if (depth > 40) throw new Error('NBT Java muito profundo.');
      var n, i, obj, child, value;
      if (type === 1) return u8();
      if (type === 2) return i16();
      if (type === 3) return i32();
      if (type === 4) return i64();
      if (type === 5) { need(4); value = view.getFloat32(at); at += 4; return value; }
      if (type === 6) { need(8); value = view.getFloat64(at); at += 8; return value; }
      if (type === 7) { n = i32(); need(n); value = bytes.slice(at, at + n); at += n; return value; }
      if (type === 8) return str();
      if (type === 9) { child = u8(); n = i32(); if (n < 0 || n > 150000) throw new Error('Lista NBT grande demais.'); value = []; for (i = 0; i < n; i++) value.push(payload(child, depth + 1)); return value; }
      if (type === 10) { obj = {}; while ((child = u8()) !== 0) obj[str()] = payload(child, depth + 1); return obj; }
      if (type === 11 || type === 12) { n = i32(); if (n < 0 || n > 150000) throw new Error('Array NBT grande demais.'); value = []; for (i = 0; i < n; i++) value.push(type === 11 ? i32() : i64()); return value; }
      throw new Error('Tag NBT Java não suportada: ' + type);
    }
    if (u8() !== 10) throw new Error('Arquivo Java sem raiz NBT.');
    str(); return payload(10, 0);
  }
  function paletteEntry(name, states) {
    var N = window.RC_nbt2, stateNodes = {};
    Object.keys(states || {}).forEach(function (key) { stateNodes[key] = N.N(typeof states[key] === 'string' ? N.T_STRING : N.T_INT, key, states[key]); });
    var value = N.compound({ name: N.N(N.T_STRING, 'name', name), states: N.N(N.T_COMPOUND, 'states', N.compound(stateNodes)), version: N.N(N.T_INT, 'version', 17959425) });
    return { name: name, states: states || {}, raw: N.encode(N.N(N.T_COMPOUND, '', value)) };
  }
  var SIMPLE = /^(air|stone|granite|diorite|andesite|deepslate|cobbled_deepslate|cobblestone|mossy_cobblestone|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|sand|red_sand|gravel|clay|bricks|stone_bricks|mossy_stone_bricks|cracked_stone_bricks|chiseled_stone_bricks|nether_bricks|red_nether_bricks|blackstone|polished_blackstone|polished_basalt|basalt|smooth_basalt|calcite|tuff|dripstone_block|netherrack|end_stone|obsidian|crying_obsidian|glass|tinted_glass|glowstone|sea_lantern|prismarine|dark_prismarine|prismarine_bricks|quartz_block|smooth_quartz|purpur_block|amethyst_block|budding_amethyst|bedrock|coal_block|iron_block|gold_block|diamond_block|emerald_block|lapis_block|redstone_block|copper_block|raw_copper_block|raw_iron_block|raw_gold_block|snow_block|ice|packed_ice|blue_ice|magma_block|soul_sand|soul_soil|hay_block|melon|pumpkin|carved_pumpkin|jack_o_lantern|bookshelf|chiseled_bookshelf|scaffolding|sponge|wet_sponge|bone_block|slime_block|honey_block|terracotta|white_terracotta|orange_terracotta|magenta_terracotta|light_blue_terracotta|yellow_terracotta|lime_terracotta|pink_terracotta|gray_terracotta|light_gray_terracotta|cyan_terracotta|purple_terracotta|blue_terracotta|brown_terracotta|green_terracotta|red_terracotta|black_terracotta|(?:white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(?:concrete|concrete_powder|wool)|(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped)_planks)$/;
  var BEDROCK_NAMES = { stone_bricks: 'stonebrick', bricks: 'brick_block', grass_block: 'grass' };
  function convert(root) {
    var regions = root.Regions && Object.keys(root.Regions);
    if (!regions || regions.length !== 1) throw new Error('Escolha um .litematic com exatamente uma região.');
    var region = root.Regions[regions[0]], size = region.Size;
    if (!size) throw new Error('Região Litematica sem tamanho.');
    var dims = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)], volume = dims[0] * dims[1] * dims[2], C = window.RC_BUILDER_CONFIG;
    if (dims.some(function (n) { return !Number.isInteger(n) || n < 1 || n > C.MAX_SIDE; }) || volume > C.MAX_VOLUME) throw new Error('A região passa do limite de tamanho do construtor.');
    var source = region.BlockStatePalette, packed = region.BlockStates;
    if (!Array.isArray(source) || !source.length || !Array.isArray(packed)) throw new Error('Paleta ou blocos Litematica inválidos.');
    if ((region.TileEntities || []).length || (region.Entities || []).length) throw new Error('Esta região tem entidades ou dados de bloco especiais; exporte uma versão só com blocos.');
    var palette = source.map(function (entry) {
      var name = String(entry.Name || '');
      if (!/^minecraft:[a-z0-9_]+$/.test(name) || !SIMPLE.test(name.slice(10)) || (entry.Properties && Object.keys(entry.Properties).length)) throw new Error('Bloco Java ainda sem conversão segura: ' + name + '. Use blocos sólidos simples na estrutura.');
      return paletteEntry('minecraft:' + (BEDROCK_NAMES[name.slice(10)] || name.slice(10)));
    });
    var bits = Math.max(2, Math.ceil(Math.log2(palette.length))), mask = (1n << BigInt(bits)) - 1n;
    if (packed.length * 64 < volume * bits) throw new Error('Estados de blocos Litematica incompletos.');
    var blocks = [];
    for (var index = 0; index < volume; index++) {
      var offset = index * bits, word = Math.floor(offset / 64), shift = offset % 64;
      var id = (BigInt.asUintN(64, packed[word]) >> BigInt(shift)) & mask;
      if (shift + bits > 64) id |= (BigInt.asUintN(64, packed[word + 1]) << BigInt(64 - shift)) & mask;
      var block = palette[Number(id)];
      if (!block) throw new Error('Índice de bloco Java fora da paleta.');
      if (block.name === 'minecraft:air') continue;
      blocks.push({ x: index % dims[0], y: Math.floor(index / (dims[0] * dims[2])), z: Math.floor(index / dims[0]) % dims[2], block: block });
    }
    if (!blocks.length) throw new Error('A região está vazia.');
    return { size: dims, volume: volume, blocks: blocks, palette: palette, blockEntityData: {}, sourceEntities: [], issues: [] };
  }
  async function parse(file) {
    var bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 31 && bytes[1] === 139) {
      if (!window.DecompressionStream) throw new Error('Este navegador não consegue abrir o GZIP do .litematic.');
      bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Estrutura Java descompactada grande demais.');
    return convert(readNbt(bytes));
  }
  window.RC_javaStructure = { parse: parse, paletteEntry: paletteEntry };
})();
