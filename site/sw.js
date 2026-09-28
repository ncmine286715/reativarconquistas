/* ReativaConquistas — Service Worker do site e do Construtor 3D.
   Páginas HTML sempre revalidam online para evitar servir conteúdo antigo.
   Recursos com ?v= podem usar cache-first; sem rede, usamos o cache local. */
var CACHE = 'rc-builder-v29';
var CORE = [
  'index.html',
  'builder-lab.html',
  'importar.html',
  'objetivos.html',
  'config.js?v=28',
  'analytics.js?v=1',
  'firebase-config.js?v=14',
  'auth.js?v=16',
  'pagamento.js?v=34',
  'entitlements.js?v=4',
  'tool-intents.js?v=1',
  'guia-site.css?v=3',
  'guia-site.js?v=8',
  'assets/null-apresenta.png',
  'assets/null-guia.png',
  'style.css?v=30',
  'mapa-2d.js?v=12',
  'app.js?v=35',
  'addon-utility.js?v=1',
  'builder-lab.css?v=7',
  'builder-lab.js?v=22',
  'java-structure.js?v=1',
  'ferramentas-local.js?v=17',
  'converter.js?v=18',
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

  var acceptsHtml = (event.request.headers.get('Accept') || '').indexOf('text/html') !== -1;
  var isDocument = event.request.mode === 'navigate' || acceptsHtml;
  var isVersioned = url.searchParams.has('v');

  function save(response) {
    if (response && response.ok) {
      var copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(function (cache) {
        return cache.put(event.request, copy);
      }));
    }
    return response;
  }

  function offlineFallback(error) {
    return caches.match(event.request, { ignoreSearch: false }).then(function (hit) {
      if (hit) return hit;
      if (isDocument && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
        return caches.match(new URL('index.html', self.registration.scope).href);
      }
      throw error;
    });
  }

  if (isDocument || !isVersioned) {
    event.respondWith(fetch(event.request).then(save).catch(offlineFallback));
    return;
  }

  event.respondWith(caches.match(event.request, { ignoreSearch: false }).then(function (hit) {
    if (hit) return hit;
    return fetch(event.request).then(save).catch(offlineFallback);
  }));
});
