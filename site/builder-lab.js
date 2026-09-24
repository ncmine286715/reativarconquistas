/* Builder Lab: visualizador local. Não envia arquivos nem escreve no mundo. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = { world: null, worldFile: null, structure: null, structureFile: null, records: {}, decoded: {}, regions: [], mapRegions: [], mapView: null, scene: null, camera: null, renderer: null, controls: null, terrain: null, placed: null, textures: {}, materials: {}, geometries: {}, drag: null, decodeStats: null, terrainInfo: null, chunkPreview: null, missingTextures: {}, erased: {}, dig: {}, paint: {}, playerPos: null, playerPin: null, gizmo: null, gizmoMode: 'translate', mobs: [], mobGroup: null, mapZoom: 1 };
  var materialRows = [];
  var AIR = /^minecraft:(air|cave_air|void_air)$/;
  state.tool = 'orbit'; state.placementMode = 'map'; state.dirty = true; state.history = new window.RC_Placement.History();
  state.worldGeneration = 0; state.structureGeneration = 0; state.terrainKey = null;
  function invalidate() { state.dirty = true; }
  function hint(message) { $('placementHint').textContent = message; }
  function placement() { var p = offset(); p.rotation = Number($('rotation').value); return p; }
  function updatePlacementSummary() {
    var slot = $('placementSummary'); if (!slot) return;
    if (!state.structure) { slot.textContent = 'Escolha uma construção e toque na área visitada do mapa.'; return; }
    var p = placement(), s = window.RC_builderTransform.size(state.structure.size, p.rotation);
    slot.textContent = state.structure.blocks.length.toLocaleString('pt-BR') + ' blocos · ' + s.join(' × ') + ' · X ' + p.x + ' · Y ' + p.y + ' · Z ' + p.z + ' · ' + p.rotation + '°';
  }
  function setPlacementMode(mode) {
    if (mode !== 'map' && mode !== '3d' && mode !== 'coords') return;
    state.placementMode = mode; $('result').dataset.placementMode = mode;
    document.querySelectorAll('[data-placement-mode]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.placementMode === mode)); });
    if (mode === '3d') {
      init3d();
      if (!state.renderer) { state.placementMode = 'map'; $('result').dataset.placementMode = 'map'; document.querySelectorAll('[data-placement-mode]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.placementMode === 'map')); }); $('webglFallback').hidden = false; hint('3D indisponível. Use o mapa ou as coordenadas.'); return; }
      $('webglFallback').hidden = true; updatePlayerPin(); rebuildMobs(); rebuildTerrain(); rebuildStructure(); focus();
    } else { $('webglFallback').hidden = true; updatePlacementSummary(); }
  }
  function updateHistory() {
    $('undoPosition').disabled = state.history.index <= 0;
    $('redoPosition').disabled = state.history.index >= state.history.items.length - 1;
  }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function isAir(name) { return AIR.test(name || ""); }
  function getState(block, key) {
    if (window.RC_BedrockBlockRendererRegistry) return window.RC_BedrockBlockRendererRegistry.states(block)[key];
    var node = block && block.node;
    if (!node && block && block.raw) { try { node = window.RC_nbt2.parse(block.raw).root; } catch (e) {} }
    var states = node && node.v && node.v.map && node.v.map.states;
    return states && states.v && states.v.map && states.v.map[key] ? states.v.map[key].v : undefined;
  }
  function textureName(block) {
    var n = String(block.name || "").replace(/^minecraft:/, ""), wood = getState(block, "wood_type") || getState(block, "new_log_type") || getState(block, "old_log_type");
    if (n === "grass") return "grass_block_top";
    if (n === "grass_path") return "dirt_path_top";
    if (n === "stonebrick" || n === "monster_egg") return "stone_bricks";
    if (n === "cobblestone_wall") return "cobblestone";
    if (n === "glass_pane" || n === "stained_glass_pane") return "glass";
    if (n === "water") return "water_still";
    if (n === "planks" || n === "wooden_slab") return (wood || "oak") + "_planks";
    if (/stairs$/.test(n)) return n.indexOf("stone_brick") >= 0 ? "stone_bricks" : (n.replace(/_stairs$/, "") + "_planks");
    if (/fence|fence_gate/.test(n)) return n.replace(/_(fence|fence_gate)$/, "") + "_planks";
    if (/door$/.test(n)) return n + "_bottom";
    if (/trapdoor$/.test(n)) return n;
    if (/log$/.test(n)) return n;
    if (n === "leaves" || n === "leaves2") return (getState(block, "old_leaf_type") || getState(block, "new_leaf_type") || "oak") + "_leaves";
    if (/furnace$/.test(n)) return n + "_front";
    if (n === "chest") return "barrel_side";
    if (n === "campfire") return "campfire_log";
    if (n === "enchanting_table") return "enchanting_table_top";
    if (n === "tallgrass") return getState(block, "tall_grass_type") === "fern" ? "fern" : "short_grass";
    if (n === "red_flower") return "poppy";
    if (n === "farmland") return getState(block, "moisturized_amount") > 0 ? "farmland_moist" : "farmland";
    if (n === "carrots") return "carrots_stage3";
    if (n === "potatoes") return "potatoes_stage3";
    if (n === "sweet_berry_bush") return "sweet_berry_bush_stage3";
    if (/carpet$/.test(n)) return n.replace(/_carpet$/, "_wool");
    return n;
  }
  function color(name) { var h = 0, i; for (i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0; return (h >>> 0) % 0xffffff; }
  function loadMaterial(texture, block, ghost, face) {
    var def = window.RC_BedrockBlockRendererRegistry ? window.RC_BedrockBlockRendererRegistry.get(block) : {};
    var transparent = !!def.transparent, opacity = def.opacity || 1;
    var tint = face === 'top' ? (def.topTint || def.tint || 0xffffff) : (def.tint || 0xffffff);
    var key = [texture, ghost ? 'g' : 'w', face, tint, opacity, def.alphaTest || 0].join(':'), m = state.materials[key], THREE = window.THREE;
    if (m) return m;
    /* Material sem iluminação: preserva as cores pixeladas da textura e evita
       o branco estourado visto com MeshLambert em assets de 16x16. */
    m = state.materials[key] = new THREE.MeshBasicMaterial({ color: tint, transparent: transparent || ghost, opacity: ghost ? Math.min(opacity, 0.58) : opacity, depthWrite: !transparent && !ghost, alphaTest: ghost ? 0 : def.alphaTest || 0, side: THREE.FrontSide, polygonOffset: !!ghost, polygonOffsetFactor: ghost ? -1 : 0, polygonOffsetUnits: ghost ? -1 : 0 });
    m.userData.textureTint = tint;
    if (state.textures[texture] === undefined) {
      state.textures[texture] = "loading";
      new THREE.TextureLoader().load("mc/block/" + texture + ".png", function (t) {
        t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.encoding = THREE.sRGBEncoding || 3001;
        if (t.image.height > t.image.width && t.image.height % t.image.width === 0) t.repeat.y = t.image.width / t.image.height;
        t.anisotropy = Math.min(4, state.renderer.capabilities.getMaxAnisotropy());
        state.textures[texture] = t;
        Object.keys(state.materials).forEach(function (k) { if (k.split(":")[0] === texture) { state.materials[k].map = t; state.materials[k].color.set(state.materials[k].userData.textureTint); state.materials[k].needsUpdate = true; } });
        invalidate();
      }, undefined, function () {
        /* Placeholder magenta = bloco sem textura mapeada. Nunca invisível:
           assim descobrimos quais blocos ainda precisam de suporte no registry. */
        state.textures[texture] = null; state.missingTextures[texture] = (state.missingTextures[texture] || 0) + 1; Object.keys(state.materials).forEach(function (k) { if (k.indexOf(texture + ":") === 0) { state.materials[k].map = null; state.materials[k].color.set(0xff00ff); state.materials[k].needsUpdate = true; } }); });
    }
    if (state.textures[texture] && state.textures[texture] !== "loading") { m.map = state.textures[texture]; }
    if (state.textures[texture] === null) m.color.set(0xff00ff);
    return m;
  }
  function materialsFor(block, ghost) {
    var def = window.RC_BedrockBlockRendererRegistry ? window.RC_BedrockBlockRendererRegistry.get(block) : { top: textureName(block), side: textureName(block), bottom: textureName(block) };
    var side = loadMaterial(def.side, block, ghost, 'side');
    if (def.side === def.top && def.side === def.bottom && !def.topTint) return side;
    var top = loadMaterial(def.top, block, ghost, 'top'), bottom = loadMaterial(def.bottom, block, ghost, 'bottom');
    if (def.axis === 'x') return [top, bottom, side, side, side, side];
    if (def.axis === 'z') return [side, side, side, side, top, bottom];
    return [side, side, top, bottom, side, side];
  }
  function shape(block) {
    var n = String(block.name || "").replace(/^minecraft:/, ""), THREE = window.THREE, kind = "cube", rotate = 0, geo;
    if (/trapdoor$/.test(n)) kind = "trapdoor";
    else if (/door$/.test(n)) { kind = "door"; rotate = Number(getState(block, "direction") || 0) * Math.PI / 2; }
    else if (/stairs$/.test(n)) { kind = "stairs"; rotate = Number(getState(block, "weirdo_direction") || 0) * Math.PI / 2; }
    else if (/trapdoor$/.test(n)) kind = "trapdoor";
    else if (/slab$/.test(n) && !/double/.test(n)) kind = "slab";
    else if (/pane$/.test(n)) kind = "pane";
    else if (/fence|wall/.test(n)) kind = "fence";
    else if (n === "chest" || n === "barrel") kind = "chest";
    else if (/carpet$/.test(n)) kind = "carpet";
    geo = state.geometries[kind];
    if (!geo) {
      if (kind === "door") geo = new THREE.BoxGeometry(1, 1, .1875);
      else if (kind === "stairs") { geo = new THREE.Geometry(); geo.merge(new THREE.BoxGeometry(1, .5, 1), new THREE.Matrix4().makeTranslation(0, -.25, 0)); geo.merge(new THREE.BoxGeometry(1, .5, .5), new THREE.Matrix4().makeTranslation(0, .25, -.25)); geo = new THREE.BufferGeometry().fromGeometry(geo); }
      else if (kind === "trapdoor") geo = new THREE.BoxGeometry(1, .1875, 1);
      else if (kind === "slab") geo = new THREE.BoxGeometry(1, .5, 1);
      else if (kind === "pane") geo = new THREE.BoxGeometry(.12, 1, 1);
      else if (kind === "fence") geo = new THREE.BoxGeometry(.28, 1, .28);
      else if (kind === "chest") geo = new THREE.BoxGeometry(.88, .88, .88);
      else if (kind === "carpet") geo = new THREE.BoxGeometry(1, .06, 1);
      else geo = new THREE.BoxGeometry(1, 1, 1);
      state.geometries[kind] = geo;
    }
    var upper = !!getState(block, 'top_slot_bit') || getState(block, 'minecraft:vertical_half') === 'top';
    var dy = kind === 'slab' ? (upper ? .25 : -.25) : kind === 'carpet' ? -.47 : kind === 'trapdoor' ? (upper ? .40625 : -.40625) : 0;
    return { geo: geo, key: kind + ":" + rotate + ':' + dy, rotate: rotate, dy: dy };
  }
  function addInstances(parent, entries, ghost) {
    var THREE = window.THREE, groups = {}, matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    entries.forEach(function (entry) {
      var s = shape(entry.block), sig = window.RC_BedrockBlockRendererRegistry ? window.RC_BedrockBlockRendererRegistry.signature(entry.block) : textureName(entry.block), key = s.key + ":" + sig, g = groups[key];
      if (!g) g = groups[key] = { list: [], shape: s, material: materialsFor(entry.block, ghost) };
      g.list.push(entry);
    });
    Object.keys(groups).forEach(function (key) {
      var g = groups[key], mesh = new THREE.InstancedMesh(g.shape.geo, g.material, g.list.length);
      mesh.userData.builderStructure = !!ghost;
      mesh.userData.entries = g.list;
      // r124 has no aggregate instance bounding box for frustum culling.
      mesh.frustumCulled = false;
      g.list.forEach(function (entry, i) {
        var worldPos = window.RC_builderTransform.worldToThree(entry.x, entry.y, entry.z);
        pos.set(worldPos.x + .5, worldPos.y + .5 + g.shape.dy, worldPos.z + .5); quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.shape.rotate);
        matrix.compose(pos, quat, scale); mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true; parent.add(mesh);
    });
  }
  function init3d() {
    if (state.renderer) return;
    if (!window.THREE) {
      $('webglFallback').hidden = false;
      $('terrainStats').textContent = 'Preview 3D indisponível';
      hint('O Three.js não carregou (sem internet e vendor/three.min.js ausente?). O mapa 2D continua funcionando; recarregue com internet.');
      return;
    }
    var THREE = window.THREE, box = $("preview");
    /* Céu de dia estilo Minecraft: fundo, nevoeiro e luz combinando para o
       terreno derreter no horizonte sem borda quadrada. */
    state.skyColor = 0x87ceeb;
    state.scene = new THREE.Scene(); state.scene.background = new THREE.Color(state.skyColor);
    state.scene.fog = new THREE.Fog(state.skyColor, 220, 1400);
    state.camera = new THREE.PerspectiveCamera(52, box.clientWidth / box.clientHeight, .1, 1500);
    state.camera.position.set(27, 24, 27);
    /* Celular fraco (J2): pixelRatio 1 evita derreter a GPU; no PC mantém até 2. */
    var coarseScreen = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) || Math.min(box.clientWidth, box.clientHeight) < 420;
    try { state.renderer = new THREE.WebGLRenderer({ antialias: !coarseScreen, powerPreference: "high-performance" }); }
    catch (error) { state.scene = null; state.camera = null; $('webglFallback').hidden = false; $('terrainStats').textContent = '3D indisponível'; hint('Este dispositivo não conseguiu abrir o 3D. O mapa e as coordenadas continuam disponíveis.'); return; }
    state.renderer.setPixelRatio(coarseScreen ? 1 : Math.min(window.devicePixelRatio || 1, 2)); state.renderer.setSize(box.clientWidth, box.clientHeight); state.renderer.outputEncoding = THREE.sRGBEncoding || 3001; box.appendChild(state.renderer.domElement);
    state.controls = new THREE.OrbitControls(state.camera, state.renderer.domElement); state.controls.enableDamping = true; state.controls.target.set(0, 0, 0); state.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; state.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    state.controls.touches.ONE = THREE.TOUCH.ROTATE; state.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    state.controls.addEventListener('change', invalidate);
    state.hemi = new THREE.HemisphereLight(0xe8f6ff, 0x5d7a52, 2.5); state.scene.add(state.hemi);
    state.sun = new THREE.DirectionalLight(0xfff6e0, 2); state.sun.position.set(20, 35, 12); state.scene.add(state.sun);
    /* Chão distante: apanhador de vazio que derrete no nevoeiro no horizonte. */
    state.farGround = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: 0x6fa055 }));
    state.farGround.rotation.x = -Math.PI / 2; state.farGround.position.y = -66; state.farGround.frustumCulled = false;
    state.scene.add(state.farGround);
    state.selectionBox = new THREE.Box3();
    state.outline = new THREE.Box3Helper(state.selectionBox, 0x65d7ff);
    state.outline.material.depthTest = false; state.outline.renderOrder = 10; state.outline.visible = false; state.scene.add(state.outline);
    function frame() { requestAnimationFrame(frame); state.controls.update(); if (state.dirty && !document.hidden) { state.renderer.render(state.scene, state.camera); state.dirty = false; } } frame();
    new ResizeObserver(function () { if (!state.renderer) return; var w = Math.max(1, box.clientWidth), h = Math.max(1, box.clientHeight); state.camera.aspect = w / h; state.camera.updateProjectionMatrix(); state.renderer.setSize(w, h); invalidate(); }).observe(box);
    wireDrag();
  }
  function cloudHash(x, z) { var h = (x * 374761393 + z * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  function updateSkyDecor(centerX, centerZ, minY) {
    /* Nuvens quadradas + chão distante seguem o centro do preview. */
    if (!window.THREE || !state.scene) return;
    var THREE = window.THREE;
    if (state.farGround) state.farGround.position.set(centerX, Math.min(isFinite(minY) ? minY - 2 : -66, -60), centerZ);
    if (state.clouds) {
      state.clouds.traverse(function (m) { if (m.geometry) m.geometry.dispose(); });
      state.scene.remove(state.clouds); state.clouds = null;
    }
    if (!state.cloudMat) state.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82 });
    state.clouds = new THREE.Group();
    for (var i = 0; i < 16; i++) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(9 + cloudHash(i, 101) * 16, 2.2, 7 + cloudHash(i, 151) * 10), state.cloudMat);
      m.position.set(centerX + (cloudHash(i, 7) - 0.5) * 260, 118 + cloudHash(i, 201) * 14, centerZ + (cloudHash(i, 31) - 0.5) * 260);
      m.frustumCulled = false;
      state.clouds.add(m);
    }
    state.scene.add(state.clouds);
    invalidate();
  }
  function clear(group) {
    if (!group) return;
    group.traverse(function (mesh) { if (mesh.isInstancedMesh) { mesh.userData.entries = []; if (mesh.dispose) mesh.dispose(); else mesh.dispatchEvent({ type: 'dispose' }); } });
    if (group.parent) group.parent.remove(group);
    invalidate();
  }
  function floorDiv(n, d) { return Math.floor(n / d); }
  function mod(n, d) { return ((n % d) + d) % d; }
  function worldBlock(x, y, z) {
    if (state.dig[x + ',' + y + ',' + z]) return null;
    var painted = state.paint[x + ',' + y + ',' + z];
    if (painted) return { name: painted, states: {} };
    if (state.chunkPreview) return state.chunkPreview.getBlock(x, y, z);
    if (!state.world || y < -64 || y > 319) return null;
    var cx = floorDiv(x, 16), cz = floorDiv(z, 16), sy = floorDiv(y, 16), key = cx + "," + cz + "," + sy, sub = state.decoded[key];
    if (sub === undefined) { var rec = state.records[key]; sub = state.decoded[key] = rec ? window.RC_builderCore.decodeSubchunk(rec.value) : null; }
    if (!sub) return null;
    var idx = window.RC_builderCore.storageIndex(mod(x, 16), mod(y, 16), mod(z, 16)), p = sub.primary.palette[sub.primary.idx[idx]];
    return p || null;
  }
  function offset() { return { x: Number($("x").value) || 0, y: Number($("y").value) || 0, z: Number($("z").value) || 0 }; }
  /* Monta a mesh de UMA chunk (respeita borracha e pincel no terreno). */
  function meshChunk(manager, id, chunk) {
    var group = new window.THREE.Group();
    var blocks = manager.renderChunk(chunk).filter(function (b) { return !state.dig[b.x + ',' + b.y + ',' + b.z]; });
    addInstances(group, blocks.map(function (b) {
      var key = b.x + ',' + b.y + ',' + b.z, pn = state.paint[key];
      if (pn) return { x: b.x, y: b.y, z: b.z, block: { name: pn, states: {}, transparent: b.transparent } };
      return { x: b.x, y: b.y, z: b.z, block: b };
    }), false);
    group.userData.visible = blocks.length; manager.chunkMeshes.set(id, group); state.terrain.add(group); invalidate();
  }
  /* Re-monta só as meshes (sem recodificar): borracha/vegetação na hora. */
  function refreshTerrainMeshes() {
    if (!window.THREE || !state.scene || !state.terrain || !state.chunkPreview) return;
    var manager = state.chunkPreview;
    manager.chunkMeshes.forEach(function (group) { clear(group); });
    manager.chunkMeshes.clear();
    manager.loadedChunks.forEach(function (chunk, id) { meshChunk(manager, id, chunk); });
    var visible = 0;
    manager.chunkMeshes.forEach(function (group) { visible += group.userData.visible; });
    if (state.terrain.userData) state.terrain.userData.visible = visible;
    scheduleValidation(); invalidate();
  }
  function rebuildTerrain() {
    if (!window.THREE || !state.scene) {
      if (!window.THREE) $('terrainStats').textContent = 'Preview 3D indisponível (Three.js não carregou)';
      return Promise.resolve(false);
    }
    if (!state.world || !state.chunkPreview) return Promise.resolve(false);
    var manager = state.chunkPreview, o = offset(), center = Math.floor(o.x / 16) + ':' + Math.floor(o.z / 16);
    if (state.terrainKey === center) return state.terrainPromise || Promise.resolve(true);
    state.terrainKey = center;
    if (!state.terrain) { state.terrain = new window.THREE.Group(); state.terrain.name = 'terrain'; state.scene.add(state.terrain); }
    $('terrainStats').textContent = 'Carregando terreno próximo…';
    state.terrainPromise = manager.updateNeighborhood(o, {
      remove: function (id) { clear(manager.chunkMeshes.get(id)); manager.chunkMeshes.delete(id); },
      add: function (id, chunk) { meshChunk(manager, id, chunk); },
      progress: function (done, total) { $('terrainStats').textContent = 'Carregando região: ' + done + '/' + total; }
    }).then(function (current) {
      if (!current || state.chunkPreview !== manager) return false;
      var visible = 0, decoded = 0, bottom = Infinity, top = -Infinity, failures = 0;
      manager.chunkMeshes.forEach(function (group) { visible += group.userData.visible; });
      manager.loadedChunks.forEach(function (chunk) { decoded += chunk.blocks.length; bottom = Math.min(bottom, chunk.minY); top = Math.max(top, chunk.maxY); failures += chunk.errors.length; });
      state.terrain.userData = { decoded:decoded, visible:visible, bottom:bottom, top:top, chunks:manager.loadedChunks.size };
      if (manager.loadedChunks.size) updateSkyDecor(o.x, o.z, bottom);
      var side = state.chunkPreview.renderDistance*2+1;
      $('terrainStats').textContent = manager.loadedChunks.size + '/' + (side*side) + ' chunks · ' + visible.toLocaleString('pt-BR') + ' blocos visíveis' + (manager.workerFailed ? ' · modo sem-Worker (mais lento; abra pelo AbrirSite.bat)' : '') + (Object.keys(state.missingTextures).length ? ' · ' + Object.keys(state.missingTextures).length + ' textura(s) ausente(s) em magenta' : '');
      if (failures) hint(failures + ' subchunks não puderam ser lidas. A região está incompleta.');
      else if (!visible) hint('Não há terreno salvo neste ponto. Escolha uma região visitada no mapa.');
      scheduleValidation(); invalidate(); return true;
    }).catch(function (error) {
      if (state.chunkPreview !== manager) return false;
      state.terrainKey = null; $('terrainStats').textContent = 'Falha ao carregar terreno'; hint(error.message); return false;
    });
    return state.terrainPromise;
  }
  function rebuildStructure() {
    if (!state.structure) return;
    if (!window.THREE || !state.scene) {
      var pp = placement();
      $('positionReadout').textContent = 'X ' + pp.x + ' · Y ' + pp.y + ' · Z ' + pp.z + ' · ' + pp.rotation + '°'; updatePlacementSummary();
      return;
    }
    if (state.meshStructure !== state.structure || state.meshErased !== Object.keys(state.erased).length) {
      clear(state.placed); state.placed = new window.THREE.Group(); state.placed.name = 'structure';
      state.solidBlocks = state.structure.blocks.filter(function (b) { return !isAir(b.block.name) && !state.erased[b.x + ',' + b.y + ',' + b.z]; });
      addInstances(state.placed, state.solidBlocks, true); state.scene.add(state.placed); state.meshStructure = state.structure; state.meshErased = Object.keys(state.erased).length;
    }
    var p = placement(), transform = window.RC_Placement.groupTransform(state.structure.size, p);
    state.placed.position.set(transform.x, transform.y, transform.z); state.placed.rotation.y = transform.angle;
    state.placed.visible = $('showStructure').checked;
    var size = window.RC_builderTransform.size(state.structure.size, p.rotation);
    state.selectionBox.min.set(p.x,p.y,p.z); state.selectionBox.max.set(p.x+size[0],p.y+size[1],p.z+size[2]);
    state.outline.visible = $('showOutline').checked;
    if (state.tool === 'gizmo') gizmoAttach();
    $('positionReadout').textContent = 'X ' + p.x + ' · Y ' + p.y + ' · Z ' + p.z + ' · ' + p.rotation + '°'; updatePlacementSummary();
    scheduleValidation(); invalidate();
  }
  function scheduleValidation() {
    clearTimeout(state.validationTimer);
    if (!state.structure || !state.solidBlocks) return;
    state.validationTimer = setTimeout(function () {
      var p = placement(), T = window.RC_builderTransform, collisions = 0, unknown = 0;
      state.solidBlocks.forEach(function (b) {
        var pos = T.world(b,state.structure.size,p,p.rotation), id = '0:' + Math.floor(pos.x/16) + ':' + Math.floor(pos.z/16);
        var chunk = state.chunkPreview && state.chunkPreview.loadedChunks.get(id);
        /* Chunk presente = blocos lidos valem, mesmo com alguma subchunk com
           erro. Só é "desconhecido" o que está em chunk nem carregada. */
        if (!chunk) { unknown++; return; }
        if (worldBlock(pos.x,pos.y,pos.z)) collisions++;
      });
      state.unknownBlocks = unknown; paintValidation(collisions,state.solidBlocks.length);
    }, 180);
  }
  function applyPosition(value, record) {
    var p;
    try { p = window.RC_Placement.normalize(value); } catch (error) { hint(error.message); return false; }
    ['x','y','z','rotation'].forEach(function (axis) { $(axis).value = p[axis]; });
    if (record !== false) state.history.push(p);
    updateHistory(); rebuildStructure(); drawWorldMap(); if (state.placementMode === '3d') rebuildTerrain(); updatePlacementSummary(); return true;
  }
  async function snapGround() {
    if (!state.chunkPreview) return;
    var requested = placement(), manager = state.chunkPreview;
    var size = state.structure ? window.RC_builderTransform.size(state.structure.size, requested.rotation) : [1,1,1];
    var ids = window.RC_builderPosition.footprintChunks(requested.x, requested.z, size[0], size[2]);
    for (var id of ids) {
      if (!manager.records.has(id)) { hint('A base alcança uma região não visitada. Escolha um ponto com terreno salvo.'); return; }
      if (!manager.loadedChunks.has(id)) {
        try { var chunk = await manager.decodeAsync(id); if (chunk) manager.loadedChunks.set(id, chunk); }
        catch (error) { hint('Não foi possível ler o terreno neste ponto. Confira a região e tente novamente.'); return; }
      }
    }
    if (manager !== state.chunkPreview || JSON.stringify(requested) !== JSON.stringify(placement())) return;
    /* Usa as colunas COM dado e ignora as sem dado: uma coluna vazia não pode
       vetar a base inteira. Só desiste se NENHUMA coluna tiver chão. */
    var highest = -Infinity, known = 0, total = 0;
    for (var x=requested.x; x<requested.x+size[0]; x++) for (var z=requested.z; z<requested.z+size[2]; z++) {
      total++;
      var y = manager.surfaceY(x,z);
      if (y === null) continue;
      known++; highest = Math.max(highest,y);
    }
    if (!known) { hint('Não achei chão carregado sob a base. Clique numa chunk colorida do mapa e tente de novo.'); return; }
    requested.y = highest; applyPosition(requested);
    hint('Base apoiada em Y ' + highest + (known < total ? ' (' + (total - known) + ' coluna(s) sem dado: confira o contorno).' : '. Confira o contorno e os encontros com o terreno.'));
  }
  /* Regra única do builder-core: manter sincronizado. */
  function isTreePreview(name) {
    if (window.RC_builderCore && window.RC_builderCore.isVegetation) return window.RC_builderCore.isVegetation(name);
    return /(_log$|_leaves$)/.test(String(name || ""));
  }
  function countVegetation() {
    if (!state.chunkPreview || !state.structure) return 0;
    var p = placement(), s = window.RC_builderTransform.size(state.structure.size, p.rotation), n = 0, x, y, z;
    for (x = p.x; x < p.x + s[0]; x++) for (z = p.z; z < p.z + s[2]; z++) for (y = p.y; y <= p.y + s[1] + 12; y++) {
      var b = worldBlock(x, y, z);
      if (b && isTreePreview(b.name)) n++;
    }
    return n;
  }
  function entityTypes() {
    var out = {}; Object.keys(state.structure.blockEntityData || {}).forEach(function (k) { var id = state.structure.blockEntityData[k].id; out[id] = (out[id] || 0) + 1; }); return out;
  }
  function updateMaterialList(structure) {
    var panel = $('materialsPanel'), body = $('materialsRows'), summary = $('materialsSummary');
    if (!panel || !body || !summary) return;
    var counts = Object.create(null);
    (structure && structure.blocks || []).forEach(function (block) {
      if (!block || isAir(block.name)) return;
      var name = String(block.name || 'unknown:block'); counts[name] = (counts[name] || 0) + 1;
    });
    materialRows = Object.keys(counts).map(function (name) {
      var count = counts[name], stacks = Math.ceil(count / 64);
      return { block: name, count: count, stacks64: stacks, shulkers: Math.ceil(stacks / 27) };
    }).sort(function (a, b) { return b.count - a.count || a.block.localeCompare(b.block); });
    var total = materialRows.reduce(function (sum, row) { return sum + row.count; }, 0);
    summary.textContent = total.toLocaleString('pt-BR') + ' blocos sólidos · ' + materialRows.length.toLocaleString('pt-BR') + ' tipos. Pilhas e shulkers são estimativas com limite de 64 itens por pilha.';
    body.textContent = '';
    materialRows.slice(0, 30).forEach(function (row) {
      var tr = document.createElement('tr');
      [row.block, row.count.toLocaleString('pt-BR'), row.stacks64.toLocaleString('pt-BR'), row.shulkers.toLocaleString('pt-BR')].forEach(function (value) {
        var td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    panel.hidden = !materialRows.length;
  }
  function paintValidation(collisions, blocks) {
    var issues = state.structure.issues || [], html = '<p class="issue-ok"><b>' + blocks.toLocaleString("pt-BR") + '</b> blocos sólidos no preview.</p>';
    var terrain = state.terrain && state.terrain.userData;
    if (terrain && terrain.decoded) html += '<p class="issue-ok"><b>' + terrain.visible.toLocaleString("pt-BR") + '</b> blocos visíveis do mundo (' + terrain.decoded.toLocaleString("pt-BR") + ' lidos entre Y ' + terrain.bottom + ' e ' + terrain.top + ').</p>';
    else if (state.world) html += '<p class="issue-warn"><b>Terreno vazio nessa região:</b> escolha outra “Região visitada” ou informe coordenadas de uma área que você já abriu no Minecraft.</p>';
    html += '<p class="issue-warn"><b>' + collisions.toLocaleString("pt-BR") + '</b> blocos existentes serão atravessados/substituídos no ponto atual.</p>';
    if (state.unknownBlocks) html += '<p class="issue-warn">' + state.unknownBlocks.toLocaleString('pt-BR') + ' posições fora do terreno disponível: verificação incompleta.</p>';
    if ($('clearTrees') && $('clearTrees').checked) {
      var veg = countVegetation();
      html += veg ? '<p class="issue-ok"><b>' + veg.toLocaleString('pt-BR') + '</b> blocos de vegetação (árvores etc.) na área serão removidos ao exportar.</p>'
        : '<p class="issue-ok">Nenhuma vegetação na área para remover.</p>';
    }
    var paintedCount = Object.keys(state.paint).length;
    if (paintedCount) html += '<p class="issue-ok"><b>' + paintedCount.toLocaleString('pt-BR') + '</b> bloco(s) pintados com o pincel vão para o mundo no exportar.</p>';
    var p = placement(), size = window.RC_builderTransform.size(state.structure.size,p.rotation);
    if (p.y < -64 || p.y+size[1] > 320) html += '<p class="issue-warn">A estrutura ultrapassa os limites de altura do Overworld (-64 a 319).</p>';
    issues.forEach(function (issue) { html += '<p class="issue-warn"><b>' + esc(issue.count) + '</b> — ' + esc(issue.message) + '</p>'; });
    html += '<p class="issue-ok"><b>Exportar mundo (.mcworld)</b> grava o preview exatamente como está (posição, rotação e borracha). Block entities e entidades ainda não são gravadas.</p>';
    if (state.mobs.length) html += '<p class="issue-warn"><b>' + state.mobs.length + '</b> mob(s) no preview estilo replay (só visual: não vão para o mundo).</p>';
    $("validation").innerHTML = html;
    var types = entityTypes(), ids = Object.keys(types).sort(); $("entityTypes").innerHTML = ids.length ? ids.map(function (id) { return '<li>' + esc(id) + ': <b>' + types[id] + '</b></li>'; }).join("") : '<li>Nenhuma block entity</li>';
  }
  function renderAll(terrain) { if (state.placementMode === '3d') { init3d(); if (terrain && state.renderer) rebuildTerrain(); } rebuildStructure(); }
  function loadWorldUnchecked(file) {
    var generation = ++state.worldGeneration;
    if (state.chunkPreview) state.chunkPreview.dispose();
    clear(state.terrain); state.terrain = null; state.world = null; state.chunkPreview = null; state.terrainKey = null;
    state.terrainPromise = null; state.history = new window.RC_Placement.History(); updateHistory();
    $('structureFile').disabled = true;
    $("status").textContent = "Abrindo mundo Bedrock…"; state.worldFile = file;
    window.RC_dbx.openWorld(file).then(function (world) {
      if (generation !== state.worldGeneration) return;
      state.world = world; state.records = {}; state.decoded = {}; state.erased = {}; state.dig = {}; state.paint = {}; state.mobs = [];
      /* Celular fraco: 3×3 chunks carrega ~3x mais rápido; PC: 5×5. */
      var lightMode = (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) || Math.min(window.innerWidth || 999, window.innerHeight || 999) < 500;
      state.chunkPreview = new window.RC_ChunkPreviewManager(world, { renderDistance: lightMode ? 1 : 2, mode: "SURFACE" });
    var rangeSel = $('terrainRange');
      if (rangeSel) rangeSel.value = String(state.chunkPreview.renderDistance);
      state.playerPos = readPlayerPos(world);
      findRegions();
      return readWorldSpawn(world).then(function (spawn) {
        if (generation !== state.worldGeneration) return;
        state.spawn = spawn;
        $('result').hidden = false; if (state.placementMode === '3d') { init3d(); updatePlayerPin(); rebuildMobs(); }
        var first = state.regions[0];
        /* Começa onde o jogador estava (é área visitada por definição);
           senão spawn, senão primeira região. */
        var start = state.playerPos || spawn || (first ? {x:first.cx*16+8,y:64,z:first.cz*16+8} : {x:0,y:64,z:0});
        start.rotation = 0;
        try { applyPosition(start); focus(); }
        catch (previewError) { hint('Mundo aberto, mas o preview falhou: ' + (previewError.message || previewError)); drawWorldMap(); }
        $("structureFile").disabled = false;
        $("status").textContent = state.playerPos ? "Mundo carregado. Começando onde o player estava; agora envie a estrutura." : spawn ? "Mundo carregado. O preview começa no spawn do mundo; agora envie a estrutura." : "Mundo carregado. Escolhi uma área visitada automaticamente; agora envie a estrutura.";
        if (tourIndex >= 0 && tourIndex <= 1 && !tourWasSkipped) tourShow(2);
      });
    }).catch(function (e) { if (generation !== state.worldGeneration) return; state.world = null; $("status").textContent = "Não consegui abrir o mundo: " + (e.message || "arquivo inválido"); });
  }
  function clearWorldForEntitlementCheck() {
    if (state.chunkPreview) state.chunkPreview.dispose();
    clear(state.terrain); state.terrain = null; state.world = null; state.chunkPreview = null; state.terrainKey = null;
    state.terrainPromise = null; state.worldFile = null; state.history = new window.RC_Placement.History(); updateHistory();
    $("result").hidden = true;
    $("structureFile").disabled = true;
  }
  function loadWorld(file) {
    if (!file || !window.RC_entitlements) { $("status").textContent = "Nao foi possivel verificar seu plano agora. Tente novamente."; return; }
    var requestGeneration = ++state.worldGeneration;
    clearWorldForEntitlementCheck();
    var decision = $("planDecision");
    if (decision) decision.textContent = "Verificando seu plano e o limite deste arquivo...";
    $("status").textContent = "Verificando seu plano...";
    window.RC_entitlements.load().then(function (entitlement) {
      if (requestGeneration !== state.worldGeneration) return null;
      if (entitlement.status !== "ready" && entitlement.status !== "unauthenticated") throw new Error("ENTITLEMENT_UNAVAILABLE");
      var fileAccess = window.RC_entitlements.canUseFile([file]);
      if (!fileAccess.allowed) {
        var sizeMb = (file.size / 1048576).toFixed(1);
        var limitMb = fileAccess.max_file_mb;
        if (entitlement.pending_payment) {
          $("status").textContent = window.RC_entitlements.messageForPending(entitlement.pending_payment);
        } else if (entitlement.active) {
          $("status").textContent = "Seu mundo tem " + sizeMb + " MB. Seu plano " + (entitlement.plan_label || entitlement.plan) + " permite ate " + limitMb + " MB.";
        } else {
          $("status").textContent = "Seu mundo tem " + sizeMb + " MB. O plano gratuito permite ate " + limitMb + " MB. Consulte os planos no conversor.";
        }
        if (decision) decision.textContent = "Arquivo nao permitido pelo limite atual do plano.";
        return null;
      }
      var allowedLimit = fileAccess.max_file_mb === null ? "sem limite comercial" : fileAccess.max_file_mb + " MB";
      if (decision) decision.textContent = "Mundo detectado: " + (file.size / 1048576).toFixed(1) + " MB · Plano: " + (entitlement.plan_label || entitlement.plan) + " · Limite: " + allowedLimit + " · Arquivo permitido.";
      return loadWorldUnchecked(file);
    }).catch(function (error) {
      if (requestGeneration !== state.worldGeneration) return;
      clearWorldForEntitlementCheck();
      if (decision) decision.textContent = "";
      $("status").textContent = window.RC_entitlements.messageForError(error);
    });
  }
  function readPlayerPos(world) {
    /* Onde o jogador estava quando salvou: registro ~local_player, tag Pos. */
    try {
      var found = null;
      world.db.keys.forEach(function (kv, sk) {
        if (found || !kv || kv === false) return;
        if (sk === '~local_player') found = kv;
      });
      if (!found) return null;
      var root = window.RC_nbt2.parse(found.value).root;
      var pos = root && root.v && root.v.map && root.v.map.Pos;
      var items = pos && pos.v && pos.v.items;
      if (!items || items.length !== 3) return null;
      var x = Number(items[0].v), y = Number(items[1].v), z = Number(items[2].v);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return null;
      return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
    } catch (e) { return null; }
  }
  function buildPlayerPin() {
    /* Boneco + feixe de luz onde o player estava: impossível perder. */
    var THREE = window.THREE;
    var pin = new THREE.Group();
    var beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 20; pin.add(beam);
    var body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.85, 10), new THREE.MeshBasicMaterial({ color: 0x2f9dff }));
    body.position.y = 1.15; pin.add(body);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: 0xf2c89b }));
    head.position.y = 1.95; pin.add(head);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 8, 24), new THREE.MeshBasicMaterial({ color: 0x4aa8ff }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.08; pin.add(ring);
    pin.traverse(function (m) { m.frustumCulled = false; });
    return pin;
  }
  function updatePlayerPin() {
    if (!window.THREE || !state.scene) return;
    if (state.playerPin) { state.scene.remove(state.playerPin); state.playerPin = null; }
    if (!state.playerPos) return;
    var w = window.RC_builderTransform.worldToThree(state.playerPos.x, state.playerPos.y, state.playerPos.z);
    state.playerPin = buildPlayerPin();
    state.playerPin.position.set(w.x + 0.5, w.y, w.z + 0.5);
    state.scene.add(state.playerPin);
    invalidate();
  }
  function readWorldSpawn(world) {
    var rel = null;
    try { world.zip.forEach(function (name) { if (!rel && /level\.dat$/i.test(name)) rel = name; }); } catch (e) {}
    if (!rel || !world.zip.file(rel)) return Promise.resolve(null);
      return world.zip.file(rel).async("uint8array").then(function (bytes) {
      var roots = [8, 0], i;
      for (i = 0; i < roots.length; i++) try {
        var root = window.RC_nbt2.parseAt(bytes, roots[i]).root, map = root && root.v && root.v.map;
        if (map && map.SpawnX && map.SpawnY && map.SpawnZ) {
          var sx = Number(map.SpawnX.v), sy = Number(map.SpawnY.v), sz = Number(map.SpawnZ.v);
          /* level.dat com spawn nunca definido traz Y=32767 (sentinela):
             fora do Overworld (-64..319), então cai para 64 e o snap ajusta. */
          if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz)) return null;
          if (sy < -64 || sy > 320) sy = 64;
          var seed = null, time = null;
          try { if (map.RandomSeed) seed = String(map.RandomSeed.v); } catch (e3) {}
          try { if (map.Time) time = Number(map.Time.v); } catch (e4) {}
          return { x: sx, y: sy, z: sz, seed: seed, time: time };
        }
      } catch (e2) {}
      return null;
    }).catch(function () { return null; });
  }
  function findRegions() {
    state.mapRegions = Array.from(state.chunkPreview.records.values()).map(function (c) { return {cx:c.chunkX,cz:c.chunkZ}; });
    state.mapRegions.sort(function (a,b) { return Math.abs(a.cx)+Math.abs(a.cz)-Math.abs(b.cx)-Math.abs(b.cz); });
    state.regions = state.mapRegions.slice(0, 250);
    $("region").innerHTML = state.regions.length ? state.regions.map(function (r, index) { return '<option value="' + index + '">Chunk ' + r.cx + ', ' + r.cz + '</option>'; }).join("") : '<option value="">Nenhuma chunk encontrada</option>';
    drawWorldMap();
  }
  function drawWorldMap() {
    var canvas = $("worldMap"), ctx = canvas.getContext("2d"), all = state.mapRegions, width = canvas.width, height = canvas.height;
    ctx.fillStyle = "#080e18"; ctx.fillRect(0, 0, width, height);
    if (!all.length) { ctx.fillStyle = "#ffcf75"; ctx.font = "14px system-ui"; ctx.fillText("Nenhuma subchunk compatível foi encontrada no mundo.", 18, 30); return; }
    var minX = all[0].cx, maxX = minX, minZ = all[0].cz, maxZ = minZ;
    all.forEach(function (r) { minX = Math.min(minX, r.cx); maxX = Math.max(maxX, r.cx); minZ = Math.min(minZ, r.cz); maxZ = Math.max(maxZ, r.cz); });
    /* Zoom centrado na chunk selecionada, como o mapa do site principal. */
    var zf = state.mapZoom || 1;
    if (zf > 1) {
      var zccx = floorDiv(Number($("x").value) || 0, 16), zccz = floorDiv(Number($("z").value) || 0, 16);
      var zwx = Math.max(2, Math.ceil((maxX - minX + 1) / zf)), zwz = Math.max(2, Math.ceil((maxZ - minZ + 1) / zf));
      minX = Math.max(minX, Math.min(zccx - (zwx >> 1), maxX - zwx + 1));
      minZ = Math.max(minZ, Math.min(zccz - (zwz >> 1), maxZ - zwz + 1));
      maxX = minX + zwx - 1; maxZ = minZ + zwz - 1;
    }
    var pad = 14, scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX + 1), (height - pad * 2) / Math.max(1, maxZ - minZ + 1));
    state.mapView = { minX: minX, minZ: minZ, scale: scale, pad: pad };
    all.forEach(function (r) {
      /* Verde padrão do mapa do site principal. */
      ctx.fillStyle = "#5EBB2B"; ctx.fillRect(pad + (r.cx - minX) * scale, pad + (r.cz - minZ) * scale, Math.max(1, Math.ceil(scale)), Math.max(1, Math.ceil(scale)));
    });
    var cx = floorDiv(Number($("x").value) || 0, 16), cz = floorDiv(Number($("z").value) || 0, 16), sx = pad + (cx - minX) * scale, sz = pad + (cz - minZ) * scale;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, 2 / Math.max(scale, 1)); ctx.strokeRect(sx, sz, Math.max(2, scale), Math.max(2, scale));
    ctx.strokeStyle = '#65d7ff'; ctx.lineWidth = 1; ctx.strokeRect(sx-2*scale,sz-2*scale,5*scale,5*scale);
    if (state.spawn && isFinite(state.spawn.x) && isFinite(state.spawn.z)) {
      var spx = pad + (Math.floor(state.spawn.x/16) - minX) * scale, spz = pad + (Math.floor(state.spawn.z/16) - minZ) * scale, dot = Math.max(4, Math.min(10, scale));
      ctx.fillStyle = '#51ff9e'; ctx.fillRect(spx + scale/2 - dot/2, spz + scale/2 - dot/2, dot, dot);
    }
    if (state.playerPos && isFinite(state.playerPos.x) && isFinite(state.playerPos.z)) {
      var ppx = pad + (Math.floor(state.playerPos.x/16) - minX) * scale, ppz = pad + (Math.floor(state.playerPos.z/16) - minZ) * scale, pdot = Math.max(4, Math.min(10, scale));
      ctx.fillStyle = '#4aa8ff'; ctx.fillRect(ppx + scale/2 - pdot/2, ppz + scale/2 - pdot/2, pdot, pdot);
    }
    if (state.structure) {
      var fp = placement(), fs = window.RC_builderTransform.size(state.structure.size, fp.rotation);
      var mapX = function (bx) { return pad + (bx / 16 - minX) * scale; }, mapZ = function (bz) { return pad + (bz / 16 - minZ) * scale; };
      ctx.strokeStyle = '#65d7ff'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.strokeRect(mapX(fp.x), mapZ(fp.z), (mapX(fp.x + fs[0]) - mapX(fp.x)) || 2, (mapZ(fp.z + fs[2]) - mapZ(fp.z)) || 2);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = "#dbeaff"; ctx.font = "12px system-ui"; ctx.fillText("Chunks visitadas: " + all.length + " · selecione com clique", 12, height - 8);
  }
  function pickWorldMap(event) {
    if (!state.mapView || !state.mapRegions.length) return;
    var canvas = $("worldMap"), rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) * canvas.width / rect.width, z = (event.clientY - rect.top) * canvas.height / rect.height, v = state.mapView;
    var point = window.RC_builderPosition.mapBlock(event.clientX, event.clientY, rect, canvas, v), cx = point.chunkX, cz = point.chunkZ, chosen = null, i;
    for (i = 0; i < state.mapRegions.length; i++) if (state.mapRegions[i].cx === cx && state.mapRegions[i].cz === cz) { chosen = state.mapRegions[i]; break; }
    if (!chosen) return;
    applyPosition({x:point.x,y:offset().y,z:point.z,rotation:placement().rotation});
    snapGround().then(focus);
  }
  function useRegion(index) {
    var r = state.regions[index == null ? Number($("region").value) : index];
    if (!r) return;
    applyPosition({x:r.cx*16+8,y:offset().y,z:r.cz*16+8,rotation:placement().rotation});
    snapGround().then(focus);
  }
  function autoLocateWorld() { useRegion(0); }
  function loadStructure(file) {
    var generation = ++state.structureGeneration;
    $("status").textContent = "Lendo a estrutura…"; state.structureFile = file;
    file.arrayBuffer().then(function (buffer) {
      if (generation !== state.structureGeneration) return;
      state.structure = window.RC_builderCore.parseStructure(new Uint8Array(buffer), { allowComplex: true });
      state.erased = {}; state.meshErased = -1; state.meshStructure = null;
      updateMaterialList(state.structure);
      $("dimensions").textContent = state.structure.size.join(" × "); $("blocks").textContent = state.structure.blocks.length.toLocaleString("pt-BR");
      $("blockEntities").textContent = Object.keys(state.structure.blockEntityData || {}).length.toLocaleString("pt-BR"); $("entities").textContent = (state.structure.sourceEntities || []).length.toLocaleString("pt-BR");
      state.history = new window.RC_Placement.History(); state.history.push(placement()); updateHistory();
      $("result").hidden = false; $("status").textContent = "Estrutura carregada. Use Colocar no terreno ou ajuste as coordenadas."; renderAll(true); drawWorldMap(); focus();
      /* Se a altura atual é impossível (ex.: spawn inválido herdado do level.dat),
         cola a estrutura no chão sozinha em vez de deixá-la perdida no céu. */
      if (Number($("y").value) < -64 || Number($("y").value) > 319) snapGround().then(focus);
      if (tourIndex === 2 && !tourWasSkipped) tourShow(3);
    }).catch(function (e) { if (generation !== state.structureGeneration) return; state.structure = null; materialRows = []; updateMaterialList(null); clear(state.placed); state.placed = null; if (state.outline) state.outline.visible = false; $("status").textContent = "Não consegui validar: " + (e.message || "arquivo inválido"); });
  }
  /* Mobs estilo replay: só visual no preview, não vão para o mundo. */
  var MOB_TYPES = { cow: 0x8a6f4d, pig: 0xf2a7c3, sheep: 0xe8e8e8, chicken: 0xffffff, villager: 0x7a5b3f, horse: 0x8a5a2b, wolf: 0xb0b0b0, zombie: 0x3f7a4d, skeleton: 0xd8d8d8, creeper: 0x4dff4d, spider: 0x3a3a3a, enderman: 0x141414 };
  var MOB_KIND = { cow: 'quad', pig: 'quad', sheep: 'quad', horse: 'quad', wolf: 'quad', spider: 'quad', chicken: 'bird', creeper: 'creeper', enderman: 'tall', zombie: 'biped', skeleton: 'biped', villager: 'biped' };
  var mobMats = {};
  function mobMat(color) {
    if (!mobMats[color]) mobMats[color] = new window.THREE.MeshBasicMaterial({ color: color });
    return mobMats[color];
  }
  function mobBox(w, h, d, color, x, y, z) {
    var m = new window.THREE.Mesh(new window.THREE.BoxGeometry(w, h, d), mobMat(color));
    m.position.set(x, y, z);
    return m;
  }
  /* Modelos blocados como no Minecraft: corpo + cabeça + pernas por tipo. */
  function buildMobModel(type) {
    var color = MOB_TYPES[type] || 0xff00ff, kind = MOB_KIND[type] || 'quad', g = new window.THREE.Group();
    var skin = type === 'skeleton' ? 0xd8d8d8 : 0xf2c89b, dark = type === 'sheep' ? 0x9a8f7a : color;
    if (kind === 'quad') {
      var legH = type === 'spider' ? 0.35 : 0.6;
      g.add(mobBox(0.7, 0.6, 1.15, color, 0, legH + 0.3, 0));
      g.add(mobBox(0.5, 0.5, 0.5, dark, 0, legH + 0.45, 0.8));
      [[-0.22, 0.4], [0.22, 0.4], [-0.22, -0.4], [0.22, -0.4]].forEach(function (lx) {
        g.add(mobBox(0.22, legH, 0.22, dark, lx[0], legH / 2, lx[1]));
      });
      if (type === 'pig') g.add(mobBox(0.28, 0.2, 0.1, 0xe08bb0, 0, legH + 0.4, 1.06));
      if (type === 'cow') { g.add(mobBox(0.14, 0.14, 0.3, 0xd8d0c0, -0.3, legH + 0.75, 0.75)); g.add(mobBox(0.14, 0.14, 0.3, 0xd8d0c0, 0.3, legH + 0.75, 0.75)); }
      if (type === 'spider') { g.add(mobBox(0.12, 0.12, 0.12, 0xff2222, -0.12, legH + 0.55, 1.0)); g.add(mobBox(0.12, 0.12, 0.12, 0xff2222, 0.12, legH + 0.55, 1.0)); }
    } else if (kind === 'bird') {
      g.add(mobBox(0.45, 0.4, 0.55, 0xffffff, 0, 0.45, 0));
      g.add(mobBox(0.35, 0.35, 0.35, 0xffffff, 0, 0.8, 0.2));
      g.add(mobBox(0.14, 0.1, 0.18, 0xff9d2e, 0, 0.75, 0.45));
      g.add(mobBox(0.08, 0.25, 0.08, 0xff9d2e, -0.1, 0.12, 0));
      g.add(mobBox(0.08, 0.25, 0.08, 0xff9d2e, 0.1, 0.12, 0));
    } else if (kind === 'creeper') {
      g.add(mobBox(0.55, 1.05, 0.55, color, 0, 0.85, 0));
      g.add(mobBox(0.5, 0.5, 0.5, color, 0, 1.6, 0));
      [[-0.15, 0.15], [0.15, 0.15], [-0.15, -0.15], [0.15, -0.15]].forEach(function (lx) {
        g.add(mobBox(0.2, 0.35, 0.2, color, lx[0], 0.17, lx[1]));
      });
    } else {
      var tall = type === 'enderman', s = tall ? 1.45 : 1;
      var bc = tall ? 0x141414 : color;
      g.add(mobBox(0.55 * s, 0.7 * s, 0.35 * s, bc, 0, 0.65 * s + 0.35 * s, 0));
      g.add(mobBox(0.5 * s, 0.5 * s, 0.5 * s, tall ? 0x141414 : skin, 0, 1.35 * s + 0.35 * s, 0));
      g.add(mobBox(0.18 * s, 0.65 * s, 0.18 * s, tall ? 0x141414 : bc, -0.37 * s, 0.65 * s + 0.3 * s, 0));
      g.add(mobBox(0.18 * s, 0.65 * s, 0.18 * s, tall ? 0x141414 : bc, 0.37 * s, 0.65 * s + 0.3 * s, 0));
      g.add(mobBox(0.2 * s, 0.65 * s, 0.2 * s, tall ? 0x141414 : bc, -0.15 * s, 0.32 * s, 0));
      g.add(mobBox(0.2 * s, 0.65 * s, 0.2 * s, tall ? 0x141414 : bc, 0.15 * s, 0.32 * s, 0));
      if (tall) { g.add(mobBox(0.1, 0.06, 0.02, 0xc26bff, -0.12, 1.95, 0.36)); g.add(mobBox(0.1, 0.06, 0.02, 0xc26bff, 0.12, 1.95, 0.36)); }
    }
    return g;
  }
  function mobLabel(type) { var el = $('mobType'); if (el) for (var i = 0; i < el.options.length; i++) if (el.options[i].value === type) return el.options[i].text; return type; }
  function rebuildMobs() {
    if (!window.THREE || !state.scene) return;
    if (state.mobGroup) { state.scene.remove(state.mobGroup); state.mobGroup = null; }
    if (!state.mobs.length) { invalidate(); return; }
    var THREE = window.THREE;
    state.mobGroup = new THREE.Group();
    state.mobs.forEach(function (mob) {
      var g = buildMobModel(MOB_TYPES[mob.type] === undefined ? 'cow' : mob.type);
      var w = window.RC_builderTransform.worldToThree(mob.x, mob.y, mob.z);
      g.position.set(w.x + 0.5, w.y, w.z + 0.5);
      g.traverse(function (m) { m.frustumCulled = false; });
      state.mobGroup.add(g);
    });
    state.scene.add(state.mobGroup);
    invalidate();
  }
  /* Presets de céu: o "shader" do pobre — clima sem Render Dragon. */
  function applySky(mode) {
    if (!window.THREE || !state.scene) return;
    var skies = {
      day: { sky: 0x87ceeb, hs: 0xe8f6ff, hg: 0x5d7a52, hi: 2.5, sun: 0xfff6e0, si: 2, far: 0x6fa055, cloud: 0.82 },
      sunset: { sky: 0xff9a5c, hs: 0xffd9b0, hg: 0x4d3f55, hi: 2, sun: 0xff7733, si: 2.2, far: 0x8a6f4d, cloud: 0.85 },
      night: { sky: 0x0b1026, hs: 0x33415e, hg: 0x0c1410, hi: 1.1, sun: 0x9db8ff, si: 0.7, far: 0x1d2b22, cloud: 0.25 }
    };
    var s = skies[mode] || skies.day;
    state.scene.background.set(s.sky); state.scene.fog.color.set(s.sky);
    if (state.hemi) { state.hemi.color.set(s.hs); state.hemi.groundColor.set(s.hg); state.hemi.intensity = s.hi; }
    if (state.sun) { state.sun.color.set(s.sun); state.sun.intensity = s.si; }
    if (state.farGround) state.farGround.material.color.set(s.far);
    if (state.cloudMat) state.cloudMat.opacity = s.cloud;
    invalidate();
  }
  /* Guia interativo do Null. A chave nova faz o tour corrigido aparecer para
     quem já visitou a primeira versão, que só começava depois do upload. */
  var TOUR_KEY = 'rc_builder_guide_v3_done';
  var tourIndex = -1, tourWasSkipped = false, tourOriginFocus = null, tourUpdateTimer = 0;
  var TOUR_STEPS = [
    { sel: '.lab-hero', title: 'Oi, eu sou o Null!', text: 'Vou te mostrar o construtor por partes. O mundo original fica no seu aparelho; aqui você posiciona uma casa, confere o terreno e salva uma cópia editada.' },
    { sel: '.nav', title: 'As ferramentas do site', text: 'No Início você encontra o conversor e os ajustes do mundo. Restaurar chunks serve para reparar uma área. Este Construtor 3D serve para posicionar estruturas no terreno.' },
    { sel: '#worldFile', title: '1 · Abra seu mundo', text: 'Escolha um arquivo .mcworld. O guia continua assim que o mundo terminar de carregar. No PC, clique no campo; no celular, toque nele e escolha o arquivo.' },
    { sel: '#structureFile', title: '2 · Escolha a construção', text: 'Envie um arquivo .mcstructure. Ele só libera depois que o mundo abrir. Quando a leitura terminar, a casa aparece no preview.' },
    { sel: '#summaryOverview', title: 'Resumo da construção', text: 'Aqui aparecem tamanho, quantidade de blocos, block entities e entidades encontradas no arquivo.' },
    { sel: '#materialsPanel', title: 'Materiais da estrutura', text: 'Veja os blocos sólidos, pilhas estimadas e baixe a lista completa em CSV para planejar os materiais.' },
    { sel: '.world-map-card', title: 'Escolha uma área visitada', text: 'Cada quadrado representa uma chunk salva no mundo. Toque ou clique numa área verde para levar o preview até lá; no PC, passe o mouse para ver coordenadas. Use + zoom e − zoom para aproximar ou afastar o mapa.' },
    { sel: '#preview', title: 'Navegue pelo terreno 3D', text: 'Arraste com o mouse para girar e use a roda para aproximar. No celular, arraste com um dedo para girar e use pinça com dois dedos para zoom. O contorno azul mostra a área da casa.' },
    { sel: '#toolOrbit', title: 'Orbitar', text: 'Este modo deixa você girar e aproximar a câmera sem mover a construção. Esc também volta para Orbitar.' },
    { sel: '#toolPlace', title: 'Colar no terreno', text: 'Ative Colar e clique no mapa ou no terreno para colocar a base da estrutura. A altura acompanha o chão.' },
    { sel: '#toolMove', title: 'Arrastar', text: 'Ative Arrastar e puxe a estrutura pelo terreno. No PC, Shift + arrastar também move sem trocar o modo.' },
    { sel: '#toolErase', title: 'Borracha', text: 'Apague blocos da construção no preview. No terreno, ela abre um buraco que entra na exportação. “Restaurar blocos apagados” desfaz remoções e pinturas feitas nesta sessão.' },
    { sel: '#toolGizmo', title: 'Mover 3D', text: 'Use as setas do manipulador para mover a casa pelos eixos. Pressione G para alternar entre mover e girar; o encaixe é de um bloco e 90°.' },
    { sel: '#toolMob', title: 'Mobs de cenário', text: 'Este botão ativa a colocação de mobs no preview. O seletor e o botão para limpar ficam no grupo Mobs, que vou destacar logo adiante. Eles são apenas visuais e não são gravados no .mcworld.' },
    { sel: '#toolPaint', title: 'Pincel do terreno', text: 'Este botão ativa o pincel. O tipo de bloco e o tamanho ficam no grupo Pincel, que vou destacar logo adiante; as alterações feitas nele vão para a exportação.' },
    { sel: '#photoBtn', title: 'Salvar uma foto', text: 'Gera um PNG da câmera atual para você mostrar sua construção.' },
    { sel: '#placementControls', title: 'Coordenadas e rotação', text: 'Defina X, Y e Z ou use os botões para mover por eixo. Escolha o tamanho do passo, gire em 0°, 90°, 180° ou 270° e decida se o clique centraliza a base ou usa a origem. “Apoiar no terreno” ajusta a altura ao chão. As setas movem X/Z; Page Up/Down muda Y e R gira.' },
    { sel: '#historyControls', title: 'Desfazer e reiniciar', text: 'Desfaça ou refaça mudanças de posição. “Restaurar blocos apagados” desfaz o uso da borracha na estrutura; “Resetar posição” volta às coordenadas iniciais.' },
    { sel: '#mobControls', title: 'Escolha e limpe os mobs', text: 'Selecione vaca, porco, aldeão e outros modelos blocados. “Limpar mobs” remove todos do preview; nenhum deles entra no arquivo exportado.' },
    { sel: '#paintControls', title: 'Bloco e tamanho do pincel', text: 'Escolha grama, terra, pedra ou outro bloco e defina se o pincel muda um ponto ou uma área maior.' },
    { sel: '#displayControls', title: 'Ajuste o visual', text: 'Mostre ou esconda a estrutura e o contorno. “Remover árvores” aplica a limpeza na área ao exportar. Dia, pôr-do-sol e noite mudam a iluminação do preview.' },
    { sel: '#navigationControls', title: 'Ir direto a um local', text: 'Vá para uma região visitada, o spawn, a posição salva do jogador ou as coordenadas X/Z digitadas. A casa se reposiciona e tenta apoiar no terreno.' },
    { sel: '#terrainControls', title: 'Detalhe e enquadramento', text: 'O alcance 3×3, 5×5 ou 7×7 controla quantas chunks aparecem; use alcance menor se o celular ficar lento. “Atualizar terreno” recarrega o preview e “Centralizar estrutura” enquadra a câmera.' },
    { sel: '#exportControls', title: 'Escolha como os blocos se encaixam', text: '“Ignorar ar” preserva os blocos do mundo onde a estrutura tem ar; “Substituir tudo” grava também esses espaços; “Somente no ar” evita substituir blocos existentes. Confira a posição e então exporte a cópia .mcworld.' },
    { sel: '#diagnosticControls', title: 'Raio-X e conferência final', text: 'O Raio-X conta chunks, subchunks, blocos, alturas, jogadores e spawn. O relatório baixa esses dados em JSON. A validação mostra colisões e limites; block entities complexas ainda não são gravadas no mundo.' }
  ];
  function tourTarget(step) {
    if (!step) return null;
    try { return document.querySelector(step.sel); } catch (e) { return null; }
  }
  function tourMeasure() {
    if (tourIndex < 0) return;
    var overlay = $('tourOverlay'), target = tourTarget(TOUR_STEPS[tourIndex]);
    if (!overlay || overlay.hidden) return;
    var shades = overlay.querySelectorAll('.tour-shade');
    var rect = target && target.getClientRects().length ? target.getBoundingClientRect() : null;
    if (!rect) return;
    var pad = 10, left = Math.max(0, rect.left - pad), top = Math.max(0, rect.top - pad);
    var right = Math.min(window.innerWidth, rect.right + pad), bottom = Math.min(window.innerHeight, rect.bottom + pad);
    var boxes = {
      top: [0, 0, window.innerWidth, top],
      right: [right, top, Math.max(0, window.innerWidth - right), Math.max(0, bottom - top)],
      bottom: [0, bottom, window.innerWidth, Math.max(0, window.innerHeight - bottom)],
      left: [0, top, left, Math.max(0, bottom - top)]
    };
    Array.prototype.forEach.call(shades, function (shade) {
      var box = boxes[shade.getAttribute('data-side')];
      shade.style.left = box[0] + 'px'; shade.style.top = box[1] + 'px';
      shade.style.width = box[2] + 'px'; shade.style.height = box[3] + 'px';
    });
    var card = $('tourCard'), cardHeight = card.offsetHeight;
    var spaceAbove = Math.max(0, rect.top), spaceBelow = Math.max(0, window.innerHeight - rect.bottom);
    var fitsAbove = spaceAbove >= cardHeight + 18, fitsBelow = spaceBelow >= cardHeight + 18;
    var putAtTop = fitsAbove && !fitsBelow ? true : fitsBelow && !fitsAbove ? false :
      fitsAbove && fitsBelow ? rect.top + rect.height / 2 > window.innerHeight * 0.56 : spaceAbove > spaceBelow;
    card.classList.toggle('tour-card-at-top', putAtTop);
  }
  function tourShow(i) {
    var overlay = $('tourOverlay');
    if (!overlay || i < 0 || i >= TOUR_STEPS.length) { tourHide(); return; }
    if (tourIndex < 0 && document.activeElement && document.activeElement !== document.body) tourOriginFocus = document.activeElement;
    Array.prototype.forEach.call(document.querySelectorAll('.tour-glow'), function (el) { el.classList.remove('tour-glow'); });
    tourIndex = i;
    var step = TOUR_STEPS[i], target = tourTarget(step);
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    if (target) {
      try { target.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
      target.classList.add('tour-glow');
    }
    var mascot = $('tourMascot'), mascotFile = i === 0 ? 'assets/null-apresenta.png' : 'assets/null-guia.png';
    if (mascot && mascot.getAttribute('src') !== mascotFile) mascot.setAttribute('src', mascotFile);
    $('tourTitle').textContent = step.title;
    $('tourText').textContent = step.text;
    $('tourProgress').textContent = 'PASSO ' + (i + 1) + ' DE ' + TOUR_STEPS.length;
    $('tourHint').textContent = i === 1 && !state.world ? 'Selecione o mundo destacado. O guia avança sozinho quando terminar.' :
      i === 2 && !state.structure ? 'Selecione a construção destacada. O guia avança sozinho depois da leitura.' : '';
    var back = $('tourBack'), next = $('tourNext');
    back.disabled = i === 0;
    next.disabled = (i === 1 && !state.world) || (i === 2 && !state.structure);
    next.textContent = i === TOUR_STEPS.length - 1 ? 'Concluir' : i === 1 && !state.world ? 'Aguardando mundo…' : i === 2 && !state.structure ? 'Aguardando casa…' : 'Próximo →';
    clearTimeout(tourUpdateTimer);
    tourUpdateTimer = setTimeout(tourMeasure, 80);
  }
  function tourHide() {
    tourIndex = -1;
    tourWasSkipped = true;
    Array.prototype.forEach.call(document.querySelectorAll('.tour-glow'), function (el) { el.classList.remove('tour-glow'); });
    var overlay = $('tourOverlay');
    if (overlay) { overlay.hidden = true; overlay.setAttribute('aria-hidden', 'true'); }
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
    if (tourOriginFocus && tourOriginFocus.isConnected && typeof tourOriginFocus.focus === 'function') {
      try { tourOriginFocus.focus({ preventScroll: true }); } catch (e) { tourOriginFocus.focus(); }
    }
    tourOriginFocus = null;
  }
  function wireTour() {
    $('tourNext').addEventListener('click', function () { if (!$('tourNext').disabled) tourShow(tourIndex + 1); });
    $('tourBack').addEventListener('click', function () { tourShow(tourIndex - 1); });
    $('tourSkip').addEventListener('click', tourHide);
    $('tourClose').addEventListener('click', tourHide);
    $('tourReplay').addEventListener('click', function () {
      tourWasSkipped = false;
      try { localStorage.removeItem(TOUR_KEY); } catch (e) {}
      tourShow(0);
    });
    document.querySelectorAll('.theme-btn').forEach(function (button) {
      button.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
      button.addEventListener('click', function () {
        var nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        try { localStorage.setItem('rc_theme', nextTheme); } catch (e) {}
        document.querySelectorAll('.theme-btn').forEach(function (item) { item.setAttribute('aria-pressed', nextTheme === 'dark' ? 'true' : 'false'); });
      });
    });
    var zoomIn = $('mapZoomIn'), zoomOut = $('mapZoomOut');
    if (zoomIn) zoomIn.addEventListener('click', function () { state.mapZoom = Math.min(8, (state.mapZoom || 1) * 2); drawWorldMap(); });
    if (zoomOut) zoomOut.addEventListener('click', function () { state.mapZoom = Math.max(1, (state.mapZoom || 1) / 2); drawWorldMap(); });
    window.addEventListener('resize', tourMeasure, { passive: true });
    window.addEventListener('scroll', tourMeasure, { passive: true });
    document.addEventListener('keydown', function (event) {
      if (tourIndex < 0) return;
      if (event.key === 'Escape') { event.preventDefault(); tourHide(); }
      else if (event.key === 'ArrowLeft' && !/^(INPUT|SELECT|TEXTAREA)$/.test((event.target && event.target.tagName) || '')) {
        event.preventDefault(); if (tourIndex > 0) tourShow(tourIndex - 1);
      } else if (event.key === 'ArrowRight' && !/^(INPUT|SELECT|TEXTAREA)$/.test((event.target && event.target.tagName) || '')) {
        event.preventDefault(); if (tourIndex < TOUR_STEPS.length - 1 && !$('tourNext').disabled) tourShow(tourIndex + 1);
      }
    }, true);
    /* O guia continua disponível pelo botão, mas não cobre o mapa inicial. */
  }
  function focus(view) {
    if (!state.controls) return;
    var o = offset(), s = state.structure ? window.RC_builderTransform.size(state.structure.size,Number($('rotation').value)) : [16,1,16];
    var x = view === 'spawn' && state.spawn ? state.spawn.x : o.x+s[0]/2,y=view === 'spawn' && state.spawn ? state.spawn.y : o.y+s[1]/2,z=view === 'spawn' && state.spawn ? state.spawn.z : o.z+s[2]/2;
    /* Enquadra o terreno 5×5 (ou 3×3 no celular) para completar a tela,
       não só a estrutura: a distância usa o maior dos dois. */
    var distance = Math.max(20, Math.max.apply(Math, s) * 1.8);
    state.controls.target.set(x,y,z);
    if (view === 'top') state.camera.position.set(x,y+distance*1.5,z+0.01);
    else state.camera.position.set(x+distance,y+distance*.85,z+distance);
    state.controls.update(); invalidate();
  }
  var TOOL_BUTTONS = [['toolOrbit', 'orbit'], ['toolPlace', 'place'], ['toolMove', 'move'], ['toolErase', 'erase'], ['toolGizmo', 'gizmo'], ['toolMob', 'mob'], ['toolPaint', 'paint']];
  function setTool(name) {
    state.tool = name;
    TOOL_BUTTONS.forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.setAttribute('aria-pressed', String(pair[1] === name));
    });
    var preview = $('preview');
    if (preview) preview.setAttribute('data-tool', name);
    hint(name === 'orbit' ? 'Orbitar: arraste para girar, roda para zoom, botão direito para pan.'
      : name === 'place' ? 'Colocar no terreno: clique no terreno para posicionar a origem da estrutura (ela cola no chão sozinha).'
      : name === 'erase' ? 'Borracha: clique num bloco da estrutura para apagá-lo; clique no terreno para abrir buraco.'
      : name === 'mob' ? 'Mob: escolha o bicho e clique onde ele deve aparecer (só visual, estilo replay).'
      : name === 'paint' ? 'Pincel: clique no terreno para pintar com o bloco e tamanho escolhidos (vai para o mundo no exportar).'
      : name === 'gizmo' ? (gizmoAttach(), 'Mover 3D: arraste as setas para mover (trava de 1 em 1). Tecle G para alternar mover/girar.')
      : (gizmoDetach(), 'Arrastar estrutura: Shift + arrastar (ou arrastar com esta ferramenta) move X/Z no plano da altura atual.'));
    if (name !== 'gizmo') gizmoDetach();
  }
  /* Gizmo estilo Blender: setas 3D na estrutura, com trava de 1 bloco e 90°. */
  function ensureGizmo() {
    if (state.gizmo) return state.gizmo;
    if (!window.THREE || !window.THREE.TransformControls || !state.scene || !state.renderer || !state.camera) {
      hint('Mover 3D indisponível (Three.js incompleto). Use Arrastar estrutura.');
      return null;
    }
    var gizmo = new window.THREE.TransformControls(state.camera, state.renderer.domElement);
    gizmo.setTranslationSnap(1);
    gizmo.setRotationSnap(Math.PI / 2);
    gizmo.setSize(0.85);
    gizmo.addEventListener('dragging-changed', function (e) { if (state.controls) state.controls.enabled = !e.value; });
    gizmo.addEventListener('objectChange', gizmoPreview);
    gizmo.addEventListener('mouseUp', gizmoCommit);
    state.scene.add(gizmo);
    state.gizmo = gizmo;
    return gizmo;
  }
  function gizmoAttach() {
    var gizmo = ensureGizmo();
    if (!gizmo || !state.placed) return;
    gizmo.setMode(state.gizmoMode);
    gizmo.attach(state.placed);
    gizmo.visible = true;
    invalidate();
  }
  function gizmoDetach() { if (state.gizmo) { try { state.gizmo.detach(); } catch (e) {} state.gizmo.visible = false; invalidate(); } }
  function toggleGizmoMode() {
    state.gizmoMode = state.gizmoMode === 'translate' ? 'rotate' : 'translate';
    gizmoAttach();
    hint(state.gizmoMode === 'translate' ? 'Mover 3D: arraste as setas (trava de 1 em 1). Tecle G para girar.' : 'Mover 3D: gire pelo arco amarelo (trava de 90°). Tecle G para mover.');
  }
  function gizmoPreview() {
    /* Inverso do groupTransform: lê o grupo e devolve origem + rotação. */
    if (!state.placed || !state.structure) return;
    var steps = Math.round(-state.placed.rotation.y / (Math.PI / 2)), t = ((steps % 4) + 4) % 4;
    var size = state.structure.size;
    var px = Math.round(state.placed.position.x - (t === 1 ? size[2] : t === 2 ? size[0] : 0));
    var py = Math.round(state.placed.position.y);
    var pz = Math.round(state.placed.position.z - (t === 2 ? size[2] : t === 3 ? size[0] : 0));
    $('x').value = px; $('y').value = py; $('z').value = pz; $('rotation').value = t * 90;
    var s = window.RC_builderTransform.size(size, t * 90);
    if (state.selectionBox) { state.selectionBox.min.set(px, py, pz); state.selectionBox.max.set(px + s[0], py + s[1], pz + s[2]); }
    $('positionReadout').textContent = 'X ' + px + ' · Y ' + py + ' · Z ' + pz + ' · ' + (t * 90) + '°';
    invalidate();
  }
  function gizmoCommit() {
    if (!state.placed) return;
    applyPosition({ x: Number($('x').value) || 0, y: Number($('y').value) || 0, z: Number($('z').value) || 0, rotation: Number($('rotation').value) || 0 });
  }
  function step() { return Number($('moveStep') && $('moveStep').value) || 1; }
  function nudge(axis, delta) {
    var p = placement();
    p[axis] = p[axis] + delta * step();
    applyPosition(p);
  }
  function wireDrag() {
    var ray = new window.THREE.Raycaster(), pointer = new window.THREE.Vector2(), plane = new window.THREE.Plane(new window.THREE.Vector3(0, 1, 0), 0), hit = new window.THREE.Vector3(), canvas = state.renderer.domElement;
    function terrainHit(event) {
      if (!state.terrain) return null;
      var rect = canvas.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(pointer, state.camera);
      var targets = []; state.terrain.children.forEach(function (g) { targets.push.apply(targets, g.children); });
      var matches = ray.intersectObjects(targets, false); return matches.length ? matches[0].point : null;
    }
    canvas.addEventListener("pointerdown", function (event) {
      if (!state.placed || (!event.shiftKey && state.tool !== 'move')) return;
      var rect = canvas.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(pointer, state.camera);
      if (!ray.intersectObjects(state.placed.children, false).length) return;
      plane.constant = -offset().y; state.drag = { dx: offset().x, dz: offset().z }; state.controls.enabled = false; canvas.setPointerCapture(event.pointerId); event.preventDefault();
    });
    canvas.addEventListener("pointermove", function (event) {
      if (!state.drag && state.tool === 'place' && state.placed && !event.buttons && event.pointerType !== 'touch') {
        var point = terrainHit(event);
        if (point) {
          var p = placement(), s = window.RC_builderTransform.size(state.structure.size, p.rotation), anchor = $('clickAnchor') && $('clickAnchor').value;
          p.x = Math.floor(point.x - (anchor === 'center' ? s[0] / 2 : 0)); p.z = Math.floor(point.z - (anchor === 'center' ? s[2] / 2 : 0));
          var transform = window.RC_Placement.groupTransform(state.structure.size, p);
          state.placed.position.set(transform.x, transform.y, transform.z);
          state.selectionBox.min.set(p.x, p.y, p.z); state.selectionBox.max.set(p.x+s[0], p.y+s[1], p.z+s[2]); invalidate();
        }
      }
      if (!state.drag) return; var rect = canvas.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(pointer, state.camera);
      if (ray.ray.intersectPlane(plane, hit)) { $("x").value = Math.floor(hit.x); $("z").value = Math.floor(hit.z); rebuildStructure(); }
    });
    canvas.addEventListener('pointerleave', function () { if (state.tool === 'place' && !state.drag) rebuildStructure(); });
    canvas.addEventListener("pointerup", function () {
      if (!state.drag) return;
      state.drag = null; state.controls.enabled = true;
      applyPosition({ x: Number($('x').value) || 0, y: offset().y, z: Number($('z').value) || 0, rotation: placement().rotation });
    });
    // Borracha: clique num bloco da estrutura para apagá-lo do preview e da exportação.
    // Colocar no terreno: clique posiciona a origem (ou o centro da base).
    canvas.addEventListener("click", function (event) {
      if (event.shiftKey || state.drag) return;
      var rect = canvas.getBoundingClientRect(); pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1); ray.setFromCamera(pointer, state.camera);
      if (state.tool === 'erase') {
        if (state.placed && state.structure) {
          var structHits = ray.intersectObjects(state.placed.children, false);
          if (structHits.length && structHits[0].instanceId !== undefined) {
            var entry = structHits[0].object.userData.entries[structHits[0].instanceId];
            if (entry) {
              state.erased[entry.x + ',' + entry.y + ',' + entry.z] = 1;
              rebuildStructure();
              hint(Object.keys(state.erased).length + ' bloco(s) apagado(s) do preview e da exportação. “Restaurar blocos” desfaz.');
              return;
            }
          }
        }
        /* Sem bloco da estrutura no clique: apaga bloco do TERRENO (vira ar). */
        if (state.terrain) {
          var targets = [];
          state.terrain.children.forEach(function (g) { targets.push.apply(targets, g.children); });
          var terrHits = ray.intersectObjects(targets, false);
          if (!terrHits.length) return;
          var n = terrHits[0].face ? terrHits[0].face.normal : null;
          var bx = Math.floor(terrHits[0].point.x - (n ? n.x * 0.5 : 0));
          var by = Math.floor(terrHits[0].point.y - (n ? n.y * 0.5 : 0));
          var bz = Math.floor(terrHits[0].point.z - (n ? n.z * 0.5 : 0));
          state.dig[bx + ',' + by + ',' + bz] = 1;
          refreshTerrainMeshes();
          hint('Bloco do terreno removido (' + Object.keys(state.dig).length + ' no total). “Restaurar blocos” desfaz.');
          return;
        }
        return;
      }
      /* Mob estilo replay: clica no terreno ou na construção e ele aparece ali. */
      if (state.tool === 'mob') {
        if (!state.terrain) return;
        var mobTargets = [];
        state.terrain.children.forEach(function (g) { mobTargets.push.apply(mobTargets, g.children); });
        if (state.placed) mobTargets.push.apply(mobTargets, state.placed.children);
        var mobHits = ray.intersectObjects(mobTargets, false);
        if (!mobHits.length) return;
        if (state.mobs.length >= 30) { hint('Limite de 30 mobs no preview. “Limpar mobs” para recomeçar.'); return; }
        var type = ($('mobType') && $('mobType').value) || 'cow';
        state.mobs.push({ x: Math.floor(mobHits[0].point.x), y: Math.floor(mobHits[0].point.y) + 1, z: Math.floor(mobHits[0].point.z), type: MOB_TYPES[type] === undefined ? 'cow' : type });
        rebuildMobs();
        hint(mobLabel(type) + ' colocado (só visual no preview, não vai para o mundo).');
        return;
      }
      /* Pincel: pinta um disco de blocos no nível clicado (menos bedrock). */
      if (state.tool === 'paint') {
        if (!state.terrain) return;
        var paintTargets = [];
        state.terrain.children.forEach(function (g) { paintTargets.push.apply(paintTargets, g.children); });
        var paintHits = ray.intersectObjects(paintTargets, false);
        if (!paintHits.length) return;
        var pn2 = ($('paintBlock') && $('paintBlock').value) || 'minecraft:grass_block';
        var pr = Number(($('paintRadius') && $('paintRadius').value) || 1);
        var cx0 = Math.floor(paintHits[0].point.x), cy0 = Math.floor(paintHits[0].point.y), cz0 = Math.floor(paintHits[0].point.z), nPaint = 0;
        for (var pdx = -pr; pdx <= pr; pdx++) for (var pdz = -pr; pdz <= pr; pdz++) {
          if (pdx * pdx + pdz * pdz > pr * pr) continue;
          var pk = (cx0 + pdx) + ',' + cy0 + ',' + (cz0 + pdz);
          if (state.dig[pk]) delete state.dig[pk];
          var cur = worldBlock(cx0 + pdx, cy0, cz0 + pdz);
          if (cur && cur.name === 'minecraft:bedrock') continue;
          state.paint[pk] = pn2; nPaint++;
        }
        refreshTerrainMeshes();
        hint(nPaint + ' bloco(s) pintados de ' + pn2.replace(/^minecraft:/, '') + ' (vai para o mundo no exportar).');
        return;
      }
      if (state.tool !== 'place' || !state.chunkPreview || !state.terrain) return;
      var targets = [];
      state.terrain.children.forEach(function (g) { targets.push.apply(targets, g.children); });
      var hits = ray.intersectObjects(targets, false);
      if (!hits.length) return;
      var point = hits[0].point, p = placement();
      var size = state.structure ? window.RC_builderTransform.size(state.structure.size, p.rotation) : [1, 1, 1];
      var anchor = $('clickAnchor') && $('clickAnchor').value;
      p.x = Math.floor(point.x - (anchor === 'center' ? size[0] / 2 : 0));
      p.z = Math.floor(point.z - (anchor === 'center' ? size[2] / 2 : 0));
      applyPosition(p);
      snapGround();
    });
  }
  function wireControls() {
    setPlacementMode('map');
    document.querySelectorAll('[data-placement-mode]').forEach(function (button) { button.addEventListener('click', function () { setPlacementMode(button.dataset.placementMode); }); });
    [['rotateLeft', -90], ['rotateRight', 90]].forEach(function (item) { $(item[0]).addEventListener('click', function () { var p = placement(); p.rotation = (p.rotation + item[1] + 360) % 360; applyPosition(p); }); });
    document.querySelectorAll('[data-height]').forEach(function (button) { button.addEventListener('click', function () { var p = placement(); p.y += Number(button.dataset.height); applyPosition(p); }); });
    $('downloadOriginal').addEventListener('click', function () { if (!state.worldFile) return; var url = URL.createObjectURL(state.worldFile), a = document.createElement('a'); a.href = url; a.download = state.worldFile.name; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000); });
    $('focusSpawn').addEventListener('click', function () { if (!state.spawn) return hint('Spawn indisponível neste mundo.'); focus('spawn'); });
    $('focusTop').addEventListener('click', function () { focus('top'); });
    setTool(state.tool || 'orbit');
    TOOL_BUTTONS.forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.addEventListener('click', function () { setTool(pair[1]); });
    });
    var viewTop = $('viewTop'), viewIso = $('viewIso');
    if (viewTop) viewTop.addEventListener('click', function () { focus('top'); });
    if (viewIso) viewIso.addEventListener('click', function () { focus(); });
    var goSpawn = $('goSpawn');
    if (goSpawn) goSpawn.addEventListener('click', function () {
      if (state.spawn) { applyPosition({ x: state.spawn.x, y: state.spawn.y, z: state.spawn.z, rotation: placement().rotation }); snapGround().then(focus); }
      else if (state.regions.length) useRegion(0);
      else hint('Mundo ainda sem spawn ou região visitada para ir.');
    });
    var goPlayer = $('goPlayer');
    if (goPlayer) goPlayer.addEventListener('click', function () {
      if (state.playerPos) { applyPosition({ x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z, rotation: placement().rotation }); snapGround().then(focus); }
      else hint('Nenhum player salvo neste mundo (mundo nunca aberto no jogo?).');
    });
    var goC = $('goCoords');
    if (goC) goC.addEventListener('click', function () {
      if (!state.world) { hint('Carregue um mundo primeiro.'); return; }
      /* Vale qualquer canto do mundo, até o fim: X/Z que existem no jogo. */
      applyPosition({ x: Number($('x').value) || 0, y: Number($('y').value) || 0, z: Number($('z').value) || 0, rotation: placement().rotation });
      snapGround().then(focus);
    });
    var photo = $('photoBtn');
    if (photo) photo.addEventListener('click', function () {
      if (!state.renderer) { hint('Abra um mundo primeiro.'); return; }
      state.renderer.render(state.scene, state.camera);
      var a = document.createElement('a');
      a.href = state.renderer.domElement.toDataURL('image/png');
      a.download = 'builder-foto.png'; a.click();
      hint('Foto salva! Mostre sua construção de onde a câmera está.');
    });
    var skySel = $('skyMode');
    if (skySel) skySel.addEventListener('change', function () { applySky(skySel.value); });
    var analyzing = 0;
    var analyzeBtn = $('analyzeWorld');
    if (analyzeBtn) analyzeBtn.addEventListener('click', function () {
      if (!state.world || !state.chunkPreview) { hint('Carregue um mundo primeiro.'); return; }
      analyzeWorld();
    });
    async function analyzeWorld() {
      var manager = state.chunkPreview, slot = $('worldStats'), my = ++analyzing;
      if (!manager || !slot) return;
      var ids = Array.from(manager.records.keys());
      slot.textContent = 'Analisando 0/' + ids.length + ' chunks…';
      var counts = {}, totalBlocks = 0, subchunks = 0, minY = Infinity, maxY = -Infinity, errCount = 0;
      for (var i = 0; i < ids.length; i++) {
        if (my !== analyzing || state.chunkPreview !== manager) return;
        var rec = manager.records.get(ids[i]);
        if (rec) subchunks += rec.subchunks.size;
        var chunk = await manager.decodeAsync(ids[i]);
        if (chunk) {
          chunk.blocks.forEach(function (b) {
            counts[b.name] = (counts[b.name] || 0) + 1; totalBlocks++;
            if (b.y < minY) minY = b.y; if (b.y > maxY) maxY = b.y;
          });
          errCount += chunk.errors.length;
          if (!manager.loadedChunks.has(ids[i])) manager.cache.delete(ids[i]);
        }
        if (i % 10 === 9) { slot.textContent = 'Analisando ' + (i + 1) + '/' + ids.length + ' chunks…'; await new Promise(function (r) { setTimeout(r, 0); }); }
      }
      if (my !== analyzing || state.chunkPreview !== manager) return;
      var top = Object.keys(counts).map(function (n) { return { n: n, c: counts[n] }; }).sort(function (a, b) { return b.c - a.c; }).slice(0, 12);
      var hasPlayer = false, visitors = 0;
      try {
        state.world.db.keys.forEach(function (kv, sk) {
          if (!kv || kv === false || typeof sk !== 'string') return;
          if (sk === '~local_player') hasPlayer = true;
          else if (sk.indexOf('player_') === 0) visitors++;
        });
      } catch (e) {}
      var max = top.length ? top[0].c : 1;
      var html = '<p><b>' + ids.length + '</b> chunks · <b>' + subchunks + '</b> subchunks · <b>' + totalBlocks.toLocaleString('pt-BR') + '</b> blocos (Y ' + minY + '–' + maxY + ')' + (errCount ? ' · ' + errCount + ' ilegíveis' : '') + '</p>';
      html += '<p>Players: <b>' + (hasPlayer ? 'principal' : 'nenhum') + '</b>' + (visitors ? ' + ' + visitors + ' visitante(s)' : '') + (state.spawn ? ' · spawn ' + state.spawn.x + ',' + state.spawn.y + ',' + state.spawn.z : '') + (state.spawn && state.spawn.seed ? ' · seed ' + esc(state.spawn.seed) : '') + (state.playerPos ? ' · player ' + state.playerPos.x + ',' + state.playerPos.y + ',' + state.playerPos.z : '') + '</p>';
      html += '<p>Blocos mais comuns:</p>' + top.map(function (t) {
        return '<div style="display:flex;gap:6px;align-items:center"><span style="flex:0 0 44%">' + esc(t.n.replace(/^minecraft:/, '')) + '</span><span style="flex:1;background:#1c2942;border-radius:4px"><span style="display:block;height:8px;border-radius:4px;background:#5EBB2B;width:' + Math.round(t.c / max * 100) + '%"></span></span><span>' + t.c.toLocaleString('pt-BR') + '</span></div>';
      }).join('');
      slot.innerHTML = html;
    }
    var rangeSel = $('terrainRange');
    if (rangeSel) rangeSel.addEventListener('change', function () {
      if (!state.chunkPreview) return;
      var v = Number(rangeSel.value);
      if (![1, 2, 3].includes(v)) return;
      state.chunkPreview.renderDistance = v;
      state.terrainKey = null;
      rebuildTerrain().then(function () { focus(); });
      hint(v === 1 ? 'Alcance 3×3: leve e rápido.' : v === 2 ? 'Alcance 5×5: equilíbrio.' : 'Alcance 7×7: amplo (pesa no PC fraco).');
    });
    var snap = $('snapGround');
    if (snap) snap.addEventListener('click', function () { snapGround().then(focus); });
    var restore = $('restoreErased');
    if (restore) restore.addEventListener('click', function () {
      state.erased = {}; state.dig = {}; state.paint = {};
      rebuildStructure(); refreshTerrainMeshes();
      hint('Blocos apagados restaurados.');
    });
    var undo = $('undoPosition'), redo = $('redoPosition');
    if (undo) undo.addEventListener('click', function () { var p = state.history.move(-1); if (p) { applyPosition(p, false); updateHistory(); } });
    if (redo) redo.addEventListener('click', function () { var p = state.history.move(1); if (p) { applyPosition(p, false); updateHistory(); } });
    Array.prototype.forEach.call(document.querySelectorAll('.nudge-grid [data-axis]'), function (btn) {
      btn.addEventListener('click', function () { nudge(btn.getAttribute('data-axis'), Number(btn.getAttribute('data-delta')) || 0); });
    });
    ['showStructure', 'showOutline'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', function () { rebuildStructure(); });
    });
    var clearMobsBtn = $('clearMobs');
    if (clearMobsBtn) clearMobsBtn.addEventListener('click', function () {
      state.mobs = [];
      rebuildMobs();
      hint('Mobs removidos do preview.');
    });
    var clearTreesEl = $('clearTrees');
    if (clearTreesEl) clearTreesEl.addEventListener('change', function () {
      /* Some na hora no preview (sem recodificar) + conta na validação. */
      if (state.chunkPreview) state.chunkPreview.setHideVegetation(clearTreesEl.checked);
      refreshTerrainMeshes();
    });
    // Teclado: setas = X/Z · PageUp/PageDown = Y · R = girar · Esc = orbitar.
    // Mesma origem/transform do preview e da escrita (applyPosition).
    document.addEventListener('keydown', function (event) {
      var tag = (event.target && event.target.tagName) || '';
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || $('result').hidden) return;
      if (state.placementMode === '3d' && state.controls && /^[wasdqe]$/i.test(event.key)) {
        var forward = new window.THREE.Vector3().subVectors(state.controls.target, state.camera.position); forward.y = 0; forward.normalize();
        var right = new window.THREE.Vector3(-forward.z, 0, forward.x), vector = new window.THREE.Vector3();
        if (event.key.toLowerCase() === 'w') vector.copy(forward);
        else if (event.key.toLowerCase() === 's') vector.copy(forward).negate();
        else if (event.key.toLowerCase() === 'd') vector.copy(right);
        else if (event.key.toLowerCase() === 'a') vector.copy(right).negate();
        else vector.y = event.key.toLowerCase() === 'e' ? 1 : -1;
        vector.multiplyScalar(Math.max(2, state.camera.position.distanceTo(state.controls.target) * 0.08)); state.camera.position.add(vector); state.controls.target.add(vector); state.controls.update(); invalidate(); event.preventDefault(); return;
      }
      if ((event.key === 'g' || event.key === 'G') && state.tool === 'gizmo') { event.preventDefault(); toggleGizmoMode(); return; }
      var p = placement(), handled = true;
      if (event.key === 'ArrowLeft') p.x -= step();
      else if (event.key === 'ArrowRight') p.x += step();
      else if (event.key === 'ArrowUp') p.z -= step();
      else if (event.key === 'ArrowDown') p.z += step();
      else if (event.key === 'PageUp') p.y += step();
      else if (event.key === 'PageDown') p.y -= step();
      else if (event.key === 'r' || event.key === 'R') p.rotation = (p.rotation + 90) % 360;
      else if (event.key === 'Escape') setTool('orbit');
      else handled = false;
      if (handled) { event.preventDefault(); if (event.key !== 'Escape') applyPosition(p); }
    });
  }
  $("worldFile").addEventListener("change", function () { if (this.files && this.files[0]) loadWorld(this.files[0]); });
  $("structureFile").addEventListener("change", function () { if (this.files && this.files[0]) loadStructure(this.files[0]); });
  ["x", "y", "z", "rotation"].forEach(function (id) { $(id).addEventListener("change", function () { try { applyPosition({ x: Number($("x").value) || 0, y: Number($("y").value) || 0, z: Number($("z").value) || 0, rotation: Number($("rotation").value) || 0 }); } catch (e) { hint(e.message); drawWorldMap(); renderAll(true); } }); });
  $("worldMap").addEventListener("click", pickWorldMap);
  $("worldMap").addEventListener("mouseleave", function () { var tip = $("mapTip"); if (tip) tip.hidden = true; });
  $("worldMap").addEventListener("mousemove", function (event) {
    var hover = $('mapHover');
    if (!hover || !state.mapView) return;
    var canvas = $("worldMap"), rect = canvas.getBoundingClientRect(), v = state.mapView;
    var mx = (event.clientX - rect.left) * canvas.width / rect.width, mz = (event.clientY - rect.top) * canvas.height / rect.height;
    var ccx = Math.floor((mx - v.pad) / v.scale + v.minX), ccz = Math.floor((mz - v.pad) / v.scale + v.minZ);
    var coordText = 'Chunk ' + ccx + ',' + ccz + ' · blocos X ' + (ccx*16) + '–' + (ccx*16+15) + ' · Z ' + (ccz*16) + '–' + (ccz*16+15);
    hover.textContent = coordText;
    var tip = $('mapTip');
    if (tip) {
      tip.textContent = coordText;
      tip.hidden = false;
      tip.style.left = (canvas.offsetLeft + event.clientX - rect.left + 14) + 'px';
      tip.style.top = (canvas.offsetTop + event.clientY - rect.top - 10) + 'px';
    }
  });
  $("refreshTerrain").addEventListener("click", function () { if (state.world && state.structure) { rebuildTerrain(); rebuildStructure(); } });
  $("focus").addEventListener("click", function () { focus(); });
  $("useRegion").addEventListener("click", function () { useRegion(); });
  $("reset").addEventListener("click", function () { applyPosition({ x: 0, y: 64, z: 0, rotation: 0 }); focus(); });
  $("report").addEventListener("click", function () {
    if (!state.structure) return; var payload = { world: state.worldFile && state.worldFile.name, structure: state.structureFile && state.structureFile.name, dimensions: state.structure.size, position: offset(), rotation: Number($("rotation").value), block_entities: entityTypes(), entities: (state.structure.sourceEntities || []).length, materials: materialRows, issues: state.structure.issues || [], generated_at: new Date().toISOString() }, url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })), a = document.createElement("a"); a.href = url; a.download = "builder-report.json"; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  });
  var exportBtn = $("exportWorld");
  function exportMsg(message) {
    /* O recado aparece EMBAIXO do botão (onde o olho está) e no topo. */
    var slot = $("exportStatus");
    if (slot) { slot.textContent = message; if (slot.scrollIntoView) { try { slot.scrollIntoView({ block: 'nearest' }); } catch (e) {} } }
    $("status").textContent = message;
  }
  if (exportBtn) exportBtn.addEventListener("click", function () {
    if (exportBtn.disabled) return;
    if (!state.world || !state.structure) { exportMsg('Carregue o mundo e a estrutura antes de exportar.'); hint('Carregue o mundo e a estrutura antes de exportar.'); return; }
    var p = placement(), mode = ($('buildMode') && $('buildMode').value) || 'ignore_air';
    var clearTrees = !!($('clearTrees') && $('clearTrees').checked);
    var erasedCount = Object.keys(state.erased).length;
    var filtered = { size: state.structure.size, volume: state.structure.volume, blocks: state.structure.blocks.filter(function (b) { return !state.erased[b.x + ',' + b.y + ',' + b.z]; }) };
    if (!filtered.blocks.length) { hint('Nada para exportar: todos os blocos foram apagados ou são ar.'); return; }
    $('status').textContent = 'Planejando a construção…';
    exportMsg('Planejando a construção…');
    exportBtn.disabled = true; exportBtn.textContent = 'Exportando… aguarde';
    function exportDone(message) { exportMsg(message); exportBtn.disabled = false; exportBtn.textContent = 'Construir e baixar mundo'; }
    var build;
    try { build = window.RC_builderCore.plan(state.world, filtered, { x: p.x, y: p.y, z: p.z, dimension: 0, rotation: p.rotation, mode: mode, clearTrees: clearTrees, dig: state.dig, paint: state.paint }); }
    catch (planError) {
      var msg = planError.message || String(planError);
      if (planError.code === 'BUILDER_UNVISITED') msg += ' Clique numa chunk colorida do mapa (área visitada) e tente de novo.';
      hint('Não exportei: ' + msg);
      exportDone('Exportação cancelada antes de gravar (mundo intacto): ' + msg);
      return;
    }
    if (!build.ops.length) { hint('Nada mudou no mundo com esses blocos e esse modo.'); exportDone('Nada para gravar com esses blocos e esse modo.'); return; }
    exportMsg('Montando o arquivo (' + build.placed.toLocaleString('pt-BR') + ' blocos, pode demorar em mundos grandes)…');
    var w = state.world, sourceFile = state.worldFile, update;
    try { update = window.RC_ldbw.buildDbUpdate({ manifestBytes: w.manifestBytes, manifestName: w.manifestName, nextFile: w.nextFile, lastSeq: w.lastSeq, logNumber: w.logNumber, ops: build.ops }); }
    catch (updateError) { exportDone('Falha ao exportar: ' + (updateError.message || updateError)); return; }
    var operationId = '';
    try { operationId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(); }
    catch (operationIdError) { operationId = String(Date.now()) + Math.random(); }
    var operationDecision = null, worldInfo = { project_id: '', fingerprint: '' };
    var authorization = window.RC_entitlements.load().then(function (entitlement) {
      if (entitlement.status !== 'ready' && entitlement.status !== 'unauthenticated') throw new Error('ENTITLEMENT_UNAVAILABLE');
      var fileAccess = window.RC_entitlements.canUseFile([sourceFile]);
      if (!fileAccess.allowed) {
        if (entitlement.pending_payment) throw new Error(window.RC_entitlements.messageForPending(entitlement.pending_payment));
        throw new Error('Este mundo excede o limite de ' + fileAccess.max_file_mb + ' MB do plano ' + (entitlement.plan_label || entitlement.plan) + '.');
      }
      return window.RC_entitlements.worldProjectInfo(sourceFile);
    }).then(function (info) {
      worldInfo = info || worldInfo;
      return window.RC_entitlements.checkOperation({
        worlds: 1, size_bytes: sourceFile.size, features: { tool: 'builder' }, operation_id: operationId,
        world_project_id: worldInfo.project_id, world_fingerprint: worldInfo.fingerprint
      });
    }).then(function (decision) { operationDecision = decision; return decision; });
    authorization.then(function () { return window.RC_dbx.assemble(w, update.newManifestBytes, update.logName, update.logBytes); }).then(function (blob) {
      exportMsg('Verificando a gravação…');
      return window.RC_builderCore.verify(blob, build).then(function () { return blob; });
    }).then(async function (blob) {
      var projectId = operationDecision.world_project_id || worldInfo.project_id;
      var finalized = operationDecision.requires_credit
        ? await window.RC_entitlements.markWorldForCompletion(blob, projectId)
        : { blob: await window.RC_entitlements.markWorld(blob, projectId), fingerprint: '' };
      if (operationDecision.requires_completion) await window.RC_entitlements.complete(operationId, finalized.fingerprint);
      var base = (sourceFile && sourceFile.name || 'mundo.mcworld').replace(/\.mcworld$/i, '');
      window.RC_dbx.downloadBlob(finalized.blob, base + '-com-estrutura.mcworld');
      if (window.RC_pay && window.RC_pay.track) window.RC_pay.track('operation_completed', { tool: 'builder', worlds: 1 });
      window.RC_entitlements.refresh().catch(function () {});
      exportDone('Exportado! ' + build.placed.toLocaleString('pt-BR') + ' blocos gravados' + (build.createdSubchunks ? ' (+' + build.createdSubchunks + ' subchunk(s) de ar criada(s) no céu)' : '') + (build.cleared ? ' (' + build.cleared.toLocaleString('pt-BR') + ' de vegetação removida)' : '') + (build.dug ? ' (' + build.dug.toLocaleString('pt-BR') + ' buracos da borracha)' : '') + (build.painted ? ' (' + build.painted.toLocaleString('pt-BR') + ' pintados)' : '') + (erasedCount ? ' (' + erasedCount + ' apagado(s) pela borracha)' : '') + ', ' + build.replaced.toLocaleString('pt-BR') + ' substituídos, ' + build.skipped.toLocaleString('pt-BR') + ' ignorados.');
      hint('Mundo exportado com a estrutura. Abra o arquivo baixado no Minecraft.');
    }).catch(function (exportError) {
      if (operationId && window.RC_entitlements) window.RC_entitlements.release(operationId).catch(function () {});
      var message = window.RC_entitlements ? window.RC_entitlements.messageForError(exportError) : (exportError.message || exportError);
      exportDone('Falha ao exportar: ' + message);
    });
  });
  wireTour();
  wireControls();
  $('downloadMaterials').addEventListener('click', function () {
    if (!materialRows.length) return;
    var quote = function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; };
    var csv = '\ufeffBloco,Unidades,Pilhas de 64,Shulkers estimadas\r\n' + materialRows.map(function (row) { return [row.block, row.count, row.stacks64, row.shulkers].map(quote).join(','); }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    var base = (state.structureFile && state.structureFile.name || 'estrutura').replace(/\.mcstructure$/i, '').replace(/[\\/:*?"<>|]+/g, '-');
    a.href = url; a.download = base + '-materiais.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });
})();
