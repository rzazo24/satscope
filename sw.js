// Service worker de SatScope: permite instalar la app y abrirla sin conexión.
// Al cambiar archivos de la app, sube VERSION para que se renueve la caché.
const VERSION = 'v1';
const CACHE = `satscope-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('satscope-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // APIs de datos (Binance, alternative.me) y analítica: siempre a la red.
  // Si fallan, la propia página usa la instantánea integrada.
  if (url.origin === location.origin && url.pathname.startsWith('/_vercel/')) return;

  // Página: primero la red (para tener siempre la última versión), si no hay conexión, la caché.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('/', copy)); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Archivos propios y fuentes de Google: la caché primero y se actualiza en segundo plano.
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin === location.origin || fonts) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(req);
        const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
