/* eslint-disable no-restricted-globals */

const CACHE_VERSION = 'botcow-sw-v1';
const STATIC_CACHE = `${CACHE_VERSION}:static`;

// Keep this list short and stable. Next.js build assets are hashed and can change often,
// so we mainly cache stable public assets and the app shell route.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('botcow-sw-') && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

function isCacheableStatic(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  // Same-origin only
  if (url.origin !== self.location.origin) return false;

  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Cache-first for stable static assets.
  if (isCacheableStatic(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        if (res.ok) {
          await cache.put(request, res.clone());
        }
        return res;
      })(),
    );
    return;
  }

  // Network-first for navigations; fall back to cached app shell ('/').
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const cachedShell = await cache.match('/');
          return cachedShell || new Response('Offline', { status: 503 });
        }
      })(),
    );
  }
});
