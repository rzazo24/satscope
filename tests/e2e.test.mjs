// Tests de extremo a extremo: abren la página real en Chrome (sin interfaz), responden a las APIs
// con datos sintéticos y comprueban lo que vería el usuario. Si no hay Chrome, se saltan.
// Chrome se busca en CHROME_PATH o en las rutas habituales de Linux y macOS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, DEF, ROOT } from './helpers.mjs';
import { respond, fakeFetch } from './fixtures.mjs';

const CHROME = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && existsSync(p));
const skip = !CHROME || typeof WebSocket === 'undefined' ? 'no hay Chrome (o Node < 22)' : false;

const NOW = Date.now();
const wait = ms => new Promise(r => setTimeout(r, ms));
let server, base, chrome, profile, cdp;

// Cliente mínimo del protocolo de DevTools sobre WebSocket
function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map(), handlers = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const { ok, ko } = pending.get(d.id); pending.delete(d.id); d.error ? ko(new Error(d.error.message)) : ok(d.result); }
    else if (d.method) handlers.forEach(h => h(d));
  };
  return new Promise(r => { ws.onopen = () => r({
    send: (method, params = {}, sessionId) => new Promise((ok, ko) => { const i = ++id; pending.set(i, { ok, ko }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }),
    on: h => handlers.push(h),
    close: () => ws.close(),
  }); });
}

