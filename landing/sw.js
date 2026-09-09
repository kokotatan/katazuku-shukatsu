// katazuku Service Worker(最小構成)
// 役割: (1) PWAインストール可能要件を満たす (2) Web Push受信と通知表示
// キャッシュはランディングのシェルのみ。/api/ と各アプリの正本データには一切触らない(spec16)
const SHELL_CACHE = 'katazuku-shell-v5-details'
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icons/necktie-192.png', '/icons/necktie-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// ネットワーク優先、落ちたときだけシェルキャッシュ。/api/ はSWを素通し(キャッシュ禁止)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return
  if (!SHELL_URLS.includes(url.pathname)) return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(url.pathname, { ignoreSearch: true })),
  )
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const title = data.title || 'katazuku'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/necktie-192.png',
      data: { url: data.url || '/insight/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(target); return client.focus() }
      }
      return self.clients.openWindow(target)
    }),
  )
})
