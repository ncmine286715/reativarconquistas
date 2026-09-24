/* ReativaConquistas — Service Worker mínimo do Construtor 3D (beta).
   Deixa o app instalável e acelera a segunda visita com cache local.
   Versões com ?v= são chaves distintas: atualizar o ?v= atualiza o app. */
var CACHE = 'rc-builder-v13';
var CORE = [
  'index.html',
  'importar.html',
  'objetivos.html',
  'config.js?v=26',
  'firebase-config.js?v=13',
  'auth.js?v=15',
  'pagamento.js?v=28',
  'entitlements.js?v=3',
  'tool-intents.js?v=1',
  'guia-site.css?v=1',
  'guia-site.js?v=3',
  'assets/null-apresenta.png',
  'assets/null-guia.png',
  'style.css?v=17',
  'mapa-2d.js?v=9',
  'backups-local.js?v=2',
  'app.js?v=28',
  'ferramentas-local.js?v=15',
  'logo.png',
  'mc/item/ender_eye.png',
  'mc/item/oak_door.png',
  'mc/item/iron_pickaxe.png',
  'mc/item/shears.png',
  'mc/item/armor_stand.png',
  'mc/item/cow_spawn_egg.png',
  'mc/item/iron_hoe.png',
  'mc/item/filled_map.png',
  'mc/item/grass_block.png',
  'mc/block/bedrock.png',
  'vendor/jszip.min.js',
  'vendor/leveldb-reader.js',
  'nbt-bedrock.js',
  'leveldb-write.js',
  'db-common.js?v=8',
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
