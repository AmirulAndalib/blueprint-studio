const APP_VERSION = '{{VERSION}}';
const CACHE_PREFIX = 'blueprint-studio-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
        .map((cacheName) => caches.delete(cacheName)),
    );

    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => {
      client.postMessage({ type: 'VERSION_UPDATE', version: APP_VERSION });
    });
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/blueprint_studio/')) return;

  // Blueprint Studio depends on its Home Assistant backend, so always use the
  // current network response and never populate Cache Storage or HTTP cache.
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
