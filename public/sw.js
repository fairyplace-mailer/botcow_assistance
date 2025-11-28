self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Простейший passthrough, без кэша.
// При необходимости можно добавить cache-first/ network-first стратегию.
self.addEventListener('fetch', () => {});
