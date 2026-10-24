/* Worldify — cena 3D do hero.
   Mostra o fluxo real do produto (selecionar, posicionar estrutura, chunks) em um mundo voxel.
   Carrega o Three.js só depois do load e em ociosidade, para não atrasar o upload.
   Sem WebGL, com "Modo leve", economia de dados, pouca memória ou movimento reduzido: fica o poster estático. */
(function () {
  'use strict';
  var hero = document.querySelector('.wf-hero');
  var canvas = hero && hero.querySelector('.wf-hero-canvas');
  var chip = hero && hero.querySelector('.wf-hero-step');
  if (!hero || !canvas) return;

  var conn = navigator.connection || {};
  var small = window.matchMedia && window.matchMedia('(max-width:720px)').matches;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  var lite = false;
  try { lite = localStorage.getItem('rc_light') === '1'; } catch (e) {}
  var lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  if (reduce || lite || conn.saveData || lowEnd) return;

  function webgl() {
    try { var c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; }
  }
  if (!webgl()) return;

  function loadThree(cb) {
    if (window.THREE) return cb();
    var s = document.createElement('script');
    s.src = 'vendor/three.min.js?v=124';
    s.onload = cb;
    s.onerror = function () {};
    document.head.appendChild(s);
  }

  function start() {
    var THREE = window.THREE;
    var N = 32, CHUNK = 16;
    var tier = small ? 0 : 1;

    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !small, alpha: false, powerPreference: 'high-performance' });
    renderer.setClearColor(0xffffff, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier ? 1.75 : 1.25));
    if (tier) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 60, 120);
    var camera = new THREE.PerspectiveCamera(36, 1, 0.5, 200);

    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2440, 1.05));
    var sun = new THREE.DirectionalLight(0xfff1dc, 1.15);
    sun.position.set(-18, 34, 14);
    sun.target.position.set(16, 0, 16);
    scene.add(sun, sun.target);
    if (tier) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(1536, 1536);
      var sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
      sun.shadow.bias = -0.0006;
    }

    /* ---------- voxels ---------- */
    var geo = new THREE.BoxBufferGeometry(1, 1, 1);
    var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var tmp = new THREE.Object3D(), col = new THREE.Color();
    function rnd(x, y, z) { var v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); }

    function height(x, z) {
      var h = 2 + Math.round(1.5 * Math.sin(x * 0.33) + 1.3 * Math.cos(z * 0.29) + 1.1 * Math.sin((x + z) * 0.19));
      if (x >= 4 && x <= 14 && z >= 4 && z <= 13) h = 3;      // base da casa
      if (x >= 19 && x <= 27 && z >= 3 && z <= 11) h = 3;     // base da torre
      return Math.max(1, h);
    }

    function makeMesh(list, cast) {
      var m = new THREE.InstancedMesh(geo, mat, list.length);
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        tmp.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5); tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);
        var j = (rnd(b.x, b.y, b.z) - 0.5) * 0.09;
        col.setHex(b.c); col.offsetHSL(0, 0, j);
        m.setColorAt(i, col);
      }
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      m.castShadow = !!(cast && tier); m.receiveShadow = !!tier;
      m.userData.list = list;
      return m;
    }

    var GRASS = 0x5f9a3c, DIRT = 0x7a5436, STONE = 0x74777c, SAND = 0xd9c78f, PLANK = 0xb08556, LOG = 0x5b4128, ROOF = 0x8c3b34, BRICK = 0x8b8d92, GLASS = 0x9fd4ee, DARK = 0x2a2d31;
    var terrain = [];
    for (var x = 0; x < N; x++) for (var z = 0; z < N; z++) {
      var h = height(x, z);
      for (var y = Math.max(0, h - 3); y < h; y++) {
        var open = y === h - 1;
        var c = open ? (h <= 1 ? SAND : GRASS) : (y >= h - 2 ? DIRT : STONE);
        terrain.push({ x: x, y: y, z: z, c: c, chunk: (x >= CHUNK ? 1 : 0) + (z >= CHUNK ? 2 : 0) });
      }
    }
    var terrainMesh = makeMesh(terrain, false);
    scene.add(terrainMesh);

    // casa (chunk 0,0)
    var house = [], hx = 6, hz = 6, hw = 7, hd = 6, hy = 3;
    for (var a = 0; a < hw; a++) for (var b2 = 0; b2 < hd; b2++) {
      var edge = a === 0 || a === hw - 1 || b2 === 0 || b2 === hd - 1;
      var corner = (a === 0 || a === hw - 1) && (b2 === 0 || b2 === hd - 1);
      for (var k = 0; k < 4; k++) {
        if (!edge) continue;
        if (k === 0 && a === 3 && b2 === 0) continue;                  // porta
        if (k === 1 && a === 3 && b2 === 0) continue;
        var win = k === 1 && !corner && ((a === 1 || a === hw - 2) || (b2 === 3 && (a === 0 || a === hw - 1)));
        house.push({ x: hx + a, y: hy + k, z: hz + b2, c: corner ? LOG : (win ? GLASS : PLANK) });
      }
    }
    for (var r = 0; r < 4; r++) for (var q = -r; q < hw + r; q++) {
      if (q < r || q > hw - 1 - r) continue;
      for (var w = 0; w < hd; w++) if (r < 3 || w % 1 === 0) house.push({ x: hx + q, y: hy + 4 + r, z: hz + w, c: ROOF });
    }
    var houseMesh = makeMesh(house, true);
    scene.add(houseMesh);

    // torre (chunk 1,0) — entra animada
    var tower = [], tx = 22, tz = 5, tw = 3;
    for (var ty = 0; ty < 11; ty++) for (var i2 = 0; i2 < tw; i2++) for (var j2 = 0; j2 < tw; j2++) {
      var edge2 = i2 === 0 || i2 === tw - 1 || j2 === 0 || j2 === tw - 1;
      if (!edge2 && ty < 10) continue;
      var cornerT = (i2 !== 1 && j2 !== 1);
      if (ty === 4 && !cornerT) { tower.push({ x: tx + i2, y: 3 + ty, z: tz + j2, c: DARK }); continue; }
      tower.push({ x: tx + i2, y: 3 + ty, z: tz + j2, c: cornerT ? 0x9b9ea4 : BRICK });
    }
    for (var m2 = -1; m2 <= tw; m2++) for (var n2 = -1; n2 <= tw; n2++) {
      var rim = m2 === -1 || m2 === tw || n2 === -1 || n2 === tw;
      if (rim && (m2 + n2) % 2 === 0) tower.push({ x: tx + m2, y: 3 + 11, z: tz + n2, c: 0x9b9ea4 });
      else if (rim) tower.push({ x: tx + m2, y: 3 + 10, z: tz + n2, c: 0x9b9ea4 });
    }
    var towerMesh = makeMesh(tower, true);
    scene.add(towerMesh);

    // arbustos simples
    var trees = [];
    [[16, 20], [10, 22], [26, 22], [3, 17], [29, 15]].forEach(function (p) {
      var g = height(p[0], p[1]);
      for (var t = 0; t < 4; t++) trees.push({ x: p[0], y: g + t, z: p[1], c: LOG });
      for (var lx = -1; lx <= 1; lx++) for (var lz = -1; lz <= 1; lz++) for (var ly = 0; ly < 2; ly++)
        if (!(lx === 0 && lz === 0 && ly === 0)) trees.push({ x: p[0] + lx, y: g + 3 + ly, z: p[1] + lz, c: 0x3e7a35 });
    });
    scene.add(makeMesh(trees, true));

    /* ---------- overlays de edição ---------- */
    function box(x0, y0, z0, w, h2, d, color) {
      var g = new THREE.BoxBufferGeometry(w, h2, d);
      var l = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0, depthTest: false }));
      l.position.set(x0 + w / 2, y0 + h2 / 2, z0 + d / 2); l.renderOrder = 10;
      scene.add(l); return l;
    }
    var selBox = box(hx - 0.1, hy, hz - 0.1, hw + 0.2, 8.2, hd + 0.2, 0xffffff);
    var ghost = box(tx - 1.05, 3, tz - 1.05, tw + 2.1, 12.1, tw + 2.1, 0x8ec5ff);

    var gridMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    var gp = [];
    for (var gi = 0; gi <= CHUNK; gi += 2) { gp.push(gi, 0, 0, gi, 0, CHUNK, 0, 0, gi, CHUNK, 0, gi); }
    var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    var grid = new THREE.LineSegments(gg, gridMat);
    grid.position.set(CHUNK, 5.1, 0); grid.renderOrder = 9; scene.add(grid);
    var slab = new THREE.Mesh(new THREE.PlaneBufferGeometry(CHUNK, CHUNK), new THREE.MeshBasicMaterial({ color: 0x8ec5ff, transparent: true, opacity: 0, depthWrite: false }));
    slab.rotation.x = -Math.PI / 2; slab.position.set(CHUNK + CHUNK / 2, 5.05, CHUNK / 2); slab.renderOrder = 8; scene.add(slab);

    /* ---------- linha do tempo ---------- */
    function ease(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
    function out(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }
    function seg(t, a, b) { return (t - a) / (b - a); }
    var V = THREE.Vector3;
    var shots = [
      { t: 0, p: new V(62, 40, 66), l: new V(16, 2, 14) },
      { t: 2.4, p: new V(42, 22, 46), l: new V(14, 4, 12) },
      { t: 4.6, p: new V(30, 18, 38), l: new V(13, 6, 10) },
      { t: 7.0, p: new V(50, 22, 30), l: new V(22, 6, 8) },
      { t: 9.6, p: new V(48, 24, 40), l: new V(22, 3, 10) },
      { t: 12.2, p: new V(56, 34, 62), l: new V(16, 2, 14) }
    ];
    var camP = new V(), camL = new V();
    function shot(t) {
      var i = 0; while (i < shots.length - 2 && t > shots[i + 1].t) i++;
      var a = shots[i], b = shots[i + 1], k = ease(seg(t, a.t, b.t));
      camP.copy(a.p).lerp(b.p, k); camL.copy(a.l).lerp(b.l, k);
      if (camera.aspect < 1.1) camP.sub(camL).multiplyScalar(1 + (1.1 - camera.aspect) * 1.5).add(camL);   // telas verticais: afasta
    }
    var steps = [[0, 'Seu mundo, carregado no navegador'], [2.6, 'Selecionar uma construção'], [4.8, 'Posicionar uma estrutura'], [7.4, 'Escolher chunks'], [9.8, 'Mundo editado, pronto para exportar']];
    var lastStep = -1;
    function setStep(t) {
      var s = 0; for (var i = 0; i < steps.length; i++) if (t >= steps[i][0]) s = i;
      if (s !== lastStep && chip) { lastStep = s; chip.textContent = steps[s][1]; chip.classList.remove('on'); void chip.offsetWidth; chip.classList.add('on'); }
    }
    var towerBase = towerMesh.position.y;
    var warm = new THREE.Color();
    function timeline(t) {
      shot(t); setStep(t);
      selBox.material.opacity = 0.9 * ease(seg(t, 2.6, 3.2)) * (1 - ease(seg(t, 4.4, 4.9))) * (0.7 + 0.3 * Math.sin(t * 7));
      selBox.scale.setScalar(1 + 0.012 * Math.sin(t * 7));
      ghost.material.opacity = 0.85 * ease(seg(t, 4.8, 5.3)) * (1 - ease(seg(t, 6.0, 6.3)));
      var d = out(seg(t, 5.4, 6.3));
      var bounce = d >= 1 ? Math.max(0, Math.sin(seg(t, 6.3, 6.7) * Math.PI) * 0.35 * (1 - seg(t, 6.3, 6.7))) : 0;
      towerMesh.position.y = towerBase + (1 - d) * 26 + bounce;
      towerMesh.visible = t > 5.3;
      var g = ease(seg(t, 7.4, 8.0)) * (1 - ease(seg(t, 10.0, 10.6)));
      gridMat.opacity = 0.55 * g; slab.material.opacity = 0.12 * g;
      // transformação sutil do terreno no chunk destacado
      var wave = ease(seg(t, 8.0, 10.2));
      if (wave !== lastWave) {
        lastWave = wave;
        var list = terrainMesh.userData.list;
        for (var i = 0; i < list.length; i++) {
          var b = list[i]; if (b.chunk !== 1) continue;
          var front = wave * (CHUNK + 6) - 3;               // frente da onda ao longo de z
          var k = Math.max(0, Math.min(1, (front - b.z) / 3));
          col.setHex(b.c); warm.setHex(b.c === GRASS ? 0xcdd6df : (b.c === DIRT ? 0x8a939d : b.c));
          col.lerp(warm, k * 0.9); col.offsetHSL(0, 0, (rnd(b.x, b.y, b.z) - 0.5) * 0.09);
          terrainMesh.setColorAt(i, col);
        }
        terrainMesh.instanceColor.needsUpdate = true;
      }
    }
    var lastWave = -1;

    /* ---------- loop ---------- */
    function resize() {
      var w = hero.clientWidth, h = hero.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      if (w > 900) camera.setViewOffset(w, h, -w * 0.16, 0, w, h); else if (w / h < 1.1) camera.setViewOffset(w, h, 0, h * 0.12, w, h); else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(hero); else window.addEventListener('resize', resize);

    var visible = true, running = false, t0 = 0, last = 0, frameBudget = tier ? 0 : 33, ready = false;
    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      if (frameBudget && now - last < frameBudget) return;
      last = now;
      var t = (now - t0) / 1000;
      if (t > 12.2) {                      // depois da abertura: deriva lenta
        shot(12.2);
        var a = (t - 12.2) * 0.05, dx = camP.x - 16, dz = camP.z - 14;
        camP.x = 16 + dx * Math.cos(a) - dz * Math.sin(a); camP.z = 14 + dx * Math.sin(a) + dz * Math.cos(a);
        setStep(10); if (chip) chip.classList.remove('on');
      } else timeline(t);
      camera.position.copy(camP); camera.lookAt(camL);
      renderer.render(scene, camera);
      if (!ready) { ready = true; hero.classList.add('wf-hero-3d'); }
    }
    function run() { if (running || !visible || document.hidden) return; running = true; t0 = performance.now() - (t0 ? (last - t0) : 0); requestAnimationFrame(frame); }
    function stop() { running = false; }
    if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; visible ? run() : stop(); }, { threshold: 0.05 }).observe(hero);
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : run(); });
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); hero.classList.remove('wf-hero-3d'); });
    run();
  }

  function boot() {
    var go = function () { loadThree(function () { try { start(); } catch (e) { /* mantém o poster */ } }); };
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 1200);
  }
  if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot);
})();
