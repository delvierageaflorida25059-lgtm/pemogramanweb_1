/**
 * Service Worker untuk PWA.
 *
 * STRATEGI CACHE
 *   - Aset statis (CSS, JS, ikon): cache-first, lalu perbarui di belakang.
 *     Aset jarang berubah sehingga aman dipakai dari cache.
 *   - Navigasi halaman HTML: network-first dengan fallback ke cache.
 *     Selalu mencoba dapat versi terbaru.
 *   - Panggilan /api: TIDAK PERNAH di-cache.
 *
 * PENTING
 * Operasi kritis seperti pembayaran, perubahan stok, dan POS tetap membutuhkan
 * koneksi aktif. Service worker sengaja tidak menutupi request API supaya
 * tidak pernah menampilkan data basi yang seolah-olah valid.
 */

const VERSION = 'v1';
const STATIC_CACHE = `sr-static-${VERSION}`;
const PAGE_CACHE = `sr-pages-${VERSION}`;

// Aset yang boleh di-cache saat instalasi.
const STATIC_ASSETS = [
  '/css/style.css',
  '/js/api.js',
  '/js/ui.js',
  '/js/store.js',
  '/js/socket.js',
  '/js/qr.js',
  '/manifest.json',
  '/index.html',
  '/menu.html',
  '/login.html',
  '/order.html',
];

// Halaman yang boleh dipakai sebagai fallback saat offline.
const OFFLINE_PAGES = ['/index.html', '/menu.html'];

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      // addAll gagal seluruhnya bila satu aset 404, jadi dipakai Promise.allSettled
      // supaya satu aset bermasalah tidak membatalkan instalasi.
      .then((cache) =>
        Promise.allSettled(STATIC_ASSETS.map((asset) => cache.add(asset)))
      )
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  const activeCaches = [STATIC_CACHE, PAGE_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !activeCaches.includes(key))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Hanya tangani GET. POST/PUT/DELETE harus selalu sampai ke server.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Abaikan domain lain (mis. CDN Socket.IO).
  if (url.origin !== self.location.origin) return;

  // Request API TIDAK pernah di-cache. Ini yang mencegah kasir melihat
  // data pembayaran lama saat koneksi putus.
  if (url.pathname.startsWith('/api/')) return;

  // Socket.IO harus lewat jaringan.
  if (url.pathname.startsWith('/socket.io/')) return;

  // Navigasi halaman: network-first dengan fallback offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;

          // Fallback terakhir: halaman menu pratinjau.
          for (const page of OFFLINE_PAGES) {
            const fallback = await caches.match(page);
            if (fallback) return fallback;
          }

          return new Response(
            '<h1>Offline</h1><p>Aplikasi tidak dapat menjangkau server.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // Aset statis: cache-first, perbarui di belakang.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

// ---------------------------------------------------------------------------
// Pesan dari halaman
// ---------------------------------------------------------------------------

// Minta halaman melakukan refresh ketika ada versi baru.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
