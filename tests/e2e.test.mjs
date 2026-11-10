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
  // Chrome escribe el puerto en DevToolsActivePort al arrancar; en GitHub Actions puede tardar varios segundos
  let port, exited = false;
  chrome.on('exit', () => { exited = true; });
  for (let i = 0; i < 300 && !port && !exited; i++) {
    await wait(100);
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim() || undefined; } catch {}
  }
  if (!port) throw new Error(exited ? 'Chrome se cerró al arrancar' : 'Chrome no arrancó en 30 s');
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  cdp = await connect(webSocketDebuggerUrl);
});

after(() => {
  cdp?.close(); chrome?.kill(); server?.close();
  if (profile) try { rmSync(profile, { recursive: true, force: true }); } catch {}
});

// Abre la página en un perfil limpio. `fail`: APIs caídas. `storage`: localStorage inicial.
async function open({ fail = [], storage = {}, width = 390, wbtc = null } = {}) {
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
      if (/publicnode|1rpc|drpc/.test(request.url)) { // nodos de Polygon: saldo de WBTC simulado
        if (wbtc == null) return s('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }).catch(() => {});
        if (request.method === 'OPTIONS') // preflight de CORS, como responden los nodos reales
          return s('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: 'content-type' }] }).catch(() => {});
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + BigInt(Math.round(wbtc * 1e8)).toString(16).padStart(64, '0') });
        return s('Fetch.fulfillRequest', { requestId, responseCode: 200, body: Buffer.from(body).toString('base64'),
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }).catch(() => {});
      }
      const r = respond(request.url, NOW, { fail });
      if (!r || r.status >= 500) return s('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }).catch(() => {});
      s('Fetch.fulfillRequest', { requestId, responseCode: r.status, body: Buffer.from(r.body).toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }] }).catch(() => {});
    }
  });
  await s('Runtime.enable');
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: true });
  await s('Fetch.enable', { patterns: ['*api.binance.com*', '*bitstamp.net*', '*alternative.me*', '*publicnode.com*', '*1rpc.io*', '*drpc.org*'].map(urlPattern => ({ urlPattern })) });
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
    // Deshacer pide confirmación: el primer toque no borra nada
    await p.ev("document.querySelector('[data-undo-ask]').click()");
    assert.equal(JSON.parse(await p.ev("localStorage.getItem('ledger')")).length, 1, 'un solo toque no debe borrar');
    assert.match(await p.ev("document.getElementById('done').textContent"), /¿Borrar esta operación del registro\?/);
    assert.equal(await p.ev("document.activeElement.hasAttribute('data-undo-no')"), true, 'el foco va a «Cancelar»');
    // Cancelar vuelve al estado anterior sin borrar
    await p.ev("document.querySelector('[data-undo-no]').click()");
    assert.match(await p.ev("document.getElementById('done').textContent"), /✓ Hecha: compraste/);
    assert.equal(JSON.parse(await p.ev("localStorage.getItem('ledger')")).length, 1);
    // Deshacer y confirmar sí borra
    await p.ev("document.querySelector('[data-undo-ask]').click()");
    await p.ev("document.querySelector('[data-undo-yes]').click()");
    assert.equal(JSON.parse(await p.ev("localStorage.getItem('ledger')")).length, 0);
    assert.ok(await p.ev("!!document.querySelector('[data-mark]')"), 'vuelve a «Marcar como hecha»');
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

