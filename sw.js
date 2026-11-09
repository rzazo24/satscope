// Service worker de SatScope: permite instalar la app, abrirla sin conexión
// y avisar cuando hay una nueva versión.
// __BUILD__ lo sustituye Vercel en cada despliegue por el commit (ver vercel.json),
// así cada despliegue genera un service worker nuevo y la página puede avisar.
const VERSION = '__BUILD__';
const CACHE = `satscope-${VERSION}`;
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  // Descarga la versión nueva sin pasar por la caché HTTP. No se activa sola:
  // espera a que el usuario pulse «Actualizar» (mensaje SKIP_WAITING).
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
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

  // APIs de datos (Binance, alternative.me) y analítica: siempre a la red, sin caché.
  // Si fallan, la propia página usa la instantánea integrada.
  if (url.origin === location.origin && url.pathname.startsWith('/_vercel/')) return;

  // Página: la versión guardada de este service worker (abre al instante y sin conexión).
  // Las versiones nuevas llegan con un service worker nuevo y la página avisa.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(c => c.match('/')).then(hit => hit || fetch(req))
    );
    return;
  }

  // Archivos propios y fuentes de Google: la caché primero y, si no está, la red.
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin === location.origin || fonts) {
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })
    );
  }
});
