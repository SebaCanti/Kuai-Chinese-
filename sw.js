const CACHE_NAME = 'kuai-chinese-v32';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=32',
  './app.js?v=32',
  './manifest.json',
  './icon-192.png?v=32',
  './icon-512.png?v=32',
  './icon.svg?v=32',
  './apple-touch-icon.png?v=32'
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
    ).then(() => self.clients.claim())
  );
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

  // Network-first for CDN libraries
  if (event.request.url.includes('cdn.jsdelivr.net') ||
      event.request.url.includes('unpkg.com')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for the HTML shell so phones pick up new versions
  // instead of staying stuck on an old cached index.html forever.
  const accept = event.request.headers.get('accept') || '';
  const isHtml = event.request.mode === 'navigate' || accept.includes('text/html');
  if (isHtml) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for versioned CSS/JS/icons (cache name + ?v= bump on each release)
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
