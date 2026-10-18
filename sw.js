const CACHE_NAME = 'kuai-chinese-v23';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=23',
  './app.js?v=23',
  './manifest.json',
  './icon-192.png?v=23',
  './icon-512.png?v=23',
  './icon.svg?v=23',
  './apple-touch-icon.png?v=23'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Translation and audio requests go straight to the network, untouched
  if (event.request.url.includes('translate.googleapis.com') ||
      event.request.url.includes('translate.google.com') ||
      event.request.url.includes('api.github.com') ||
      event.request.url.includes('gist.githubusercontent.com') ||
      event.request.method !== 'GET') {
    return;
  }

  // Network-first for CDN libraries, cache-first for app shell
  if (event.request.url.includes('cdn.jsdelivr.net') ||
      event.request.url.includes('unpkg.com')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
