// 1. 修改版本号 (每次发布新功能，最好改一下这个数字，比如 v1 -> v2)
const CACHE_NAME = 'bitledger-v2.1';

const urlsToCache = [
  './',
  './index.html',
  './transparent-logo.png',
  './transparent-logosmall.png',
  './manifest.json'
];

// 安装：缓存核心文件
self.addEventListener('install', event => {
  // 跳过等待，立即激活新的 Service Worker
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 立即接管所有页面
  return self.clients.claim();
});

// 获取：网络优先策略 (Network First)
// 逻辑：先尝试联网下载 -> 如果成功，显示新页面并更新缓存 -> 如果没网，才用旧缓存
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 如果网络请求成功，克隆一份存入缓存，以备下次离线使用
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });
        return response;
      })
      .catch(() => {
        // 如果没网，才去读缓存
        return caches.match(event.request);
      })
  );
});
