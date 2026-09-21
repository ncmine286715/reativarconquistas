/* ReativaConquistas — Vista de blocos do mapa 2D (grátis, 100% local).
   Decodifica os subchunks paletizados (v8/v9, inspirado nos renderizadores
   open-source: Amulet/MCA Selector/prismarine) e desenha o topo de cada
   coluna (x,z) com a cor do bloco + sombreamento por altura. Água sem sombra.
   Chunks sem dados de terreno caem para a cor de ocupação (verde).
   Pesado só em mundos gigantes: acima de 2500 chunks, gera sob demanda.
*/
(function () {
  "use strict";

  var AUTO_CAP = 2500;
  var BPW = { 1: 32, 2: 16, 3: 10, 4: 8, 5: 6, 6: 5, 8: 4, 16: 2 };

  var C = {
    grass_block: [111, 175, 70], dirt: [134, 96, 67], coarse_dirt: [128, 100, 70], rooted_dirt: [125, 95, 65],
    podzol: [110, 85, 55], mycelium: [125, 105, 125], farmland: [115, 80, 50], dirt_with_roots: [125, 95, 65],
    grass_path: [150, 130, 85], mud: [100, 85, 70], muddy_mangrove_roots: [105, 80, 60], clay: [160, 165, 185],
    sand: [222, 210, 160], red_sand: [195, 125, 60], suspicious_sand: [222, 210, 160], suspicious_gravel: [150, 140, 135],
    gravel: [150, 140, 135], sandstone: [215, 200, 150], red_sandstone: [190, 120, 55], smooth_sandstone: [215, 200, 150],
    stone: [128, 128, 128], cobblestone: [110, 110, 110], mossy_cobblestone: [105, 125, 100], bedrock: [80, 80, 80],
    granite: [165, 120, 100], diorite: [200, 200, 200], andesite: [135, 135, 135],
    polished_granite: [170, 125, 105], polished_diorite: [205, 205, 205], polished_andesite: [140, 140, 140],
    deepslate: [80, 80, 88], cobbled_deepslate: [75, 75, 82], polished_deepslate: [85, 85, 92],
    deepslate_bricks: [75, 75, 85], deepslate_tiles: [70, 70, 80], tuff: [130, 125, 112], calcite: [228, 222, 212],
    smooth_basalt: [75, 75, 78], blackstone: [55, 48, 62], polished_blackstone: [60, 52, 66],
    polished_blackstone_bricks: [58, 50, 64], basalt: [72, 72, 76],
    coal_ore: [110, 110, 110], iron_ore: [190, 165, 150], gold_ore: [220, 190, 110], diamond_ore: [130, 220, 215],
    emerald_ore: [90, 200, 130], lapis_ore: [90, 120, 200], redstone_ore: [200, 90, 90], copper_ore: [190, 130, 100],
    nether_quartz_ore: [130, 70, 70], nether_gold_ore: [150, 80, 80],
    deepslate_coal_ore: [70, 70, 78], deepslate_iron_ore: [170, 150, 140], deepslate_gold_ore: [200, 175, 105],
    deepslate_diamond_ore: [115, 200, 195], deepslate_emerald_ore: [80, 185, 120], deepslate_lapis_ore: [80, 110, 190],
    deepslate_redstone_ore: [185, 80, 80], deepslate_copper_ore: [175, 120, 95],
    oak_log: [105, 85, 50], spruce_log: [85, 65, 40], birch_log: [200, 195, 175], jungle_log: [95, 80, 45],
    acacia_log: [150, 100, 60], dark_oak_log: [70, 55, 35], mangrove_log: [115, 75, 60], cherry_log: [200, 150, 160],
    crimson_stem: [130, 50, 70], warped_stem: [60, 140, 130], bamboo_block: [150, 170, 80],
    oak_planks: [170, 135, 80], spruce_planks: [130, 95, 55], birch_planks: [205, 185, 140], jungle_planks: [155, 115, 70],
    acacia_planks: [185, 130, 75], dark_oak_planks: [100, 75, 45], mangrove_planks: [175, 110, 85], cherry_planks: [225, 180, 175],
    crimson_planks: [140, 85, 100], warped_planks: [55, 150, 140], bamboo_planks: [185, 165, 95], bamboo_mosaic: [190, 170, 100],
    oak_leaves: [55, 135, 55], spruce_leaves: [45, 110, 65], birch_leaves: [125, 175, 90], jungle_leaves: [55, 140, 55],
    acacia_leaves: [70, 140, 60], dark_oak_leaves: [50, 125, 50], mangrove_leaves: [80, 150, 70], cherry_leaves: [235, 170, 190],
    azalea_leaves: [90, 160, 90], flowering_azalea_leaves: [120, 175, 120], nether_wart_block: [130, 30, 30],
    warped_wart_block: [60, 140, 130], shroomlight: [240, 170, 90], oak_sapling: [70, 150, 70],
    water: [63, 118, 228], flowing_water: [63, 118, 228], lava: [225, 95, 15], flowing_lava: [225, 95, 15],
    snow: [242, 250, 250], snow_layer: [242, 250, 250], ice: [165, 205, 238], packed_ice: [150, 190, 232],
    blue_ice: [120, 170, 225], frosted_ice: [170, 210, 240],
    glass: [215, 238, 242], tinted_glass: [60, 55, 70],
    netherrack: [112, 52, 52], soul_sand: [92, 72, 58], soul_soil: [85, 65, 55], glowstone: [250, 222, 150],
    magma: [185, 85, 45], obsidian: [28, 18, 45], crying_obsidian: [60, 30, 90], end_stone: [222, 226, 182],
    purpur_block: [172, 142, 172], chorus_plant: [140, 130, 140], chorus_flower: [200, 190, 190],
    bricks: [152, 96, 86], stonebrick: [122, 122, 122], mossy_stonebrick: [115, 130, 110],
    nether_bricks: [70, 35, 40], red_nether_bricks: [120, 40, 45], quartz_block: [236, 226, 210],
    smooth_quartz: [236, 226, 210], amethyst_block: [172, 142, 202], budding_amethyst: [160, 130, 195],
    copper_block: [202, 122, 72], iron_block: [222, 222, 222], gold_block: [252, 212, 62],
    diamond_block: [102, 222, 222], emerald_block: [62, 202, 122], lapis_block: [60, 100, 200],
    redstone_block: [200, 60, 50], netherite_block: [92, 86, 96], coal_block: [45, 45, 45],
    hay_block: [212, 182, 62], melon_block: [150, 190, 70], pumpkin: [200, 140, 50],
    bookshelf: [165, 135, 80], crafting_table: [150, 115, 65], furnace: [110, 110, 110], chest: [172, 132, 62],
    trapped_chest: [172, 132, 62], ender_chest: [50, 55, 60], barrel: [150, 110, 65], loom: [165, 135, 80],
    composter: [140, 105, 65], smoker: [110, 105, 100], blast_furnace: [95, 95, 100], grindstone: [130, 125, 120],
    stonecutter: [125, 120, 115], cartography_table: [150, 120, 75], fletching_table: [175, 145, 90],
    smithing_table: [120, 90, 70], lectern: [170, 135, 85], enchanting_table: [120, 70, 70], brewing_stand: [130, 110, 80],
    cauldron: [90, 90, 95], hopper: [100, 100, 100], dropper: [150, 150, 150], dispenser: [160, 160, 160],
    observer: [120, 120, 125], piston: [160, 140, 100], sticky_piston: [150, 150, 100], tnt: [222, 82, 52],
    sponge: [202, 192, 112], wet_sponge: [170, 175, 110], cobweb: [225, 225, 225],
    torch: [252, 222, 122], lantern: [252, 222, 150], soul_lantern: [120, 180, 200], campfire: [200, 140, 80],
    soul_campfire: [120, 170, 190], beacon: [200, 242, 242], conduit: [200, 200, 180], sea_lantern: [222, 232, 202],
    prismarine: [110, 170, 150], dark_prismarine: [70, 120, 100], prismarine_bricks: [100, 165, 145],
    sponge_block: [202, 192, 112], slime: [122, 202, 152], honey_block: [242, 182, 62], honeycomb_block: [230, 165, 55],
    cactus: [72, 142, 62], sugar_cane: [152, 192, 132], bamboo: [140, 175, 85],     kelp: [70, 140, 70],
    seagrass: [80, 150, 80], tallgrass: [92, 162, 72], short_grass: [95, 165, 75], fern: [92, 162, 72], large_fern: [92, 162, 72],
    dripstone_block: [140, 125, 110], pointed_dripstone: [150, 135, 120],
    vine: [62, 132, 62], glow_lichen: [140, 190, 170], lily_pad: [52, 142, 62], moss_block: [92, 152, 72],
    moss_carpet: [92, 152, 72], dripleaf: [70, 150, 80], small_dripleaf: [70, 150, 80], spore_blossom: [220, 150, 200],
    poppy: [220, 60, 60], dandelion: [240, 220, 60], oxeye_daisy: [235, 235, 235], cornflower: [90, 120, 220],
    tulip: [230, 120, 120], allium: [190, 140, 220], azure_bluet: [230, 230, 230], lily_of_the_valley: [235, 235, 235],
    wither_rose: [60, 50, 50], sunflower: [240, 210, 60], lilac: [190, 140, 210], peony: [230, 150, 180],
    rose_bush: [220, 70, 70], brown_mushroom: [150, 110, 90], red_mushroom: [200, 70, 60],
    wheat: [190, 180, 90], carrots: [220, 140, 60], potatoes: [170, 160, 90], beetroots: [170, 60, 70],
    melon_stem: [90, 150, 70], pumpkin_stem: [90, 150, 70], sweet_berry_bush: [90, 150, 90],
    nether_wart: [130, 40, 40], cocoa: [180, 120, 60], chorus_fruit: [200, 190, 190],
    scaffolding: [192, 172, 132], ladder: [150, 120, 70], rail: [150, 130, 100], bookshelf_block: [165, 135, 80],
    jukebox: [150, 110, 70], noteblock: [150, 110, 70], mob_spawner: [80, 80, 90], dragon_egg: [40, 30, 50],
    end_gateway: [30, 30, 40], end_portal: [30, 30, 45], nether_portal: [140, 60, 180],
    sculk: [32, 42, 58], sculk_catalyst: [40, 55, 65], sculk_shrieker: [90, 110, 100], sculk_sensor: [50, 90, 95],
    reinforced_deepslate: [60, 60, 70], trial_spawner: [120, 130, 140], vault: [150, 140, 120],
    crafter: [140, 130, 120], heavy_core: [150, 150, 160]
  };

  var DYE = {
    white: [235, 235, 235], orange: [230, 130, 40], magenta: [200, 90, 200], light_blue: [130, 180, 230],
    yellow: [240, 220, 70], lime: [140, 200, 60], pink: [240, 170, 200], gray: [120, 120, 120],
    light_gray: [175, 175, 175], silver: [175, 175, 175], cyan: [60, 160, 170], purple: [140, 80, 180],
    blue: [60, 80, 200], brown: [130, 95, 60], green: [90, 160, 60], red: [200, 60, 55], black: [40, 40, 40]
  };

  function colorFor(full) {
    if (!full) return null;
    var id = String(full).replace(/^minecraft:/, "");
    if (C[id]) return C[id];
    var k;
    // sufixos de construção herdam o material base
    var suf = ["_stairs", "_slab", "_wall", "_fence", "_fence_gate", "_door", "_trapdoor", "_button", "_pressure_plate", "_double_slab"];
    for (k = 0; k < suf.length; k++) {
      if (id.length > suf[k].length + 2 && id.slice(-suf[k].length) === suf[k]) {
        var base = id.slice(0, -suf[k].length);
        if (C[base]) return C[base];
        id = base; break;
      }
    }
    if (/(^|_)log$|(^|_)wood$|(^|_)stem$|(^|_)hyphae$/.test(id)) return /stripped/.test(id) ? [170, 135, 85] : [110, 85, 50];
    if (/leaves$/.test(id)) return [50, 135, 50];
    if (/sapling$|_roots$|propagule$/.test(id)) return [70, 150, 70];
    if (/planks$/.test(id)) return [170, 135, 80];
    if (/ore$/.test(id)) return /deepslate/.test(id) ? [85, 85, 92] : [130, 130, 130];
    if (/glass$/.test(id)) return [210, 235, 240];
    if (/ice$/.test(id)) return [170, 205, 235];
    if (/^wool$|_wool$|_carpet$|_bed$|_banner$|concrete|terracotta|_shulker_box$/.test(id)) {
      for (var d in DYE) if (id.indexOf(d) === 0 || id.indexOf("_" + d) > 0) return DYE[d];
      return [200, 200, 200];
    }
    if (/flower$|tulip$|daisy$|poppy$|bluet$|lilac$|peony$|blossom$/.test(id)) return [220, 100, 100];
    if (/mushroom/.test(id)) return [200, 120, 110];
    if (/candle$/.test(id)) return [240, 220, 170];
    if (/torch$/.test(id)) return [250, 220, 120];
    if (/rail$/.test(id)) return [150, 130, 100];
    if (/vine$/.test(id)) return [62, 132, 62];
    return [155, 155, 155]; // desconhecido: cinza neutro
  }
  function isAir(id) {
    return id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air" || /:air$/.test(id);
  }
  function isWater(id) {
    return id === "minecraft:water" || id === "minecraft:flowing_water";
  }

  /* ---------- decode de storage paletizado ---------- */
  function decodeStorage(v, o) {
    var N = window.RC_nbt2;
    if (!N || !v || o + 2 > v.length) return null;
    var h = v[o], bpb = h >> 1, net = h & 1;
    if (net) return null; // runtime IDs: sem mapa confiável
    var bpw = BPW[bpb];
    if (!bpw) return null;
    var dv;
    try { dv = new DataView(v.buffer, v.byteOffset, v.byteLength); } catch (e) { return null; }
    var nw = Math.ceil(4096 / bpw);
    if (o + 1 + nw * 4 + 4 > v.length) return null;
    var mask = (1 << bpb) - 1, idx = new Uint16Array(4096), i, wi, pos;
    for (i = 0; i < 4096; i++) {
      wi = (i / bpw) | 0; pos = (i % bpw) * bpb;
      idx[i] = (dv.getUint32(o + 1 + wi * 4, true) >>> pos) & mask;
    }
    var po = o + 1 + nw * 4, pc = dv.getInt32(po, true);
    if (pc < 1 || pc > 4096) return null;
    var p = po + 4, names = [];
    for (var j = 0; j < pc; j++) {
      var pr;
      try { pr = N.parseAt(v, p); } catch (e) { return null; }
      var m = pr.root && pr.root.v && pr.root.v.map;
      names.push((m && m.name) ? String(m.name.v) : "");
      p = pr.end;
      if (p > v.length) return null;
    }
    return { idx: idx, names: names, end: p };
  }

  function decodeSub(v) {
    if (!v || v.length < 6) return null;
    var ver = v[0], off, count;
    if (ver === 9) { count = v[1]; off = 3; }
    else if (ver === 8) { count = v[1]; off = 2; }
    else return null;
    if (count < 1 || count > 4) return null;
    var s0 = decodeStorage(v, off);
    if (!s0) return null;
    var out = { s0: s0, s1: null };
    if (count >= 2) {
      var s1 = decodeStorage(v, s0.end);
      if (s1) out.s1 = s1;
    }
    return out;
  }

  /* ---------- estado ---------- */
  var curFile = null, mode = "blocks", cache = {}; // cache[fileName] = {dims:{dim:{canvas,w,h,bounds,chunks:Set}}, counts}
  function key() { return (curFile && curFile.name) || ""; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.RC_dbx ? window.RC_dbx.esc(s) : String(s); }

  function paintBtn() {
    var b = $("mapTerrainBtn");
    if (!b) return;
    var c = cache[key()];
    if (!c || !c.terrain) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = mode === "blocks" ? "Vista: blocos ✓" : "Vista: simples";
  }

  // Constrói o canvas de terreno de UMA dimensão. Cb de progresso opcional.
  function buildDim(data, dim, bounds, onProg) {
    var c = cache[key()];
    var w = bounds.maxCx - bounds.minCx + 1, h = bounds.maxCz - bounds.minCz + 1;
    var cv = document.createElement("canvas");
    cv.width = w * 16; cv.height = h * 16;
    var ctx = cv.getContext("2d");
    var img = ctx.createImageData(cv.width, cv.height);
    // agrupa subchunks por chunk
    var subs = {}; // "cx,cz" -> [{sub, val}]
    var entries = Array.from(data.db.keys.entries());
    var i = 0, n = entries.length;
    function collect() {
      var end = Math.min(n, i + 4000);
      for (; i < end; i++) {
        var kv = entries[i][1];
        if (!kv || kv === false) continue;
        var b = null;
        try { b = kv.keyBytes; } catch (e) { continue; }
        if (!b || (b.length !== 10 && b.length !== 14)) continue;
        var dv;
        try { dv = new DataView(b.buffer, b.byteOffset, b.byteLength); } catch (e) { continue; }
        var cx, cz, dm, sub;
        if (b.length === 10) {
          if (b[8] !== 47) continue;
          cx = dv.getInt32(0, true); cz = dv.getInt32(4, true); dm = 0; sub = b[9];
        } else {
          if (b[12] !== 47) continue;
          cx = dv.getInt32(0, true); cz = dv.getInt32(4, true); dm = dv.getInt32(8, true);
          if (dm !== dim) continue; sub = b[13];
        }
        if (dm !== dim) continue;
        if (cx < bounds.minCx || cx > bounds.maxCx || cz < bounds.minCz || cz > bounds.maxCz) continue;
        var val = kv.value;
        if (!val || !val.length) continue;
        var sk = cx + "," + cz;
        (subs[sk] || (subs[sk] = [])).push({ sub: sub > 127 ? sub - 256 : sub, val: val });
      }
      if (i < n) {
        if (onProg) onProg(i, n);
        return tick().then(collect);
      }
      return Promise.resolve();
    }
    function render() {
      var list = Object.keys(subs), j = 0;
      function step() {
        var end = Math.min(list.length, j + 60);
        for (; j < end; j++) {
          paintChunk(subs[list[j]], list[j]);
        }
        if (j < list.length) {
          if (onProg) onProg(n, n, j, list.length);
          return tick().then(step);
        }
        return Promise.resolve();
      }
      return step();
    }
    function paintChunk(arr, sk) {
      var p = sk.split(","), cx = +p[0], cz = +p[1];
      var bx0 = (cx - bounds.minCx) * 16, by0 = (cz - bounds.minCz) * 16;
      arr.sort(function (a, b2) { return b2.sub - a.sub; });
      var dec = [];
      for (var s = 0; s < arr.length; s++) {
        var d = decodeSub(arr[s].val);
        if (d) dec.push({ sub: arr[s].sub, d: d });
      }
      if (!dec.length) return;
      for (var lx = 0; lx < 16; lx++) {
        for (var lz = 0; lz < 16; lz++) {
          var top = null;
          for (var k = 0; k < dec.length && !top; k++) {
            var baseY = dec[k].sub * 16;
            for (var y = 15; y >= 0; y--) {
              var nm = dec[k].d.s0.names[dec[k].d.s0.idx[(lx << 8) | (lz << 4) | y]];
              if (nm && !isAir(nm)) { top = { name: nm, y: baseY + y }; break; }
            }
            if (!top && dec[k].d.s1) {
              for (var y2 = 15; y2 >= 0; y2--) {
                var nm2 = dec[k].d.s1.names[dec[k].d.s1.idx[(lx << 8) | (lz << 4) | y2]];
                if (nm2 && !isAir(nm2)) { top = { name: nm2, y: baseY + y2 }; break; }
              }
            }
          }
          if (!top) continue;
          var col = colorFor(top.name);
          if (!col) continue;
          var f = isWater(top.name) ? 1 : Math.min(1.25, Math.max(0.7, 0.72 + ((top.y + 64) / 384) * 0.55));
          var o = ((by0 + lz) * cv.width + (bx0 + lx)) * 4;
          img.data[o] = Math.min(255, col[0] * f) | 0;
          img.data[o + 1] = Math.min(255, col[1] * f) | 0;
          img.data[o + 2] = Math.min(255, col[2] * f) | 0;
          img.data[o + 3] = 255;
        }
      }
    }
    return collect().then(render).then(function () {
      ctx.putImageData(img, 0, 0);
      var t = c.terrain || (c.terrain = {});
      t[dim] = { canvas: cv, w: w, h: h };
      var vis = window.RC_mapState && window.RC_mapState.activeDim;
      if (vis === dim || vis === undefined) {
        window.RC_terrainLayer = { dim: dim, canvas: cv };
      }
      paintBtn();
      try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e) {}
    });
  }

  function ensure() {
    var k = key();
    if (!k || !window.RC_dbx || !window.RC_mapState || !window.RC_mapState.counts) return;
    var c = cache[k];
    var total = Object.keys(window.RC_mapState.counts).reduce(function (a, d) { return a + window.RC_mapState.counts[d]; }, 0);
    if (!c) {
      c = cache[k] = { total: total, terrain: null, building: false };
      if (total > AUTO_CAP) { paintBtn(); return; } // gigante: sob demanda
    }
    if (c.building || (c.terrain && c.terrain[window.RC_mapState.activeDim])) {
      // garante a camada da dimensão ativa
      var t = c.terrain && c.terrain[window.RC_mapState.activeDim];
      if (t && mode === "blocks") window.RC_terrainLayer = { dim: window.RC_mapState.activeDim, canvas: t.canvas };
      paintBtn();
      return;
    }
    if (mode !== "blocks") return;
    c.building = true;
    var st = $("mapStats");
    var oldMsg = st ? st.innerHTML : "";
    var b0 = $("mapTerrainBtn");
    if (b0) b0.textContent = "Pintando…";
    window.RC_dbx.openWorld(curFile).then(function (data) {
      var dims = Object.keys(window.RC_mapState.boundsByDim || {}).map(Number);
      var chain = Promise.resolve();
      dims.forEach(function (dim) {
        chain = chain.then(function () {
          if ((cache[k].terrain || {})[dim]) return null;
          if (st) st.innerHTML = '<span class="spin"></span> Pintando blocos (' + (dim === 0 ? "Overworld" : dim === 1 ? "Nether" : "End") + ')…';
          return buildDim(data, dim, window.RC_mapState.boundsByDim[dim], function () {});
        });
      });
      return chain;
    }).then(function () {
      c.building = false;
      if (st) st.innerHTML = oldMsg;
      paintBtn();
      try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e) {}
    }).catch(function (err) {
      c.building = false;
      mode = "simple";
      window.RC_terrainLayer = null;
      paintBtn();
      try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e) {}
    });
  }

  function bind() {
    var input = $("file"), drop = $("drop");
    function track(f) {
      curFile = f; mode = "blocks";
      window.RC_terrainLayer = null;
      if (window.RC_mapDraw) { try { window.RC_mapDraw(); } catch (e) {} }
    }
    if (input) input.addEventListener("change", function () {
      var f = (input.files && input.files[0]) || null;
      if (f && !/\.dat$/i.test(f.name || "")) { track(f); setTimeout(ensure, 2500); }
      else { curFile = null; window.RC_terrainLayer = null; }
    });
    if (drop) drop.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && !/\.dat$/i.test(f.name || "")) { track(f); setTimeout(ensure, 2500); }
    });
    // reconfere quando o mapa termina (hook simples via clique nas abas de dimensão)
    document.addEventListener("click", function (e) {
      if (e.target && e.target.classList && (e.target.classList.contains("map-dim") || (e.target.id === "mapTerrainBtn"))) {
        if (e.target.id === "mapTerrainBtn") {
          mode = (mode === "blocks") ? "simple" : "blocks";
          var c = cache[key()];
          if (mode === "blocks") {
            var t = c && c.terrain && c.terrain[window.RC_mapState.activeDim];
            if (t) window.RC_terrainLayer = { dim: window.RC_mapState.activeDim, canvas: t.canvas };
            else if (c && c.total > AUTO_CAP) {
              // gigante: gera agora (com confirmação de peso implícita no clique)
              ensureForce();
              return;
            } else { ensure(); return; }
          } else window.RC_terrainLayer = null;
          paintBtn();
          try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e2) {}
        } else {
          setTimeout(function () {
            var c2 = cache[key()];
            var t2 = c2 && c2.terrain && c2.terrain[window.RC_mapState.activeDim];
            if (mode === "blocks" && t2) window.RC_terrainLayer = { dim: window.RC_mapState.activeDim, canvas: t2.canvas };
            else if (mode === "blocks") ensure();
            try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e3) {}
          }, 60);
        }
      }
    });
    // quando o mapa 2D termina de desenhar, tenta a vista de blocos
    var obsT = 0;
    setInterval(function () {
      if (!curFile || !window.RC_mapState || !window.RC_mapState.counts) return;
      var now = Date.now();
      if (now - obsT < 4000) return;
      obsT = now;
      var c = cache[key()];
      if (!c) { ensure(); }
    }, 2000);
  }

  function ensureForce() {
    var k = key();
    var c = cache[k] || (cache[k] = { total: 0, terrain: null, building: false });
    c.building = true;
    var b = $("mapTerrainBtn");
    if (b) b.textContent = "Pintando…";
    window.RC_dbx.openWorld(curFile).then(function (data) {
      var dims = Object.keys(window.RC_mapState.boundsByDim || {}).map(Number);
      var chain = Promise.resolve();
      dims.forEach(function (dim) {
        chain = chain.then(function () {
          if ((cache[k].terrain || {})[dim]) return null;
          return buildDim(data, dim, window.RC_mapState.boundsByDim[dim], function () {});
        });
      });
      return chain;
    }).then(function () {
      c.building = false;
      var t = (cache[k].terrain || {})[window.RC_mapState.activeDim];
      if (t) window.RC_terrainLayer = { dim: window.RC_mapState.activeDim, canvas: t.canvas };
      paintBtn();
      try { if (window.RC_mapDraw) window.RC_mapDraw(); } catch (e) {}
    }).catch(function () {
      c.building = false;
      mode = "simple"; window.RC_terrainLayer = null;
      paintBtn();
    });
  }

  window.RC_terrain = { ensure: ensure, ensureForce: ensureForce };
  window.RC_terrainTest = { decodeSub: decodeSub, decodeStorage: decodeStorage, colorFor: colorFor, isAir: isAir };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
