// 1. 修改版本号 (版本号升级，确保浏览器重新缓存新文件)
const CACHE_NAME = 'bitledger-v2.8-amount-ui';

// 2. 将所有用到的外部 CDN 链接全部加入缓存列表
const urlsToCache = [
  './',
  './index.html',
  './transparent-logo.png',
  './transparent-logosmall.png',
  './manifest.json',
  // --- 外部资源 (必须缓存，否则离线时样式和功能会挂) ---
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  // --- Firebase SDK (必须与 html 中的版本一致) ---
  'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js'
];

// 安装：缓存核心文件
self.addEventListener('install', event => {
  // 跳过等待，立即激活
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache, adding all URLs...');
        // 使用 addAll 可能会因为某些 CDN 跨域问题报错，改为单个添加容错更好，或者直接 addAll
        // 这里为了保证完整性，使用 addAll。如果某个资源下载失败，Service Worker 安装会失败。
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.error('Cache addAll failed:', err);
      })
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

// 获取：网络优先策略 (Network First, falling back to cache)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 1. 如果联网成功，克隆一份存入缓存（更新缓存）
        if (!response || response.status !== 200 || response.type !== 'basic' && response.type !== 'cors' && response.type !== 'opaque') {
          return response;
        }
        
        // 只缓存 GET 请求
        if (event.request.method === 'GET') {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                try {
                    cache.put(event.request, responseToCache);
                } catch (e) {
                    // 忽略某些无法缓存的请求错误
                }
              });
        }
        
        return response;
      })
      .catch(() => {
        // 2. 如果没网，去读缓存
        return caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                // 如果缓存里也没有（比如从未访问过的图片），可以在这里返回一个默认占位图，或者啥也不返回
                // 对于 API 请求，可能会失败，这里不做特殊处理，前端代码需要处理 fetch 失败的情况
            });
      })
  );
});
