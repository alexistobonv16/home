const CACHE_NAME = 'alexis-radio-v21';
const STATIC_ASSETS = [
  '/',
  '/radio.css',
  '/radio.js',
  '/manifest.webmanifest',
  '/radio-icon-192.png',
  '/radio-icon-512.png',
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&family=Outfit:wght@600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[Radio SW] Error caching assets:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          // Solo purga cachés VIEJAS de ESTA app: borrar las de la otra PWA
          // (TV) rompía su uso offline y viceversa.
          if (key.startsWith('alexis-radio-') && key !== CACHE_NAME) {
            console.log('[Radio SW] Deleting legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept or cache live audio streams or API proxy
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/stream') || event.request.destination === 'audio') {
    return;
  }

  const isNav = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');
  const fetchReq = isNav ? new Request(event.request, { cache: 'no-cache' }) : event.request;

  // Network-First for HTML, JS and CSS to ensure instant updates
  event.respondWith(
    fetch(fetchReq)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/').then(res => res || caches.match('/radio.html'));
          }
        });
      })
  );
});