test('WBTC en Polygon: textos con WBTC, saldo de la wallet y comparación con el registro', { skip }, async () => {
  const addr = '0xAbCdEf0123456789aBcDeF0123456789ABCDEF01';
  const ledger = [{ id: 'a', d: '2026-11-09', type: 'buy', usd: 10, btc: 0.0001335, res: 0 }];
  const waitMsg = async (p, re) => { for (let i = 0; i < 50; i++) { const m = await p.ev("document.getElementById('walletMsg').textContent"); if (re.test(m)) return m; await wait(100); } return p.ev("document.getElementById('walletMsg').textContent"); };
  // Coincide con el registro
  const p = await open({ wbtc: 0.0001335, storage: { seenHelp: '1', unit: 'WBTC', wallet: addr, ledger: JSON.stringify(ledger) } });
  try {
    assert.equal(await p.ev("document.getElementById('unit').value"), 'WBTC');
    assert.equal(await p.ev("document.getElementById('walletBox').hidden"), false);
    assert.match(await waitMsg(p, /Coincide/), /En tu wallet: 0,00013350 WBTC\. Coincide con el registro\./);
    assert.equal(await p.ev("document.querySelector('#pfStats .stat .n').textContent"), 'WBTC');
    assert.equal(await p.ev("document.querySelector('#pfOps thead th:nth-child(4)').textContent"), 'WBTC');
    // Venta: con el saldo de la wallet y en WBTC
    await p.ev("(()=>{const s=document.getElementById('sellAt');s.value='0';s.dispatchEvent(new Event('input'))})()");
    assert.match(await p.ev("document.getElementById('action').textContent"), /^Vende 0,000003 WBTC esta semana/); // 2 % de 0,0001335
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
  // No coincide: avisa de la diferencia y vende según la wallet
  const q = await open({ wbtc: 0.0005, storage: { seenHelp: '1', unit: 'WBTC', wallet: addr, ledger: JSON.stringify(ledger), cfg: JSON.stringify({ sellAt: 0 }) } });
  try {
    assert.match(await waitMsg(q, /diferencia/), /en el registro: 0,00013350 \(diferencia: \+0,00036650\)/);
    assert.match(await q.ev("document.getElementById('action').textContent"), /^Vende 0,000010 WBTC/); // 2 % de 0,0005
    assert.deepEqual(q.errors, []);
  } finally { await q.close(); }
});

test('WBTC: dirección inválida, nodos caídos y vuelta a BTC', { skip }, async () => {
  const p = await open({ wbtc: null, storage: { seenHelp: '1', cfg: JSON.stringify({ sellAt: 0 }),
    ledger: JSON.stringify([{ id: 'a', d: '2026-11-09', type: 'buy', usd: 10, btc: 0.01, res: 0 }]) } });
  const msg = () => p.ev("document.getElementById('walletMsg').textContent");
  try {
    // Por defecto: BTC y sin campo de dirección
    assert.equal(await p.ev("document.getElementById('walletBox').hidden"), true);
    assert.match(await p.ev("document.getElementById('action').textContent"), /^Vende 0,000200 BTC/);
    // Cambiar a WBTC
    await p.ev("(()=>{const u=document.getElementById('unit');u.value='WBTC';u.dispatchEvent(new Event('change'))})()");
    assert.equal(await p.ev("document.getElementById('walletBox').hidden"), false);
    assert.match(await p.ev("document.getElementById('action').textContent"), /^Vende 0,000200 WBTC/);
    // Dirección inválida
    await p.ev("(()=>{const w=document.getElementById('wallet');w.value='0x123';w.dispatchEvent(new Event('input'))})()");
    await wait(800);
    assert.match(await msg(), /debe empezar por 0x/);
    // Dirección válida pero ningún nodo responde: usa el registro
    await p.ev("(()=>{const w=document.getElementById('wallet');w.value='0xAbCdEf0123456789aBcDeF0123456789ABCDEF01';w.dispatchEvent(new Event('input'))})()");
    for (let i = 0; i < 50 && !/No se ha podido/.test(await msg()); i++) await wait(100);
    assert.match(await msg(), /No se ha podido leer tu saldo/);
    assert.match(await p.ev("document.getElementById('action').textContent"), /^Vende 0,000200 WBTC/);
    assert.equal(await p.ev("localStorage.getItem('wallet')"), '0xAbCdEf0123456789aBcDeF0123456789ABCDEF01');
    // Volver a BTC: se oculta la dirección y el aviso
    await p.ev("(()=>{const u=document.getElementById('unit');u.value='BTC';u.dispatchEvent(new Event('change'))})()");
    assert.equal(await p.ev("document.getElementById('walletBox').hidden"), true);
    assert.equal(await p.ev("document.getElementById('walletMsg').hidden"), true);
    assert.match(await p.ev("document.getElementById('action').textContent"), /^Vende 0,000200 BTC/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Los botones de la cartera tienen la misma altura (también el enlace del recordatorio)', { skip }, async () => {
  for (const width of [390, 800]) {
    const p = await open({ width, storage: { seenHelp: '1' } });
    try {
      const h = await p.ev("[...document.querySelectorAll('#icsBtn,#expBtn,#impBtn')].map(b=>Math.round(b.getBoundingClientRect().height))");
      assert.equal(new Set(h).size, 1, `alturas distintas a ${width} px: ${h}`);
      assert.equal(await p.ev("getComputedStyle(document.getElementById('icsBtn')).textDecorationLine"), 'none');
    } finally { await p.close(); }
  }
});

test('Los campos de los formularios tienen el mismo ancho y alto (también la fecha)', { skip }, async () => {
  const p = await open({ width: 390, storage: { seenHelp: '1', unit: 'WBTC' } });
  try {
    await p.ev("document.querySelector('details.add').open=true;document.querySelector('details:has(#base)').open=true");
    const box = sel => p.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>{const r=e.getBoundingClientRect(),c=e.closest('label').getBoundingClientRect();return [e.id,Math.round(r.width),Math.round(r.height),Math.round(c.width)]})`);
    // Formulario «Añadir operación a mano» (una columna a 390 px): todos iguales y dentro de su columna
    const add = await box('#addForm input,#addForm select');
    assert.equal(new Set(add.map(x => x[1])).size, 1, `anchos distintos: ${JSON.stringify(add)}`);
    assert.equal(new Set(add.map(x => x[2])).size, 1, `altos distintos: ${JSON.stringify(add)}`);
    for (const [id, w, , col] of add) assert.ok(w <= col, `${id} se sale de su columna (${w} > ${col})`);
    assert.equal(await p.ev("getComputedStyle(document.getElementById('mDate')).textAlign"), 'left');
    // Ajustes: números, desplegable y dirección con la misma altura; 16 px para que iPhone no haga zoom
    const cfgBoxes = await box('details:has(#base) input:not([type=checkbox]),details:has(#base) select');
    assert.equal(new Set(cfgBoxes.map(x => x[2])).size, 1, `altos distintos: ${JSON.stringify(cfgBoxes)}`);
    assert.equal(await p.ev("getComputedStyle(document.getElementById('base')).fontSize"), '16px');
    assert.equal(await p.ev('document.documentElement.scrollWidth > innerWidth'), false);
  } finally { await p.close(); }
});

test('Nada marcado como oculto se ve (p. ej. el selector de archivo de «Importar CSV»)', { skip }, async () => {
  const p = await open({ width: 390, storage: { seenHelp: '1' } });
  try {
    await p.ev("document.querySelectorAll('details').forEach(d=>d.open=true)");
    const shown = await p.ev("[...document.querySelectorAll('[hidden]')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.id||e.tagName)");
    assert.deepEqual(shown, []);
    assert.equal(await p.ev("document.getElementById('impFile').getBoundingClientRect().height"), 0);
  } finally { await p.close(); }
});

// Diferencia de valor esperada en el backtest, desde el primer año, con los mismos datos que la página
async function expectedBt(cfg = DEF) {
  const env = load({ now: NOW, fetch: fakeFetch(NOW) });
  const rows = (await env.get('live()')).rows, SNAP = env.get('SNAP');
  const HIST = [...SNAP.filter(r => r.t < rows[0].t), ...rows];
  const from = HIST[0].t.slice(0, 4) + '-01-01';
  const { S, E } = env.get('backtest')(HIST.filter(r => r.t >= from), cfg);
  return { ...env.get('btCompare')({ val: Math.round(S.val) }, { val: Math.round(E.val) }), S, E };
}
const num = (v, loc) => v.toLocaleString(loc, { maximumFractionDigits: 0, minimumFractionDigits: 0, useGrouping: 'always' });

test('Backtest: el dato principal compara con un DCA fijo con el mismo dinero (ES y EN)', { skip }, async () => {
  const { diff: d, S, E } = await expectedBt();
  const p = await open({ storage: { seenHelp: '1' } });
  const txt = id => p.ev(`document.getElementById('${id}').textContent`);
  try {
    assert.equal(await txt('btDiffV'), (d > 0 ? '+' : '') + num(Math.abs(d), 'es-ES') + '\u202f$');
    assert.equal(await txt('btDiffT'), (d > 0 ? 'más' : d < 0 ? 'menos' : 'igual') + ' que un DCA fijo con el mismo dinero');
    const sub = await txt('btDiffSub');
    assert.ok(sub.startsWith(`Precio medio de compra: ${num(S.avg, 'es-ES')} $ con tu estrategia frente a ${num(E.avg, 'es-ES')} $ con el DCA equivalente.`), sub);
    assert.ok(sub.includes(`DCA equivalente: tus ${num(S.inv, 'es-ES')} $ repartidos a partes iguales,`), sub);
    assert.ok(sub.endsWith(`durante ${num(E.weeks, 'es-ES')} semanas.`), sub);
    // En la tabla, «Valor hoy» va primero y la rentabilidad, al final y como dato secundario
    const rows = await p.ev("[...document.querySelectorAll('#btTbl tbody tr')].map(r=>[r.querySelector('th').textContent,r.className])");
    assert.equal(rows[0][0], 'Valor hoy');
    assert.deepEqual(rows.at(-1), ['Rentabilidad', 'sec']);
    // En inglés
    await p.ev("document.querySelector('#langSeg [data-lang=en]').click()");
    assert.equal(await txt('btDiffV'), (d > 0 ? '+$' : '$') + num(Math.abs(d), 'en-US'));
    assert.equal(await txt('btDiffT'), (d > 0 ? 'more than' : d < 0 ? 'less than' : 'the same as') + ' fixed DCA with the same money');
    assert.match(await txt('btDiffSub'), /^Average buy price: \$[\d,]+ with your strategy vs \$[\d,]+ with the equivalent DCA\. Equivalent DCA: your \$[\d,]+ split equally, \$[\d.,]+ a week for [\d,]+ weeks\.$/);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Backtest: si la estrategia vale menos que un DCA con el mismo dinero, lo dice sin signo «+»', { skip }, async () => {
  const cfg = { m0: 0, m1: 0, m2: 0, m3: 0, m4: 5, sellAt: 101 }; // solo compra en euforia (caro) y nunca vende
  const { diff } = await expectedBt({ ...DEF, ...cfg });
  assert.ok(diff < 0);
  const p = await open({ storage: { seenHelp: '1', cfg: JSON.stringify(cfg) } });
  try {
    assert.equal(await p.ev("document.getElementById('btDiffV').textContent"), num(-diff, 'es-ES') + '\u202f$');
    assert.equal(await p.ev("document.getElementById('btDiffV').className"), 'down');
    assert.equal(await p.ev("document.getElementById('btDiffT').textContent"), 'menos que un DCA fijo con el mismo dinero');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Backtest a 390 px: las cifras de la tabla no se parten en dos líneas', { skip }, async () => {
  const p = await open({ width: 390, storage: { seenHelp: '1' } });
  try {
    // Se mide el alto del texto de cada celda (no de la celda, que crece si la etiqueta de la fila ocupa dos líneas)
    const lines = await p.ev(`[...document.querySelectorAll('#btTbl tbody td')].filter(td=>{
      const r=document.createRange();r.selectNodeContents(td);
      return r.getBoundingClientRect().height>parseFloat(getComputedStyle(td).fontSize)*1.9;
    }).map(td=>td.textContent)`);
    assert.deepEqual(lines, [], `cifras partidas en dos líneas: ${lines}`);
    assert.equal(await p.ev('document.documentElement.scrollWidth > innerWidth'), false);
  } finally { await p.close(); }
});

test('Backtest: la cifra principal es siempre valor de la estrategia (el de la tabla) − valor del DCA equivalente', { skip }, async () => {
  const p = await open({ storage: { seenHelp: '1' } });
  try {
    assert.equal(await p.ev("document.getElementById('btSum').getAttribute('role')"), null, 'el resumen no debe ser una región «status» que se anuncie en cada cambio');
    const bad = await p.ev(`(()=>{
      const out=[],sel=document.getElementById('btFrom'),parse=s=>+s.replace(/[^0-9]/g,'');
      for(const base of [10,7,13.3]){
        const b=document.getElementById('base');b.value=base;b.dispatchEvent(new Event('input'));
        for(const y of [...sel.options].map(o=>o.value)){
          sel.value=y;sel.dispatchEvent(new Event('change'));
          const v=document.getElementById('btDiffV'),td=document.querySelector('#btTbl tbody tr').querySelectorAll('td');
          const {S,E}=backtest(HIST.filter(r=>r.t>=y+'-01-01'),cfg());
          const shown=parse(v.textContent)*(v.className==='down'?-1:1),expected=parse(td[0].textContent)-Math.round(E.val);
          if(parse(td[0].textContent)!==Math.round(S.val))out.push('tabla '+td[0].textContent+' ≠ '+S.val);
          if(shown!==expected)out.push('base '+base+' desde '+y+': '+shown+' ≠ '+expected);
        }
      }
      return out;
    })()`);
    assert.deepEqual(bad, []);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Formato de números: separador de miles también con 4 cifras en español', { skip }, async () => {
  const p = await open({ storage: { seenHelp: '1' } });
  try {
    // Casos fijos, sin depender de los datos: fmt(valor, decimales) y usd(valor, decimales)
    const es = await p.ev("[fmt(9243),fmt(3570),fmt(999),fmt(1234567),fmt(1234.5,2),fmt(0.0001335,8),fmt(-1160),usd(9243),usd(3570,2)]");
    assert.deepEqual(es, ['9.243', '3.570', '999', '1.234.567', '1.234,50', '0,00013350', '-1.160', '9.243 $', '3.570,00 $']);
    // En la página: la tabla del backtest usa el separador en las cifras de 4 dígitos
    const cells = await p.ev("[...document.querySelectorAll('#btTbl tbody td')].map(td=>td.textContent).filter(s=>/^\\d[\\d.]* \\$$/.test(s))");
    assert.ok(cells.length > 0);
    for (const c of cells) assert.match(c, /^\d{1,3}(\.\d{3})* \$$/, `sin separador: ${c}`);
    await p.ev("document.querySelector('#langSeg [data-lang=en]').click()");
    assert.deepEqual(await p.ev("[fmt(9243),fmt(999),fmt(1234.5,2),usd(9243)]"), ['9,243', '999', '1,234.50', '$9,243']);
  } finally { await p.close(); }
});

test('El CSV guarda los números sin formato aunque la app muestre separadores de miles', { skip }, async () => {
  const ledger = [{ id: 'a', d: '2026-01-05', type: 'buy', usd: 3570, btc: 0.0451, res: 0 }, { id: 'b', d: '2026-02-02', type: 'sell', usd: 1234.56, btc: 0.01, res: 0 }];
  const p = await open({ storage: { seenHelp: '1', ledger: JSON.stringify(ledger) } });
  try {
    assert.match(await p.ev("document.getElementById('pfOps').textContent"), /3\.570,00/); // en pantalla, con separador
    const csv = await p.ev('toCSV(LEDGER)');
    assert.equal(csv, 'date,type,usd,btc,from_reserve\n2026-01-05,buy,3570,0.0451,0\n2026-02-02,sell,1234.56,0.01,0\n');
    const back = await p.ev(`parseCSV(${JSON.stringify(csv)}).map(o=>[o.usd,o.btc])`);
    assert.deepEqual(back, [[3570, 0.0451], [1234.56, 0.01]]);
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Backtest: la cifra grande queda separada del texto que la sigue', { skip }, async () => {
  const p = await open({ width: 390, storage: { seenHelp: '1' } });
  try {
    // Hueco entre el final de la cifra («… $») y el inicio de «más que…», en la misma línea
    const gap = await p.ev(`(()=>{
      const v=document.getElementById('btDiffV').getBoundingClientRect();
      const r=document.createRange();r.selectNodeContents(document.getElementById('btDiffT'));
      const first=r.getClientRects()[0];
      return Math.round(first.left-v.right);
    })()`);
    assert.ok(gap >= 10, `hueco de ${gap} px`);
  } finally { await p.close(); }
});

