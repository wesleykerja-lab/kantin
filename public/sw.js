// Service Worker Kantin Kita POS v2
const CACHE_NAME = 'kantin-pos-v2';

self.addEventListener('install', (e) => {
  // Langsung aktif tanpa menunggu
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Bersihkan semua cache lama secara agresif
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  
  // Semua request API, socket, dan dokumen HTML selalu WAJIB ambil dari Network (fresh)
  if (
    url.includes('/api/') ||
    url.includes('/socket.io/') ||
    e.request.mode === 'navigate' ||
    url.endsWith('.html') ||
    url.endsWith('/')
  ) {
    return; // Pass through langsung ke network, jangan pernah tahan di cache
  }

  // Aset statis lainnya: ambil dari network dulu, fallback ke cache jika offline
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Simpan cache aset jika sukses
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, responseToCache));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
