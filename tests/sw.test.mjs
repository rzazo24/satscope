// Tests del service worker: qué se sirve y qué se guarda en la caché.
// Se ejecuta sw.js en un contexto aislado con `self`, `caches` y `fetch` simulados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://satscope-seven.vercel.app';

function setup({ cached = [], status = 200 } = {}) {
  const handlers = {}, stores = new Map(), matchOpts = [], network = [];
  const keyOf = k => typeof k === 'string' ? new URL(k, ORIGIN).href : k.url;
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (k, opts) => { matchOpts.push(opts); return m.get(keyOf(k)); },
      put: async (k, res) => { m.set(keyOf(k), res); },
      addAll: async reqs => { for (const r of reqs) m.set(keyOf(r), { body: 'instalado ' + r.url, init: r.init }); },
    };
  };
  const ctx = vm.createContext({
    URL, Promise, Set,
    location: { origin: ORIGIN },
    Request: class { constructor(u, init) { this.url = new URL(u, ORIGIN).href; this.init = init; } },
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: {
      open: async name => cacheFor(name),
      keys: async () => [...stores.keys()],
      delete: async name => stores.delete(name),
    },
    fetch: async req => {
      network.push(req.url);
      return { ok: status >= 200 && status < 300, status, body: 'red ' + req.url, clone() { return { ...this }; } };
    },
  });
  vm.runInContext(CODE, ctx);
  const CACHE = vm.runInContext('CACHE', ctx), SHELL = vm.runInContext('SHELL', ctx);
  for (const p of cached) cacheFor(CACHE).put(p, { body: 'caché ' + p });
  // Lanza un evento fetch; devuelve la respuesta del service worker o null si no intercepta
  const request = async (path, { method = 'GET', mode = 'no-cors' } = {}) => {
    let p = null;
    handlers.fetch({ request: { url: new URL(path, ORIGIN).href, method, mode }, respondWith: x => { p = x; } });
    return p ? await p : null;
  };
  const stored = () => [...(stores.get(CACHE) || new Map()).keys()].map(k => k.replace(ORIGIN, ''));
  return { handlers, stores, matchOpts, network, CACHE, SHELL, request, stored };
}

test('Un archivo de SHELL se sirve de la caché sin ir a la red', async () => {
  const sw = setup({ cached: ['/icons/icon.svg'] });
  const res = await sw.request('/icons/icon.svg');
  assert.equal(res.body, 'caché /icons/icon.svg');
  assert.deepEqual(sw.network, []);
});

test('Un archivo de SHELL que falta se pide a la red y se guarda con su ruta exacta', async () => {
  const sw = setup();
  const res = await sw.request('/fonts/ibm-plex-sans.woff2');
  assert.equal(res.body, 'red ' + ORIGIN + '/fonts/ibm-plex-sans.woff2');
  assert.deepEqual(sw.stored(), ['/fonts/ibm-plex-sans.woff2']);
});

test('Una respuesta de error de un archivo de SHELL se entrega pero no se guarda', async () => {
  const sw = setup({ status: 503 });
  const res = await sw.request('/favicon.ico');
  assert.equal(res.status, 503);
  assert.deepEqual(sw.stored(), []);
});

test('/sw.js nunca pasa por la caché', async () => {
  const sw = setup({ cached: ['/sw.js'] });
  assert.equal(await sw.request('/sw.js'), null, 'no se intercepta');
  assert.equal(await sw.request('/sw.js?v=2'), null);
  assert.deepEqual(sw.stored(), ['/sw.js'], 'no se añade nada (la entrada previa es del montaje del test)');
});

test('Las peticiones con parámetros no se interceptan ni se guardan, aunque la ruta esté en SHELL', async () => {
  const sw = setup({ cached: ['/icons/icon.svg'] });
  for (const p of ['/icons/icon.svg?v=2', '/manifest.webmanifest?x=1', '/fonts/ibm-plex-sans.woff2?nc=123'])
    assert.equal(await sw.request(p), null, p);
  assert.deepEqual(sw.stored(), ['/icons/icon.svg']);
});

test('Lo que no está en SHELL va a la red y no se guarda', async () => {
  const sw = setup();
  for (const p of ['/og.png', '/recordatorio.ics', '/_vercel/insights/script.js', '/fonts/OFL.txt', '/index.html'])
    assert.equal(await sw.request(p), null, p);
  assert.deepEqual(sw.stored(), []);
});

test('Otros dominios y métodos distintos de GET no se interceptan', async () => {
  const sw = setup();
  assert.equal(await sw.request('https://api.binance.com/api/v3/klines?symbol=BTCUSDT'), null);
  assert.equal(await sw.request('https://polygon-bor-rpc.publicnode.com/'), null);
  assert.equal(await sw.request('/favicon.ico', { method: 'POST' }), null);
  assert.deepEqual(sw.stored(), []);
});

test('Navegar a la portada (con o sin parámetros) abre la app guardada', async () => {
  const sw = setup({ cached: ['/'] });
  assert.equal((await sw.request('/', { mode: 'navigate' })).body, 'caché /');
  assert.equal((await sw.request('/?utm_source=x', { mode: 'navigate' })).body, 'caché /');
  assert.deepEqual(sw.network, []);
});

test('Navegar a otro archivo (el recordatorio, la imagen) va a la red y no abre la app', async () => {
  const sw = setup({ cached: ['/'] });
  assert.equal(await sw.request('/recordatorio.ics', { mode: 'navigate' }), null);
  assert.equal(await sw.request('/og.png', { mode: 'navigate' }), null);
});

test('Nunca se busca en la caché con ignoreSearch', async () => {
  const sw = setup({ cached: ['/', '/favicon.ico'] });
  for (const p of ['/favicon.ico', '/favicon.ico?x=1', '/icons/icon-192.png', '/og.png?x=1']) await sw.request(p);
  await sw.request('/?a=1', { mode: 'navigate' });
  assert.ok(sw.matchOpts.length > 0);
  for (const o of sw.matchOpts) assert.ok(!o || !o.ignoreSearch, `match con ${JSON.stringify(o)}`);
});

test('Instalación: guarda todo SHELL sin pasar por la caché HTTP; activación: borra versiones antiguas', async () => {
  const sw = setup();
  let wait;
  sw.handlers.install({ waitUntil: p => { wait = p; } });
  await wait;
  assert.deepEqual(sw.stored().sort(), [...sw.SHELL].sort());
  for (const v of sw.stores.get(sw.CACHE).values()) assert.equal(v.init.cache, 'reload');
  // Una caché de una versión anterior de SatScope y otra ajena
  sw.stores.set('satscope-viejo', new Map()); sw.stores.set('otra-app', new Map());
  sw.handlers.activate({ waitUntil: p => { wait = p; } });
  await wait;
  assert.deepEqual([...sw.stores.keys()].sort(), ['otra-app', sw.CACHE].sort());
});
