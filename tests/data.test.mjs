// Tests de la carga de datos en directo (live): fuentes, respaldos, semanas cerradas y cálculos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';
import { fakeFetch, price, fng } from './fixtures.mjs';

const NOW = Date.UTC(2026, 10, 9, 12); // lunes 9 de noviembre de 2026, 12:00 UTC
const DAY = 864e5;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);

async function liveWith(opts = {}, now = NOW) {
  const f = fakeFetch(now, opts);
  const env = load({ now, fetch: f });
  const L = await env.get('live()');
  return { L, calls: f.calls, env };
}

test('Binance: 3 páginas de 1000 velas y Fear & Greed en directo', async () => {
  const { L, calls } = await liveWith();
  assert.equal(L.src, 'Binance');
  assert.equal(L.fng, 'live');
  const k = calls.filter(u => u.includes('/klines'));
  assert.equal(k.length, 3);
  const ends = k.map(u => +new URL(u).searchParams.get('endTime'));
  assert.ok(ends[0] > ends[1] && ends[1] > ends[2], 'cada página pide velas más antiguas');
  assert.ok(calls.some(u => u.includes('api.alternative.me/fng/?limit=0')), 'pide el histórico completo de Fear & Greed');
});

test('Solo semanas cerradas: cierres de domingo y sin la vela de hoy', async () => {
  const { L } = await liveWith();
  for (const r of L.rows) assert.equal(new Date(r.t).getUTCDay(), 0, `${r.t} no es domingo`);
  assert.equal(L.rows.at(-1).t, '2026-11-08'); // último domingo cerrado
  assert.equal(L.rows.at(-1).p, price(Date.UTC(2026, 10, 8)));
  assert.equal(L.now, price(Date.UTC(2026, 10, 9))); // el precio actual sí es el de la vela abierta
});

test('Un domingo en curso no cuenta hasta que cierra', async () => {
  const sunday = Date.UTC(2026, 10, 15, 18); // domingo 15, a las 18:00 UTC
  const { L } = await liveWith({}, sunday);
  assert.equal(L.rows.at(-1).t, '2026-11-08');
  const after = await liveWith({}, Date.UTC(2026, 10, 16, 0, 5)); // lunes 16, 00:05 UTC
  assert.equal(after.L.rows.at(-1).t, '2026-11-15');
});

test('Indicadores de la última semana: MA200, caída, RSI y Fear & Greed', async () => {
  const { L, env } = await liveWith();
  const sundays = [];
  for (let t = Date.UTC(2015, 0, 4); t <= Date.UTC(2026, 10, 8); t += 7 * DAY) sundays.push(t);
  // Binance solo da 3000 días: el histórico que ve la app empieza ahí
  const first = Math.floor(NOW / DAY) * DAY - 2999 * DAY;
  const seen = sundays.filter(t => t >= first).map(price);
  const r = L.rows.at(-1);
  const ma = seen.slice(-200).reduce((a, b) => a + b, 0) / 200;
  near(r.w200, r.p / ma, 1e-9);
  let ath = 0;
  for (let t = first; t <= Date.UTC(2026, 10, 8); t += DAY) ath = Math.max(ath, price(t));
  near(r.dd, (1 - r.p / ath) * 100, 1e-9);
  near(r.rsi, env.get('wilder')(seen).at(-1), 1e-9);
  assert.equal(r.fng, fng(Date.UTC(2026, 10, 8)));
  // Hacen falta 200 semanas para la MA: la primera fila es la semana 200 del histórico
  assert.equal(L.rows.length, seen.length - 199);
});

test('Si Binance falla, se usa Bitstamp con el mismo resultado', async () => {
  const a = await liveWith();
  const b = await liveWith({ fail: ['binance'] });
  assert.equal(b.L.src, 'Bitstamp');
  assert.ok(b.calls.filter(u => u.includes('bitstamp.net/api/v2/ohlc')).length === 3);
  assert.equal(JSON.stringify(b.L.rows.map(r => r.t)), JSON.stringify(a.L.rows.map(r => r.t)));
  b.L.rows.forEach((r, i) => near(r.w200, a.L.rows[i].w200, 1e-9));
});

test('Si Binance devuelve muy pocas velas, también se pasa a Bitstamp', async () => {
  const f = fakeFetch(NOW);
  const short = async url => {
    if (url.includes('/klines')) return { ok: true, status: 200, json: async () => [] };
    return f(url);
  };
  const env = load({ now: NOW, fetch: short });
  assert.equal((await env.get('live()')).src, 'Bitstamp');
});

test('Si fallan Binance y Bitstamp, live() falla (y la página usa la instantánea)', async () => {
  const env = load({ now: NOW, fetch: fakeFetch(NOW, { fail: ['binance', 'bitstamp'] }) });
  await assert.rejects(env.get('live()'));
});

test('Si falla Fear & Greed, se toma de la instantánea', async () => {
  const { L, env } = await liveWith({ fail: ['alternative.me'] });
  assert.equal(L.src, 'Binance');
  assert.equal(L.fng, 'snap');
  // La instantánea tiene el lunes 9; para el domingo 8 se usa el valor guardado más cercano
  const snap = env.get('SNAP').find(r => r.t === '2026-11-09');
  assert.equal(L.rows.at(-1).fng, snap.fng);
});

test('Si falla Fear & Greed y la instantánea no cubre la semana, se calcula sin él', async () => {
  const later = Date.UTC(2027, 2, 1, 12); // marzo de 2027, después de la instantánea
  const { L } = await liveWith({ fail: ['alternative.me'] }, later);
  assert.equal(L.fng, 'none');
  assert.equal(L.rows.at(-1).fng, null);
});
