/* Worldify — Service Worker do site e do Construtor 3D.
   Páginas HTML sempre revalidam online para evitar servir conteúdo antigo.
   Recursos com ?v= podem usar cache-first; sem rede, usamos o cache local. */
var CACHE = 'worldify-20261003-v4';
var CORE = ['index.html', 'importar.html', 'style.css?v=29', 'focus.css?v=20260929c', 'compatibility.js?v=20260929c', 'focus.js?v=20260929c', 'assets/worldify-mark.svg', 'worldify-editor.js?v=20260930v', 'worldify-glass.css?v=20260930v', 'mc/item/grass_block.png', 'worldify-shell.css?v=20260930v', 'worldify-shell.js?v=20260930v'];
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
  if (url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;

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
