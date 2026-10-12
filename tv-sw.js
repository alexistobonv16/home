/**
 * Service Worker for Alexis TV PWA
 * Enables offline shell, installability, and fast asset loading
 */

const CACHE_NAME = 'alexis-tv-cache-v15';
const SHELL_ASSETS = [
  '/',
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
      // Solo purga cachés VIEJAS de ESTA app: borrar las de la otra PWA
      // (radio) rompía su uso offline y viceversa.
      return Promise.all(
        keys
          .filter((key) => key.startsWith('alexis-tv-cache-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
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

  const isNav = event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html');
  const fetchReq = isNav ? new Request(event.request, { cache: 'no-cache' }) : event.request;

  // Network-first with cache fallback for HTML and app shell
  event.respondWith(
    fetch(fetchReq)
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
            return caches.match('/').then(res => res || caches.match('/tv.html') || caches.match('/tv'));
          }
          return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
