/* ReativaConquistas — Service Worker mínimo do Construtor 3D (beta).
   Deixa o app instalável e acelera a segunda visita com cache local.
   Versões com ?v= são chaves distintas: atualizar o ?v= atualiza o app. */
var CACHE = 'rc-builder-v1';
var CORE = [
  'builder-lab.html',
  'builder-lab.css?v=4',
  'vendor/jszip.min.js',
  'vendor/leveldb-reader.js',
  'vendor/three.min.js',
  'vendor/OrbitControls.js',
  'vendor/TransformControls.js',
  'nbt-bedrock.js',
  'leveldb-write.js',
  'db-common.js',
  'builder-config.js',
  'builder-transform.js',
  'builder-placement.js',
  'builder-core.js?v=2',
  'bedrock-block-renderer-registry.js?v=3',
  'chunk-preview-manager.js?v=8',
  'bedrockChunkWorker.js'
];
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(event.request, { ignoreSearch: false }).then(function (hit) {
    return hit || fetch(event.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(event.request, copy); });
      return res;
    });
  }));
});
