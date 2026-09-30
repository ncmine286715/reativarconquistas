/* Worldify Builder — inserção segura de .mcstructure em mundos Bedrock.
   V1 deliberadamente conservadora:
   - apenas Overworld e chunks já visitadas;
   - apenas subchunks v8/v9 com paleta NBT local;
   - modos substituir, somente ar e ignorar ar da estrutura;
   - estruturas com entidades, dados de bloco (baús, placas etc.) ou segunda
     camada de blocos são recusadas, em vez de gerar um mundo incerto.
*/
(function () {
  "use strict";
  var BPW = { 1: 32, 2: 16, 3: 10, 4: 8, 5: 6, 6: 5, 8: 4, 16: 2 };
  var BITS = [1, 2, 3, 4, 5, 6, 8, 16];
  function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
  function get(node, name) { return node && node.v && node.v.map ? node.v.map[name] : null; }
  function list(node, type, label) {
    if (!node || node.t !== 9 || !node.v || (type !== undefined && node.v.e !== type)) fail("BUILDER_STRUCTURE_INVALID", label + " inválido.");
    return node.v.items || [];
  }
  function i32(node, label) { if (!node || node.t !== 3 || !isFinite(node.v)) fail("BUILDER_STRUCTURE_INVALID", label + " inválido."); return node.v | 0; }
  function mod(n, d) { return ((n % d) + d) % d; }
  function floorDiv(n, d) { return Math.floor(n / d); }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s; }
  function eq(a, b) { if (!a || !b || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function isAir(name) { return name === "minecraft:air" || name === "minecraft:cave_air" || name === "minecraft:void_air"; }
  /* Única fonte de verdade sobre vegetação (árvores etc.): preview, contagem
     e exportação usam esta função. */
  var VEGETATION_RE = /(_log$|_leaves$|tallgrass|tall_grass|short_grass|vine|sapling|flower(?!_pot)|fern|mushroom|sugar_cane|^minecraft:reeds|cocoa|bush$|azalea|propagule)/i;
  function isVegetation(name) { return VEGETATION_RE.test(String(name || "")); }
  function storageIndex(x, y, z) { return (x << 8) | (z << 4) | y; }
  function readI32(bytes, offset) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true); }

  function decodeStorage(bytes, offset) {
    var N = window.RC_nbt2;
    if (!N || !bytes || offset + 6 > bytes.length) return null;
    var head = bytes[offset], bits = head >> 1, network = head & 1, per = BPW[bits];
    if (network || !per) return null;
    var words = Math.ceil(4096 / per), paletteOffset = offset + 1 + words * 4;
    if (paletteOffset + 4 > bytes.length) return null;
    var count = readI32(bytes, paletteOffset);
    if (count < 1 || count > 4096) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), mask = (1 << bits) - 1;
    var idx = new Uint16Array(4096), i;
    for (i = 0; i < 4096; i++) idx[i] = (dv.getUint32(offset + 1 + ((i / per) | 0) * 4, true) >>> ((i % per) * bits)) & mask;
    var p = paletteOffset + 4, palette = [];
    for (i = 0; i < count; i++) {
      var parsed;
      try { parsed = N.parseAt(bytes, p); } catch (e) { return null; }
      var name = get(parsed.root, "name");
      if (!name || name.t !== 8) return null;
      palette.push({ raw: N.encode({ t: N.T_COMPOUND, n: "", v: parsed.root.v }), name: String(name.v) });
      p = parsed.end;
      if (p > bytes.length) return null;
    }
    return { bits: bits, idx: idx, palette: palette, end: p };
  }
  function decodeSubchunk(bytes) {
    if (!bytes || bytes.length < 6) return null;
    var version = bytes[0], count, offset;
    if (version === 9) { count = bytes[1]; offset = 3; }
    else if (version === 8) { count = bytes[1]; offset = 2; }
    else return null;
    if (count < 1 || count > 2) return null;
    var primary = decodeStorage(bytes, offset);
    if (!primary) return null;
    var secondary = null;
    if (count === 2) { secondary = decodeStorage(bytes, primary.end); if (!secondary) return null; }
    return { version: version, prefix: bytes.slice(0, offset), primary: primary, secondary: secondary };
  }
  function bitsFor(count) {
    for (var i = 0; i < BITS.length; i++) if (count <= Math.pow(2, BITS[i])) return BITS[i];
    fail("BUILDER_PALETTE_LIMIT", "A paleta da chunk excede o limite seguro.");
  }
  function concat(parts) {
    var size = 0, i, at = 0; for (i = 0; i < parts.length; i++) size += parts[i].length;
    var out = new Uint8Array(size); for (i = 0; i < parts.length; i++) { out.set(parts[i], at); at += parts[i].length; } return out;
  }
  function encodeStorage(storage) {
    var bits = bitsFor(storage.palette.length), per = BPW[bits], words = Math.ceil(4096 / per), body = new Uint8Array(1 + words * 4 + 4), dv = new DataView(body.buffer), i;
    body[0] = bits << 1;
    for (i = 0; i < 4096; i++) {
      var word = (i / per) | 0, shift = (i % per) * bits;
      dv.setUint32(1 + word * 4, (dv.getUint32(1 + word * 4, true) | ((storage.idx[i] & ((1 << bits) - 1)) << shift)) >>> 0, true);
    }
    dv.setInt32(1 + words * 4, storage.palette.length, true);
    return concat([body].concat(storage.palette.map(function (p) { return p.raw; })));
  }
  function encodeSubchunk(sub) { return concat([sub.prefix, encodeStorage(sub.primary)].concat(sub.secondary ? [encodeStorage(sub.secondary)] : [])); }
  function subKey(cx, cz, sub) {
    var b = new Uint8Array(10), dv = new DataView(b.buffer); dv.setInt32(0, cx, true); dv.setInt32(4, cz, true); b[8] = 47; dv.setInt8(9, sub); return b;
  }

  function parseStructure(bytes, options) {
    options = options || {};
    var N = window.RC_nbt2, T = window.RC_builderTransform;
    if (!N) fail("BUILDER_LOADING", "Módulo NBT ainda não carregou.");
    if (!T) fail("BUILDER_LOADING", "Módulo de transformação ainda não carregou.");
    var C = window.RC_BUILDER_CONFIG || {};
    if (!bytes || bytes.length > (C.MAX_STRUCTURE_BYTES || 20971520)) fail("BUILDER_SIZE", "O arquivo .mcstructure passa do limite de tamanho do Builder.");
    var root;
    try { root = N.parse(bytes).root; } catch (e) { fail("BUILDER_STRUCTURE_INVALID", "Não consegui ler este .mcstructure."); }
    var size = list(get(root, "size"), N.T_INT, "Tamanho").map(function (n) { return i32(n, "Tamanho"); });
    if (size.length !== 3 || size.some(function (n) { return n < 1 || n > (C.MAX_SIDE || 128); })) fail("BUILDER_SIZE", "A estrutura passa do limite de dimensões do Builder.");
    var volume = size[0] * size[1] * size[2];
    if (volume > (C.MAX_VOLUME || 120000)) fail("BUILDER_SIZE", "A estrutura passa do limite seguro de blocos.");
    var structure = get(root, "structure"), paletteRoot = get(get(structure, "palette"), "default");
    var paletteItems = list(get(paletteRoot, "block_palette"), N.T_COMPOUND, "Paleta de blocos");
    if (!paletteItems.length || paletteItems.length > (C.MAX_PALETTE || 4096)) fail("BUILDER_STRUCTURE_INVALID", "A paleta da estrutura é inválida.");
    var entities = get(structure, "entities"), positionData = get(paletteRoot, "block_position_data"), issues = [], specialData = {}, sourceEntities = [];
    // Listas NBT vazias carregam tipo 0 no Bedrock, mesmo quando normalmente
    // conteriam compounds. Por isso só validamos o tipo quando há entidades.
    if (entities && (!entities.v || !Array.isArray(entities.v.items))) fail("BUILDER_STRUCTURE_INVALID", "Entidades inválidas.");
    if (entities && entities.v.items.length) {
      if (entities.v.e !== N.T_COMPOUND) fail("BUILDER_STRUCTURE_INVALID", "Entidades inválidas.");
      sourceEntities = entities.v.items.slice();
      issues.push({ code: "BUILDER_ENTITIES", count: sourceEntities.length, message: "Esta estrutura contém entidades que ainda não podem ser inseridas com segurança." });
    }
    // Estruturas exportadas pelo próprio Structure Block costumam incluir o
    // bloco de origem com seus metadados. Ele não faz parte da construção que
    // o cliente quer copiar; omitimos somente esse bloco conhecido. Qualquer
    // outro block entity (baú, placa, command block...) continua recusado.
    var ignoredData = {}, specialCount = 0;
    if (positionData && positionData.v && positionData.v.order && positionData.v.order.length) {
      positionData.v.order.forEach(function (key) {
        var pos = positionData.v.map[key], data = get(pos, "block_entity_data"), id = get(data, "id"), at = Number(key);
        if (!data || !id || id.t !== 8 || !isFinite(at) || at < 0 || at % 1 || at >= volume) fail("BUILDER_BLOCK_DATA", "Dados especiais de bloco inválidos.");
        if (String(id.v) === "StructureBlock") ignoredData[at] = 1;
        else { specialData[at] = { id: String(id.v), raw: N.encode({ t: N.T_COMPOUND, n: "", v: pos.v }) }; specialCount++; }
      });
    }
    if (specialCount) issues.push({ code: "BUILDER_BLOCK_DATA", count: specialCount, message: "Esta estrutura contém " + specialCount + " bloco(s) com dados especiais (ex.: baú, cama ou placa), ainda não suportados com segurança." });
    var palette = paletteItems.map(function (entry) {
      var name = get(entry, "name");
      if (!name || name.t !== 8 || !/^minecraft:[a-z0-9_]+$/i.test(name.v)) fail("BUILDER_PALETTE", "A estrutura usa um bloco sem identificador Bedrock válido.");
      return { name: String(name.v), raw: N.encode({ t: N.T_COMPOUND, n: "", v: entry.v }), node: entry };
    });
    var layers = list(get(structure, "block_indices"), N.T_LIST, "Índices dos blocos");
    if (!layers.length) fail("BUILDER_STRUCTURE_INVALID", "A estrutura não possui blocos.");
    var primary = list(layers[0], N.T_INT, "Camada de blocos");
    if (primary.length !== volume) fail("BUILDER_STRUCTURE_INVALID", "A quantidade de blocos não combina com o tamanho da estrutura.");
    var secondLayerBlocks = 0;
    for (var l = 1; l < layers.length; l++) {
      var extra = list(layers[l], N.T_INT, "Camada extra");
      if (extra.length !== volume) fail("BUILDER_STRUCTURE_INVALID", "A camada extra possui tamanho inválido.");
      extra.forEach(function (n) { if (i32(n, "Índice") >= 0) secondLayerBlocks++; });
    }
    if (secondLayerBlocks) issues.push({ code: "BUILDER_WATERLOGGED", count: secondLayerBlocks, message: "Esta estrutura contém " + secondLayerBlocks + " bloco(s) na camada secundária/água, ainda não suportados com segurança." });
    var blocks = [], x, y, z;
    for (y = 0; y < size[1]; y++) for (z = 0; z < size[2]; z++) for (x = 0; x < size[0]; x++) {
      /* .mcstructure percorre Z, depois Y, depois X (ZYX). Esta fórmula é
         também usada pelas chaves de block_position_data. */
      var at = ((x * size[1]) + y) * size[2] + z, pi = i32(primary[at], "Índice");
      if (pi < 0 || ignoredData[at]) continue;
      if (pi >= palette.length) fail("BUILDER_STRUCTURE_INVALID", "Índice de paleta fora do limite.");
      blocks.push({ x: x, y: y, z: z, block: palette[pi] });
    }
    if (!blocks.length) fail("BUILDER_EMPTY", "A estrutura não possui blocos para construir.");
    if (!options.allowComplex && issues.length) fail(issues[0].code, issues[0].message);
    return { size: size, volume: volume, blocks: blocks, palette: palette, skippedStructureBlocks: Object.keys(ignoredData).length, blockEntityData: specialData, sourceEntities: sourceEntities, issues: issues };
  }

  function plan(data, structure, options) {
    options = options || {};
    var T = window.RC_builderTransform, C = window.RC_BUILDER_CONFIG || {}, ox = Number(options.x), oy = Number(options.y), oz = Number(options.z), dim = options.dimension == null ? 0 : Number(options.dimension), rotation = Number(options.rotation || 0);
    if (![ox, oy, oz, dim].every(isFinite) || ox % 1 || oy % 1 || oz % 1 || dim !== 0) fail("BUILDER_LOCATION", "Informe coordenadas inteiras no Overworld.");
    try { T.turns(rotation); } catch (e0) { fail("BUILDER_ROTATION", e0.message); }
    var finalSize = T.size(structure.size, rotation);
    if (oy < (C.MIN_Y == null ? -64 : C.MIN_Y) || oy + finalSize[1] - 1 > (C.MAX_Y == null ? 319 : C.MAX_Y)) fail("BUILDER_HEIGHT", "A construção fica fora da altura suportada pelo mundo.");
    var requestedLimit = Number(options.maxBlocks), clientLimit = Math.min(C.MAX_VOLUME || 120000, isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : (C.MAX_VOLUME || 120000));
    if (structure.blocks.length > clientLimit) fail("BUILDER_LIMIT", "Esta estrutura passa do limite do seu plano.");
    var mode = options.mode || "ignore_air";
    if (["ignore_air", "replace", "only_air"].indexOf(mode) < 0) fail("BUILDER_MODE", "Modo de construção inválido.");
    var records = {}, knownChunks = {}, entries = Array.from(data.db.keys.entries());
    entries.forEach(function (entry) {
      var kv = entry[1]; if (!kv || kv === false) return;
      var k; try { k = window.RC_dbx.parseChunkKey(kv.keyBytes); } catch (e) { return; }
      if (k && k.dim === 0 && k.tag === 47) {
        records[k.cx + "," + k.cz + "," + k.sub] = { kv: kv, value: kv.value };
        knownChunks[k.cx + "," + k.cz] = 1;
      }
    });
    /* O Bedrock não salva subchunks 100% ar (ex.: céu acima do terreno). Quando
       a construção alcança uma subchunk ausente DENTRO de chunk visitada,
       criamos uma subchunk de ar nova em vez de recusar: o jogo aceita
       subchunks esparsas. O ar reutiliza bytes NBT reais do próprio mundo. */
    var airRawCache = null, airScanned = false;
    function airRaw() {
      if (airRawCache) return airRawCache;
      if (airScanned) return null;
      airScanned = true;
      var ids = Object.keys(records), scanned = 0;
      for (var i = 0; i < ids.length && scanned < 50; i++) {
        var sub;
        try { sub = decodeSubchunk(records[ids[i]].value); } catch (e) { continue; }
        if (!sub) continue;
        scanned++;
        var layers = [sub.primary, sub.secondary];
        for (var l = 0; l < layers.length; l++) {
          if (!layers[l]) continue;
          for (var q = 0; q < layers[l].palette.length; q++) {
            if (isAir(layers[l].palette[q].name)) { airRawCache = layers[l].palette[q].raw; return airRawCache; }
          }
        }
      }
      return null;
    }
    var changes = {}, collisions = 0, placed = 0, replaced = 0, skipped = 0, createdSubchunks = 0, affectedChunks = {};
    var missingChunks = {}, missingBlocks = 0;
    structure.blocks.forEach(function (b) {
      if (mode !== "replace" && isAir(b.block.name)) { skipped++; return; }
      var finalPosition = T.world(b, structure.size, { x: ox, y: oy, z: oz }, rotation);
      var gx = finalPosition.x, gy = finalPosition.y, gz = finalPosition.z, cx = floorDiv(gx, 16), cz = floorDiv(gz, 16), sy = floorDiv(gy, 16);
      var id = cx + "," + cz + "," + sy, target = records[id];
      if (!target) {
        if (knownChunks[cx + "," + cz]) {
          var raw = airRaw();
          if (!raw) fail("BUILDER_SUBCHUNK", "Não encontrei ar de referência no mundo para criar a subchunk nova. Nenhuma alteração foi feita.");
          target = records[id] = { kv: { keyBytes: subKey(cx, cz, sy) }, value: null, fresh: { version: 8, prefix: new Uint8Array([8, 1]), primary: { bits: 1, idx: new Uint16Array(4096), palette: [{ name: "minecraft:air", raw: raw }] }, secondary: null } };
          createdSubchunks++;
        } else {
          missingChunks[cx + "," + cz] = 1; missingBlocks++;
          return;
        }
      }
      var item = changes[id];
      if (!item) {
        var sub = target.fresh || decodeSubchunk(target.value);
        if (!sub) fail("BUILDER_SUBCHUNK", "Uma chunk de destino usa formato não suportado. Nenhuma alteração foi feita.");
        item = changes[id] = { key: target.kv.keyBytes.slice(), sub: sub, writes: [] };
      }
      var local = storageIndex(mod(gx, 16), mod(gy, 16), mod(gz, 16)), existing = item.sub.primary.palette[item.sub.primary.idx[local]];
      if (!existing) fail("BUILDER_SUBCHUNK", "A paleta da chunk de destino está inválida.");
      if (!isAir(existing.name)) {
        collisions++;
        if (mode === "only_air") { skipped++; return; }
        replaced++;
      }
      var blockRaw;
      try { blockRaw = rotation ? T.rotateStates(window.RC_nbt2.parse(b.block.raw).root, rotation) : b.block.raw; } catch (stateError) { fail("BUILDER_STATE_ROTATION", stateError.message); }
      var wanted = hex(blockRaw), paletteIndex = -1;
      for (var p = 0; p < item.sub.primary.palette.length; p++) if (hex(item.sub.primary.palette[p].raw) === wanted) { paletteIndex = p; break; }
      if (paletteIndex < 0) { paletteIndex = item.sub.primary.palette.length; item.sub.primary.palette.push({ name: b.block.name, raw: blockRaw }); }
      item.sub.primary.idx[local] = paletteIndex;
      item.writes.push({ local: local, name: b.block.name, raw: blockRaw });
      placed++;
      affectedChunks[cx + "," + cz] = 1;
    });
    if (missingBlocks) {
      var missingList = Object.keys(missingChunks).slice(0, 8).join(', ');
      if (Object.keys(missingChunks).length > 8) missingList += '…';
      fail("BUILDER_UNVISITED", "A área de destino ainda não foi carregada no jogo (" + missingBlocks + " bloco(s) nas chunks " + missingList + "). Mova a construção para dentro da área colorida do mapa. Nenhuma alteração foi feita.");
    }
    /* Remover árvores: limpa troncos, copas e vegetação na área da base (até
       12 acima do topo, para copas altas), virando ar. Reaproveita subchunks
       já decodificadas acima; nunca toca em chunk não visitada. */
    /* Escreve ar reaproveitando a paleta (sem duplicar entradas iguais). */
    function setAir(item, local, air) {
      var want = hex(air), ai = -1;
      for (var i = 0; i < item.sub.primary.palette.length; i++) if (hex(item.sub.primary.palette[i].raw) === want) { ai = i; break; }
      if (ai < 0) { ai = item.sub.primary.palette.length; item.sub.primary.palette.push({ name: "minecraft:air", raw: air }); }
      item.sub.primary.idx[local] = ai;
      item.writes.push({ local: local, name: "minecraft:air", raw: air });
    }
    var cleared = 0, dug = 0;
    /* Pincel de terreno: mapa "x,y,z" -> nome do bloco. O NBT é roubado da
       paleta do próprio mundo (bloco que nunca apareceu lá é recusado). */
    var painted = 0, paletteCache = {};
    function paletteRaw(name) {
      if (paletteCache[name]) return paletteCache[name];
      var ids = Object.keys(records);
      for (var i = 0; i < ids.length && i < 200; i++) {
        var ps;
        try { ps = decodeSubchunk(records[ids[i]].value); } catch (e) { continue; }
        if (!ps) continue;
        var ls = [ps.primary, ps.secondary];
        for (var l = 0; l < ls.length; l++) {
          if (!ls[l]) continue;
          for (var q = 0; q < ls[l].palette.length; q++) {
            if (ls[l].palette[q].name === name) { paletteCache[name] = ls[l].palette[q].raw; return paletteCache[name]; }
          }
        }
      }
      return null;
    }
    var paintList = options.paint || null;
    if (paintList) {
      Object.keys(paintList).forEach(function (posKey) {
        var parts = String(posKey).split(',');
        if (parts.length !== 3) return;
        var px = Number(parts[0]), py = Number(parts[1]), pz = Number(parts[2]);
        if (!isFinite(px) || !isFinite(py) || !isFinite(pz) || px % 1 || py % 1 || pz % 1) return;
        var pcx = floorDiv(px, 16), pcz = floorDiv(pz, 16), psy = floorDiv(py, 16), pid = pcx + "," + pcz + "," + psy;
        if (!knownChunks[pcx + "," + pcz]) return;
        var pname = paintList[posKey];
        if (!/^minecraft:[a-z0-9_]+$/i.test(pname || "")) return;
        var praw = paletteRaw(pname);
        if (!praw) fail("BUILDER_PAINT", "O bloco " + pname + " nunca apareceu neste mundo, então não sei a versão exata dele. Pinte outro bloco que exista no terreno.");
        var pitem = changes[pid];
        if (!pitem) {
          var ptarget = records[pid];
          if (!ptarget || ptarget.fresh) return;
          var psub = null;
          try { psub = decodeSubchunk(ptarget.value); } catch (e) { return; }
          if (!psub) return;
          pitem = changes[pid] = { key: ptarget.kv.keyBytes.slice(), sub: psub, writes: [] };
        }
        var plocal = storageIndex(mod(px, 16), mod(py, 16), mod(pz, 16));
        var pwant = hex(praw), pi = -1;
        for (var k = 0; k < pitem.sub.primary.palette.length; k++) if (hex(pitem.sub.primary.palette[k].raw) === pwant) { pi = k; break; }
        if (pi < 0) { pi = pitem.sub.primary.palette.length; pitem.sub.primary.palette.push({ name: pname, raw: praw }); }
        pitem.sub.primary.idx[plocal] = pi;
        pitem.writes.push({ local: plocal, name: pname, raw: praw });
        painted++;
        affectedChunks[pcx + "," + pcz] = 1;
      });
    }
    if (options.clearTrees) {
      var decodedCache = {}, clearTop = oy + finalSize[1] + 12, vx, vy, vz;
      for (vx = ox; vx < ox + finalSize[0]; vx++) for (vz = oz; vz < oz + finalSize[2]; vz++) for (vy = oy; vy <= clearTop; vy++) {
        var vcx = floorDiv(vx, 16), vcz = floorDiv(vz, 16), vsy = floorDiv(vy, 16), vid = vcx + "," + vcz + "," + vsy;
        var vitem = changes[vid];
        if (!vitem) {
          var vtarget = records[vid];
          if (!vtarget || vtarget.fresh) continue;
          var vsub = decodedCache[vid];
          if (vsub === undefined) {
            try { vsub = decodedCache[vid] = decodeSubchunk(vtarget.value); } catch (e) { vsub = decodedCache[vid] = null; }
          }
          if (!vsub) continue;
          vitem = changes[vid] = { key: vtarget.kv.keyBytes.slice(), sub: vsub, writes: [] };
        }
        var vlocal = storageIndex(mod(vx, 16), mod(vy, 16), mod(vz, 16));
        var cur = vitem.sub.primary.palette[vitem.sub.primary.idx[vlocal]];
        if (!cur || !isVegetation(cur.name)) continue;
        var air = airRaw();
        if (!air) continue;
        setAir(vitem, vlocal, air);
        cleared++;
        affectedChunks[vcx + "," + vcz] = 1;
      }
    }
    /* Buracos da borracha no terreno: lista "x,y,z" virando ar. Só em chunk
       visitada; fora dela é ignorado com segurança. */
    var digList = options.dig || null;
    if (digList) {
      Object.keys(digList).forEach(function (posKey) {
        var parts = String(posKey).split(',');
        if (parts.length !== 3) return;
        var dx = Number(parts[0]), dy = Number(parts[1]), dz = Number(parts[2]);
        if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz) || dx % 1 || dy % 1 || dz % 1) return;
        var dcx = floorDiv(dx, 16), dcz = floorDiv(dz, 16), dsy = floorDiv(dy, 16), did = dcx + "," + dcz + "," + dsy;
        if (!knownChunks[dcx + "," + dcz]) return;
        var ditem = changes[did];
        if (!ditem) {
          var dtarget = records[did];
          if (!dtarget || dtarget.fresh) return;
          var dsub = null;
          try { dsub = decodeSubchunk(dtarget.value); } catch (e) { return; }
          if (!dsub) return;
          ditem = changes[did] = { key: dtarget.kv.keyBytes.slice(), sub: dsub, writes: [] };
        }
        var dlocal = storageIndex(mod(dx, 16), mod(dy, 16), mod(dz, 16));
        var dcur = ditem.sub.primary.palette[ditem.sub.primary.idx[dlocal]];
        if (!dcur || isAir(dcur.name)) return;
        var dair = airRaw();
        if (!dair) return;
        setAir(ditem, dlocal, dair);
        dug++;
        affectedChunks[dcx + "," + dcz] = 1;
      });
    }
    if (Object.keys(affectedChunks).length > (C.MAX_AFFECTED_CHUNKS || 64)) fail("BUILDER_LIMIT", "A construção afeta mais chunks do que o limite do Builder permite.");
    Object.keys(changes).forEach(function (key) { if (!changes[key].writes.length) delete changes[key]; });
    var ops = Object.keys(changes).map(function (key) { var c = changes[key]; return { t: "put", k: c.key, v: encodeSubchunk(c.sub) }; });
    return { origin: { x: ox, y: oy, z: oz }, rotation: rotation, finalSize: finalSize, mode: mode, structure: structure, changes: changes, ops: ops, collisions: collisions, placed: placed, replaced: replaced, skipped: skipped, cleared: cleared, dug: dug, painted: painted, createdSubchunks: createdSubchunks, affectedChunks: Object.keys(affectedChunks).length };
  }
  function verify(blob, build) {
    return window.RC_dbx.openFromBlob(blob).then(function (db) {
      var values = {};
      db.keys.forEach(function (kv) { if (kv && kv !== false && kv.keyBytes) values[hex(kv.keyBytes)] = kv.value; });
      Object.keys(build.changes).forEach(function (key) {
        var change = build.changes[key], value = values[hex(change.key)], sub = decodeSubchunk(value);
        if (!sub) fail("BUILDER_VERIFY", "A validação não conseguiu reler uma chunk alterada.");
        change.writes.forEach(function (w) {
          var p = sub.primary.palette[sub.primary.idx[w.local]];
          if (!p || p.name !== w.name || hex(p.raw) !== hex(w.raw)) fail("BUILDER_VERIFY", "A validação encontrou um bloco ou estado diferente do solicitado.");
        });
      });
      return true;
    });
  }
  function apply(worldFile, structureBytes, options) {
    var parsed = parseStructure(structureBytes);
    return window.RC_dbx.openWorld(worldFile).then(function (data) {
      var build = plan(data, parsed, options);
      if (!build.ops.length) return { blob: worldFile, build: build, structure: parsed, unchanged: true };
      var update = window.RC_ldbw.buildDbUpdate({ manifestBytes: data.manifestBytes, manifestName: data.manifestName, nextFile: data.nextFile, lastSeq: data.lastSeq, logNumber: data.logNumber, ops: build.ops });
      return window.RC_dbx.assemble(data, update.newManifestBytes, update.logName, update.logBytes).then(function (blob) { return verify(blob, build).then(function () { return { blob: blob, build: build, structure: parsed }; }); });
    });
  }
  window.RC_builderCore = { parseStructure: parseStructure, plan: plan, apply: apply, verify: verify, isVegetation: isVegetation, decodeSubchunk: decodeSubchunk, encodeSubchunk: encodeSubchunk, storageIndex: storageIndex, subKey: subKey, eq: eq };
})();
