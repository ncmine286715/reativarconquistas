/* Builder Lab - carregamento incremental de chunks Bedrock para preview.
 *
 * Representação intermediária (o renderer NUNCA recebe buffer bruto LevelDB):
 *   RenderChunk { chunkX, chunkZ, minY, maxY, blocks: RenderBlock[], byPos, heights, errors }
 *   RenderBlock { x, y, z, name, states?, transparent?, layer? }
 * Parser Bedrock: LevelDB -> RenderChunk (aqui + bedrockChunkWorker.js).
 * Three.js: RenderChunk -> Mesh (builder-lab.js).
 */
(function () {
  "use strict";
  var AIR = /^(?:minecraft:)?(?:air|cave_air|void_air)$/;
  function floorDiv(n, d) { return Math.floor(n / d); }
  function mod(n, d) { return ((n % d) + d) % d; }
  function key(dim, cx, cz) { return String(dim) + ":" + cx + ":" + cz; }
  function bytes(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (typeof v === "string") { var out = new Uint8Array(v.length); for (var i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 255; return out; }
    return v ? new Uint8Array(v) : null;
  }
  function isAir(name) { return !name || AIR.test(name); }

  function ChunkPreviewManager(world, options) {
    options = options || {};
    this.world = world;
    this.dimension = options.dimension == null ? 0 : options.dimension;
    this.renderDistance = options.renderDistance == null ? 2 : options.renderDistance;
    this.mode = options.mode || "SURFACE";
    this.structurePosition = { x: 0, y: 64, z: 0 };
    this.centerChunkX = 0;
    this.centerChunkZ = 0;
    this.loadedChunks = new Map();
    this.chunkMeshes = new Map();
    this.cache = new Map();
    this.records = new Map();
    this.stats = { indexed: 0, loaded: 0, decoded: 0, blocks: 0, visible: 0 };
    this.pending = new Map();
    this.inflight = new Map();
    this.sequence = 0;
    this.generation = 0;
    this.worker = null;
    this.disposed = false;
    this.maxCachedChunks = 40;
    this.maxCachedBlocks = 900000;
    this.indexRecords();
  }
  ChunkPreviewManager.prototype.indexRecords = function () {
    var self = this, entries = this.world && this.world.db && this.world.db.keys;
    if (!entries) return;
    entries.forEach(function (kv) {
      if (!kv || kv === false) return;
      var parsed = null;
      try { parsed = window.RC_dbx.parseChunkKey(kv.keyBytes || kv.key); } catch (e) {}
      if (!parsed || parsed.dim !== self.dimension || parsed.tag !== 47) return;
      var id = key(parsed.dim, parsed.cx, parsed.cz), chunk = self.records.get(id);
      if (!chunk) { chunk = { chunkX: parsed.cx, chunkZ: parsed.cz, subchunks: new Map() }; self.records.set(id, chunk); }
      chunk.subchunks.set(parsed.sub, kv);
      self.stats.indexed++;
    });
  };
  ChunkPreviewManager.prototype.requiredKeys = function (cx, cz) {
    var out = [], d = this.renderDistance, x, z;
    for (x = cx - d; x <= cx + d; x++) for (z = cz - d; z <= cz + d; z++) out.push(key(this.dimension, x, z));
    return out;
  };
  ChunkPreviewManager.prototype.decodeChunk = function (id) {
    if (this.cache.has(id)) return this.cache.get(id);
    var raw = this.records.get(id), result = null, self = this;
    if (!raw) return null;
    // Mesmo formato do caminho assíncrono (decodeAsync): heights/errors sempre
    // presentes para que surfaceY/renderChunk nunca quebrem no fallback síncrono.
    result = { chunkX: raw.chunkX, chunkZ: raw.chunkZ, minY: Infinity, maxY: -Infinity, blocks: [], byPos: new Map(), heights: new Map(), errors: [] };
    raw.subchunks.forEach(function (kv, subY) {
      var decoded;
      try { decoded = window.RC_builderCore.decodeSubchunk(bytes(kv.value)); } catch (e) { decoded = null; }
      if (!decoded || !decoded.primary) { result.errors.push('Subchunk Y=' + subY + ': formato não suportado'); return; }
      self.stats.decoded++;
      var storage = decoded.primary, i;
      var palette = storage.palette.map(function (p) {
        return { name: p.name, states: window.RC_BedrockBlockRendererRegistry.states(p) };
      });
      for (i = 0; i < 4096; i++) {
        var p = palette[storage.idx[i]];
        if (!p || isAir(p.name)) continue;
        var lx = (i >> 8) & 15, lz = (i >> 4) & 15, ly = i & 15;
        var x = raw.chunkX * 16 + lx, y = subY * 16 + ly, z = raw.chunkZ * 16 + lz;
        var block = { x: x, y: y, z: z, name: p.name, states: p.states, transparent: /(?:water|glass|leaves|ice|slime|torch|flower|tallgrass|vine|slab|stairs|fence|door|pane)/.test(p.name) };
        result.blocks.push(block); result.byPos.set(x + "," + y + "," + z, block);
        if (!/(?:leaves|torch|flower|tallgrass|vine|sapling|water|seagrass)/.test(p.name)) {
          var column = x + ',' + z;
          result.heights.set(column, Math.max(result.heights.has(column) ? result.heights.get(column) : -Infinity, y));
        }
        result.minY = Math.min(result.minY, y); result.maxY = Math.max(result.maxY, y);
      }
    });
    if (!result.blocks.length) return null;
    this.stats.blocks += result.blocks.length;
    this.cache.set(id, result);
    return result;
  };
  ChunkPreviewManager.prototype.updatePosition = function (position, height) {
    this.structurePosition = { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 };
    this.centerChunkX = floorDiv(this.structurePosition.x, 16);
    this.centerChunkZ = floorDiv(this.structurePosition.z, 16);
    var required = new Set(this.requiredKeys(this.centerChunkX, this.centerChunkZ)), self = this;
    this.loadedChunks.forEach(function (_, id) { if (!required.has(id)) self.loadedChunks.delete(id); });
    required.forEach(function (id) { var c = self.decodeChunk(id); if (c) self.loadedChunks.set(id, c); });
    this.stats.loaded = this.loadedChunks.size;
    return this.getRenderBlocks(this.structurePosition.y, height || 32);
  };
  ChunkPreviewManager.prototype.getBlock = function (x, y, z) {
    var c = this.loadedChunks.get(key(this.dimension, floorDiv(x, 16), floorDiv(z, 16)));
    return c ? (c.byPos.get(x + "," + y + "," + z) || null) : null;
  };
  /* Fallback síncrono: quando o Worker não existe (Chrome bloqueia Worker
     no file://), decodifica na thread principal com pausas para não travar. */
  ChunkPreviewManager.prototype.decodeSyncAsync = function (id) {
    var self = this;
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.inflight.has(id)) return this.inflight.get(id);
    var promise = new Promise(function (resolve) {
      setTimeout(function () {
        var chunk = null;
        try { chunk = self.decodeChunk(id); } catch (e) { chunk = null; }
        resolve(chunk);
      }, 0);
    }).finally(function () { self.inflight.delete(id); });
    this.inflight.set(id, promise);
    return promise;
  };
  ChunkPreviewManager.prototype.decodeAsync = function (id) {
    var self = this;
    if (this.cache.has(id)) {
      var cached = this.cache.get(id); this.cache.delete(id); this.cache.set(id, cached);
      return Promise.resolve(cached);
    }
    if (this.inflight.has(id)) return this.inflight.get(id);
    var raw = this.records.get(id);
    if (!raw) return Promise.resolve(null);
    if (this.workerFailed) return this.decodeSyncAsync(id);
    if (!this.worker) {
      var workerOk = true;
      try {
        this.worker = new Worker('bedrockChunkWorker.js?v=5');
      } catch (e) { workerOk = false; }
      if (!workerOk || !this.worker) {
        this.workerFailed = true;
        return this.decodeSyncAsync(id);
      }
      this.worker.onmessage = function (event) {
        var job = self.pending.get(event.data.id);
        if (!job) return;
        self.pending.delete(event.data.id);
        if (event.data.error) job.reject(new Error(event.data.error)); else job.resolve(event.data);
      };
      this.worker.onerror = function () {
        /* Worker morreu no meio do caminho: resolve o pendente no modo
           síncrono em vez de matar o preview inteiro. */
        try { self.worker.terminate(); } catch (e) {}
        self.worker = null; self.workerFailed = true;
        var jobs = [];
        self.pending.forEach(function (job) { jobs.push(job); });
        self.pending.clear();
        jobs.forEach(function (job) {
          self.inflight.delete(job.chunkId);
          var chunk = null;
          try { chunk = self.decodeChunk(job.chunkId); } catch (e) { chunk = null; }
          if (chunk) self.cache.set(job.chunkId, chunk);
          job.resolve({ id: 0, readyChunk: chunk });
        });
      };
    }
    var promise = new Promise(function (resolve, reject) {
      var requestId = ++self.sequence, records = [], transfers = [];
      raw.subchunks.forEach(function (kv, y) {
        // Copy before transfer: the LevelDB reader still owns the original data.
        var copy = bytes(kv.value).slice(); records.push({ y: y, bytes: copy }); transfers.push(copy.buffer);
      });
      self.pending.set(requestId, { resolve: resolve, reject: reject, chunkId: id });
      try { self.worker.postMessage({ id: requestId, records: records }, transfers); }
      catch (postError) {
        self.pending.delete(requestId);
        try { self.worker.terminate(); } catch (e2) {}
        self.worker = null; self.workerFailed = true;
        self.decodeSyncAsync(id).then(function (c) { resolve({ id: requestId, readyChunk: c }); }, reject);
      }
    }).then(function (response) {
      if (self.disposed) return null;
      /* Caminho de emergência: o chunk já veio pronto do fallback síncrono. */
      if (response && response.readyChunk !== undefined) return response.readyChunk;
      var chunk = { chunkX: raw.chunkX, chunkZ: raw.chunkZ, minY: Infinity, maxY: -Infinity, blocks: [], byPos: new Map(), heights: new Map(), errors: response.errors };
      response.sections.forEach(function (section) {
        self.stats.decoded++;
        section.layers.forEach(function (layer, layerIndex) {
          var palette = layer.palette.map(function (p) {
            p.transparent = /(?:water|glass|leaves|ice|slime|torch|flower|tallgrass|vine|slab|stairs|fence|door|pane)/.test(p.name);
            return p;
          });
          for (var i = 0; i < 4096; i++) {
            var p = palette[layer.indices[i]];
            if (!p || isAir(p.name)) continue;
            var x = raw.chunkX * 16 + (i >> 8 & 15), z = raw.chunkZ * 16 + (i >> 4 & 15), y = section.y * 16 + (i & 15);
            var b = { x: x, y: y, z: z, name: p.name, states: p.states, transparent: p.transparent, layer: layerIndex };
            chunk.blocks.push(b);
            if (!chunk.byPos.has(x + ',' + y + ',' + z)) chunk.byPos.set(x + ',' + y + ',' + z, b);
            if (!/(?:leaves|torch|flower|tallgrass|vine|sapling|water|seagrass)/.test(p.name)) {
              var column = x + ',' + z;
              chunk.heights.set(column, Math.max(chunk.heights.has(column) ? chunk.heights.get(column) : -Infinity, y));
            }
            chunk.minY = Math.min(chunk.minY, y); chunk.maxY = Math.max(chunk.maxY, y);
          }
        });
      });
      self.cache.set(id, chunk);
      return chunk;
    }).finally(function () { self.inflight.delete(id); });
    this.inflight.set(id, promise);
    return promise;
  };
  ChunkPreviewManager.prototype.trimCache = function () {
    var self = this, total = 0;
    this.cache.forEach(function (c) { total += c.blocks.length; });
    this.cache.forEach(function (c, id) {
      if ((self.cache.size > self.maxCachedChunks || total > self.maxCachedBlocks) && !self.loadedChunks.has(id)) {
        self.cache.delete(id); total -= c.blocks.length;
      }
    });
  };
  ChunkPreviewManager.prototype.updateNeighborhood = async function (position, hooks) {
    hooks = hooks || {};
    var self = this, generation = ++this.generation;
    this.structurePosition = Object.assign({}, position);
    this.centerChunkX = Math.floor(position.x / 16); this.centerChunkZ = Math.floor(position.z / 16);
    var ids = this.requiredKeys(this.centerChunkX, this.centerChunkZ);
    var required = new Set(ids);
    this.loadedChunks.forEach(function (_, id) {
      if (!required.has(id)) { self.loadedChunks.delete(id); if (hooks.remove) hooks.remove(id); }
    });
    ids.sort(function (a, b) {
      var ap = a.split(':').map(Number), bp = b.split(':').map(Number);
      return Math.abs(ap[1] - self.centerChunkX) + Math.abs(ap[2] - self.centerChunkZ) - Math.abs(bp[1] - self.centerChunkX) - Math.abs(bp[2] - self.centerChunkZ);
    });
    for (var i = 0; i < ids.length; i++) {
      if (this.disposed || generation !== this.generation) return false;
      var id = ids[i];
      if (this.loadedChunks.has(id)) continue;
      var chunk = await this.decodeAsync(id);
      if (this.disposed || generation !== this.generation) { this.trimCache(); return false; }
      if (chunk) { this.loadedChunks.set(id, chunk); if (hooks.add) hooks.add(id, chunk); }
      this.stats.loaded = this.loadedChunks.size;
      if (hooks.progress) hooks.progress(i + 1, ids.length);
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
    this.trimCache();
    return true;
  };
  ChunkPreviewManager.prototype.surfaceY = function (x, z) {
    var c = this.loadedChunks.get(key(this.dimension, Math.floor(x / 16), Math.floor(z / 16)));
    /* Uma subchunk ilegível não pode anular a chunk inteira: heights só contém
       blocos decodificados com sucesso, então dado parcial ainda vale. */
    if (!c) return null;
    var h = c.heights.get(x + ',' + z);
    return h === undefined ? null : h + 1;
  };
  ChunkPreviewManager.prototype.isVegetation = function (name) {
    if (window.RC_builderCore && window.RC_builderCore.isVegetation) return window.RC_builderCore.isVegetation(name);
    return /(_log$|_leaves$)/.test(String(name || ""));
  };
  ChunkPreviewManager.prototype.setHideVegetation = function (hide) {
    this.hideVegetation = !!hide;
    var clearCache = function (chunk) { chunk.visibleBlocks = null; };
    this.loadedChunks.forEach(clearCache);
    this.cache.forEach(clearCache);
  };
  ChunkPreviewManager.prototype.renderChunk = function (chunk) {
    if (chunk.visibleBlocks) return chunk.visibleBlocks;
    var self = this;
    var directions = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    // Chunk-local culling keeps each mesh stable when adjacent chunks stream in.
    chunk.visibleBlocks = chunk.blocks.filter(function (b) {
      if (self.hideVegetation && self.isVegetation(b.name)) return false;
      var ground = chunk.heights.get(b.x + ',' + b.z);
      if (ground !== undefined && b.y < ground - 16) return false;
      if (b.transparent) return true;
      return directions.some(function (d) {
        var other = chunk.byPos.get((b.x+d[0]) + ',' + (b.y+d[1]) + ',' + (b.z+d[2]));
        return !other || other.transparent;
      });
    });
    return chunk.visibleBlocks;
  };
  ChunkPreviewManager.prototype.dispose = function () {
    this.disposed = true; this.generation++;
    if (this.worker) this.worker.terminate();
    this.pending.forEach(function (job) { job.reject(new Error('Carregamento cancelado.')); });
    this.pending.clear(); this.cache.clear(); this.loadedChunks.clear(); this.records.clear(); this.chunkMeshes.clear();
  };
  ChunkPreviewManager.prototype.getRenderBlocks = function (anchorY, height) {
    var all = [], self = this;
    var neighbors = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    this.loadedChunks.forEach(function (chunk) {
      // Retain trunks, ground beneath foliage and exposed walls. Sampling four
      // blocks below the highest leaf used to leave trees floating in mid-air.
      var ground = new Map();
      chunk.blocks.forEach(function (b) {
        if (b.transparent) return;
        var column = b.x + ',' + b.z;
        ground.set(column, Math.max(ground.has(column) ? ground.get(column) : -Infinity, b.y));
      });
      chunk.blocks.forEach(function (b) {
        var surface = ground.get(b.x + ',' + b.z);
        if (self.mode === 'SURFACE' && surface !== undefined && b.y < Math.min(surface - 12, Number(anchorY) - 12)) return;
        for (var ni = 0; ni < neighbors.length; ni++) {
          var q = neighbors[ni], n = self.getBlock(b.x + q[0], b.y + q[1], b.z + q[2]);
          if (!n || n.transparent || b.transparent) { all.push(b); break; }
        }
      });
    });
    this.stats.visible = all.length;
    return all;
  };
  window.RC_ChunkPreviewManager = ChunkPreviewManager;
})();
