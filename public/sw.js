const CACHE_NAME = 'botcow-cache-v1';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/',
  OFFLINE_URL,
  '/favicon.ico',
  '/manifest.json',
  '/sw.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Стратегия для fetch:
// - Для запросов к API (с путями с /api/*) — Network First с fallback из кеша
// - Для статических ресурсов — Cache First
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.method !== 'GET') {
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => caches.match(request).then((resp) => resp || caches.match(OFFLINE_URL)))
      );
      return;
    }

    event.respondWith(
      caches.match(request).then((cachedResp) => cachedResp || fetch(request).catch(() => caches.match(OFFLINE_URL)))
    );
  }
});
