/**
 * Service Worker for Alexis TV PWA
 * Enables offline shell, installability, and fast asset loading
 */

const CACHE_NAME = 'alexis-tv-cache-v6';
const SHELL_ASSETS = [
  '/tv',
  '/tv.webmanifest',
  '/tv-icon.svg',
  '/tv-icon-192.png',
  '/tv-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch((err) => {
        console.warn('SW pre-cache error:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not intercept or cache live video streams, m3u8 chunks, ts segments or api requests
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.m3u') ||
    url.searchParams.has('ts') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Network-first with cache fallback for HTML and app shell
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/tv');
          }
          return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
