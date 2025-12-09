const CACHE_NAME = 'bitledger-v1';
const urlsToCache = [
  './',
  './index.html',
  './transparent-logo.png',
  './transparent-logosmall.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});