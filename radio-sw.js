const CACHE_NAME = 'alexis-radio-v1';
const STATIC_ASSETS = [
  '/radio.html',
  '/radio.css',
  '/radio.js',
  '/radio.webmanifest',
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Radio SW] Error caching initial assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME && key.startsWith('alexis-radio-')).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache live audio streams or the proxy endpoint
  if (url.pathname.startsWith('/api/radio-proxy') || url.pathname.includes('/stream') || event.request.destination === 'audio') {
    return;
  }

  // Network first for HTML, Cache first for static assets
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/radio.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((res) => {
        if (res.ok && event.request.method === 'GET') {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return res;
      });
    }).catch(() => {
      // Offline fallback
    })
  );
});