before(async () => {
  if (skip) return;
  // Servidor estático con los archivos del proyecto
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ics': 'text/calendar' };
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = fileURLToPath(new URL('.' + (path === '/' ? '/index.html' : path), ROOT));
    if (!file.startsWith(fileURLToPath(ROOT)) || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  // Chrome sin interfaz con el puerto de depuración que elija el sistema
  profile = mkdtempSync(join(tmpdir(), 'satscope-e2e-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await wait(100);
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = await connect(webSocketDebuggerUrl);
});

after(() => {
  cdp?.close(); chrome?.kill(); server?.close();
  if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch {}
});

// Abre la página en un perfil limpio. `fail`: APIs caídas. `storage`: localStorage inicial.
async function open({ fail = [], storage = {}, width = 390 } = {}) {
  const { browserContextId } = await cdp.send('Target.createBrowserContext');
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  cdp.on(async d => {
    if (d.sessionId !== sessionId) return;
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Fetch.requestPaused') {
      const { requestId, request } = d.params;
      const r = respond(request.url, NOW, { fail });
      if (!r || r.status >= 500) return s('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }).catch(() => {});
      s('Fetch.fulfillRequest', { requestId, responseCode: r.status, body: Buffer.from(r.body).toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }).catch(() => {});
    }
  });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
  await s('Fetch.enable', { patterns: ['*api.binance.com*', '*bitstamp.net*', '*alternative.me*'].map(urlPattern => ({ urlPattern })) });
  const ev = async expr => {
    const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const go = async () => {
    await s('Page.navigate', { url: base });
    for (let i = 0; i < 150; i++) { // espera a que termine de cargar los datos
      await wait(100);
      const src = await ev("document.getElementById('src')?.textContent||''").catch(() => '');
      if (src && !/Cargando|Loading|^…$/.test(src)) return;
    }
    throw new Error('la página no terminó de cargar');
  };
  // Idioma fijo (español) para no depender del idioma del Chrome de cada máquina
  storage = { lang: 'es', ...storage };
  await s('Page.navigate', { url: base + 'manifest.webmanifest' }); // mismo origen, sin ejecutar la app
  await wait(200);
  await ev(`localStorage.clear();${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})`).join(';')}`);
  await go();
  return { ev, go, errors, close: () => cdp.send('Target.disposeBrowserContext', { browserContextId }) };
}

// Lo que debería mostrar la página, calculado con el mismo código y los mismos datos
async function expected(opts) {
  const env = load({ now: NOW, fetch: fakeFetch(NOW, opts) });
  const L = await env.get('live()');
  const sc = env.get('score')(L.rows.at(-1), DEF);
  return { sc, kind: env.get('decide')(sc, DEF).kind, I18N: env.get('I18N') };
}
const PILL = { buy: 'buy', sell: 'sell', hold: 'hold' };

test('Carga con datos en directo y muestra la acción correcta', { skip }, async () => {
  const exp = await expected({});
  const p = await open();
  try {
    assert.equal(await p.ev("document.getElementById('src').textContent"), exp.I18N.es.live('Binance', 'live'));
    assert.equal(await p.ev("document.getElementById('score').innerText.replace(/\\s/g,'')"), `${Math.round(exp.sc)}/100`);
    assert.equal(await p.ev("document.getElementById('pill').textContent"), exp.I18N.es[PILL[exp.kind]]);
    assert.match(await p.ev("document.getElementById('price').textContent"), /BTC ahora a .* \$ \(≈ .* €\)/);
    assert.equal(await p.ev('document.querySelectorAll("#inds .ind").length'), 4);
    assert.match(await p.ev("document.getElementById('chart').getAttribute('aria-label')"), /104 semanas/);
    assert.ok(await p.ev("document.querySelectorAll('#btTbl tbody tr').length") >= 6, 'tabla del backtest');
    assert.equal(await p.ev('document.documentElement.scrollWidth > innerWidth'), false, 'desborde horizontal a 390 px');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Si Binance está caído, usa Bitstamp', { skip }, async () => {
  const p = await open({ fail: ['binance'] });
  try {
    assert.match(await p.ev("document.getElementById('src').textContent"), /Bitstamp \+ alternative\.me/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Si no hay ninguna API, usa la instantánea guardada', { skip }, async () => {
  const p = await open({ fail: ['binance', 'bitstamp', 'alternative.me'] });
  try {
    assert.match(await p.ev("document.getElementById('src').textContent"), /^Sin conexión a las APIs/);
    assert.match(await p.ev("document.getElementById('score').innerText"), /^\d+/);
    assert.equal(await p.ev("document.getElementById('eur').hidden"), true, 'sin tipo de cambio no se muestran euros');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Marcar la semana como hecha, ver la cartera y deshacer', { skip }, async () => {
  const exp = await expected({});
  const p = await open({ storage: { cfg: JSON.stringify({ sellAt: 101, m0: 1, m1: 1, m2: 1, m3: 1, m4: 1 }) } }); // siempre compra
  try {
    assert.equal(await p.ev("document.getElementById('pill').textContent"), exp.I18N.es.buy);
    assert.equal(await p.ev("document.getElementById('pfStats').hidden"), true);
    await p.ev("document.querySelector('[data-mark]').click()");
    assert.equal(await p.ev("document.getElementById('dUsd').value"), '10.00');
    await p.ev("document.querySelector('#doneForm button[type=submit]').click()");
    const led = JSON.parse(await p.ev("localStorage.getItem('ledger')"));
    assert.equal(led.length, 1);
    assert.equal(led[0].type, 'buy');
    assert.equal(led[0].usd, 10);
    assert.match(await p.ev("document.getElementById('done').textContent"), /✓ Hecha: compraste/);
    assert.equal(await p.ev("document.getElementById('pfStats').hidden"), false);
    assert.equal(await p.ev("document.querySelectorAll('#pfOps tbody tr').length"), 1);
    await p.ev("document.querySelector('[data-undo]').click()");
    assert.equal(JSON.parse(await p.ev("localStorage.getItem('ledger')")).length, 0);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Con BTC registrado, la venta indica la cantidad exacta', { skip }, async () => {
  const ledger = [{ id: 'a', d: '2026-01-05', type: 'buy', usd: 100, btc: 0.01, res: 0 }];
  const p = await open({ storage: { ledger: JSON.stringify(ledger), cfg: JSON.stringify({ sellAt: 0 }) } });
  try {
    assert.equal(await p.ev("document.getElementById('pill').textContent"), 'Vender');
    assert.match(await p.ev("document.getElementById('action').textContent"), /^Vende 0,000200 BTC esta semana/); // 2 % de 0,01
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Cambiar idioma y tema, y que se recuerden', { skip }, async () => {
  const p = await open();
  try {
    await p.ev("document.querySelector('#langSeg [data-lang=en]').click()");
    await p.ev("document.querySelector('#themeSeg [data-theme-opt=dark]').click()");
    assert.equal(await p.ev('document.documentElement.lang'), 'en');
    assert.match(await p.ev("document.getElementById('src').textContent"), /^Live data/);
    assert.equal(await p.ev("document.getElementById('icsBtn').getAttribute('href')"), '/reminder.ics');
    await p.go();
    assert.equal(await p.ev('document.documentElement.lang'), 'en');
    assert.equal(await p.ev('document.documentElement.dataset.theme'), 'dark');
    assert.match(await p.ev("document.getElementById('price').textContent"), /BTC now at \$/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Migra los ajustes de versiones anteriores', { skip }, async () => {
  const old = { base: 5, wF: 35, wD: 40, wW: 15, wR: 15, m0: 5, m1: 1, m2: 0, m3: 0, m4: 0, sellAt: 75, sellPct: 5 };
  const p = await open({ storage: { dcaCfg: JSON.stringify(old) } });
  try {
    assert.equal(await p.ev("document.getElementById('base').value"), '10'); // valor por defecto nuevo
    assert.equal(await p.ev("document.getElementById('sellAt').value"), '80');
    assert.equal(await p.ev("document.getElementById('wF').value"), '35');   // lo que el usuario cambió
    assert.equal(await p.ev("localStorage.getItem('dcaCfg')"), null);
    assert.deepEqual(JSON.parse(await p.ev("localStorage.getItem('cfg')")), { wF: 35 });
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  // La reserva escrita a mano en la versión anterior pasa al registro
  const q = await open({ storage: { cfg: JSON.stringify({ reserve: 40 }) } });
  try {
    const led = JSON.parse(await q.ev("localStorage.getItem('ledger')"));
    assert.equal(led.length, 1);
    assert.equal(led[0].type, 'res');
    assert.equal(led[0].usd, 40);
    assert.deepEqual(q.errors, []);
  } finally { await q.close(); }
});

test('Ayuda: bienvenida, «?» de cada sección, valores actuales y cierre', { skip }, async () => {
  const p = await open({ storage: { cfg: JSON.stringify({ base: 20 }) } });
  try {
    assert.equal(await p.ev("document.getElementById('welcome').hidden"), false, 'bienvenida en la primera visita');
    await p.ev("document.querySelector('#welcome [data-help]').click()");
    assert.equal(await p.ev("document.getElementById('help').open"), true);
    assert.equal(await p.ev("document.getElementById('welcome').hidden"), true);
    assert.equal(await p.ev("localStorage.getItem('seenHelp')"), '1');
    // Abre en la sección pedida: su título queda arriba del todo en la ventana
    await p.ev("document.getElementById('helpClose').click()");
    await p.ev("document.querySelector('.qh[data-help=cartera]').click()");
    const top = await p.ev("document.getElementById('h-cartera').getBoundingClientRect().top - document.getElementById('helpBody').getBoundingClientRect().top");
    assert.ok(top >= 0 && top < 40, `la sección no queda arriba (${top})`);
    // Valores con los ajustes actuales (base 20 → tramo 0–20 = 100 $) y se actualizan al cambiarlos
    assert.equal(await p.ev("document.querySelector('#helpBody [data-v=\"amt:0\"]').textContent"), '100,00 $');
    assert.equal(await p.ev("document.querySelector('#helpBody [data-v=\"amt:4\"]').textContent"), 'Vender');
    await p.ev("(()=>{const b=document.getElementById('base');b.value='10';b.dispatchEvent(new Event('input'))})()");
    assert.equal(await p.ev("document.querySelector('#helpBody [data-v=\"amt:0\"]').textContent"), '50,00 $');
    // El «?» dentro de los ajustes no abre ni cierra el desplegable
    await p.ev("document.getElementById('helpClose').click()");
    await p.ev("document.querySelector('.qh[data-help=ajustes]').click()");
    assert.equal(await p.ev("document.querySelector('details:has(#base)').open"), false);
    // En inglés, la ayuda también cambia
    await p.ev("document.getElementById('helpClose').click()");
    await p.ev("document.querySelector('#langSeg [data-lang=en]').click()");
    await p.ev("document.querySelector('[data-help=\"\"]').click()");
    assert.equal(await p.ev("document.querySelector('#helpBody h3').textContent"), 'What SatScope is');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  // En la siguiente visita ya no sale la bienvenida
  const q = await open({ storage: { seenHelp: '1' } });
  try { assert.equal(await q.ev("document.getElementById('welcome').hidden"), true); } finally { await q.close(); }
});

test('El recuadro de foco solo se ve con el teclado, no tras tocar o hacer clic', { skip }, async () => {
  const p = await open({ storage: { seenHelp: '1' } });
  const outline = sel => p.ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).outlineStyle`);
  try {
    // Tras un toque, aunque el navegador marque el elemento como :focus-visible (como hace Safari en iPhone)
    await p.ev("document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await p.ev("document.querySelector('details:has(#base) summary').focus({focusVisible:true})");
    assert.equal(await outline('details:has(#base) summary'), 'none');
    await p.ev("document.querySelector('.qh[data-help=cartera]').focus({focusVisible:true})");
    assert.equal(await outline('.qh[data-help=cartera]'), 'none');
    // Con Tab se ve
    await p.ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))");
    await p.ev("document.querySelector('details:has(#base) summary').focus({focusVisible:true})");
    assert.equal(await outline('details:has(#base) summary'), 'solid');
    // Los campos de texto lo conservan aunque se toquen
    await p.ev("document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
    await p.ev("document.querySelector('details:has(#base)').open=true;document.getElementById('base').focus()");
    assert.equal(await outline('#base'), 'solid');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Restablecer la estrategia a los valores por defecto y deshacerlo', { skip }, async () => {
  const p = await open({ storage: { seenHelp: '1', cfg: JSON.stringify({ base: 25, sellAt: 90, wF: 50 }), lang: 'es', theme: 'dark' } });
  const val = id => p.ev(`document.getElementById('${id}').value`);
  try {
    assert.equal(await val('base'), '25');
    assert.equal(await p.ev("document.getElementById('resetBtn').disabled"), false);
    await p.ev("document.getElementById('resetBtn').click()");
    assert.equal(await val('base'), String(DEF.base));
    assert.equal(await val('sellAt'), String(DEF.sellAt));
    assert.equal(await val('wF'), String(DEF.wF));
    assert.equal(await p.ev("localStorage.getItem('cfg')"), '{}');
    assert.equal(await p.ev("document.getElementById('resetBtn').disabled"), true, 'ya está todo por defecto');
    assert.match(await p.ev("document.getElementById('resetMsg').textContent"), /Ajustes restablecidos/);
    const exp = await expected({}); // acción con los valores por defecto y los mismos datos
    assert.equal(await p.ev("document.getElementById('pill').textContent"), exp.I18N.es[PILL[exp.kind]], 'la acción se recalcula');
    // No toca el idioma ni el tema
    assert.equal(await p.ev("localStorage.getItem('lang')"), 'es');
    assert.equal(await p.ev("localStorage.getItem('theme')"), 'dark');
    // Deshacer devuelve los ajustes anteriores
    await p.ev("document.getElementById('resetUndo').click()");
    assert.equal(await val('base'), '25');
    assert.deepEqual(JSON.parse(await p.ev("localStorage.getItem('cfg')")), { base: 25, sellAt: 90, wF: 50 });
    assert.equal(await p.ev("document.getElementById('resetMsg').textContent"), '');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

