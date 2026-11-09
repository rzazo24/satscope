// Tests de la lógica de SatScope. Se ejecutan con: node --test
// Cargan el código directamente de index.html (entre la instantánea y el estado de la página),
// así se prueba exactamente lo que se publica, sin duplicar funciones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('// Instantánea semanal'));
const code = script.slice(script.indexOf('// Instantánea semanal'), script.indexOf('let ROWS=null'));
const ctx = vm.createContext({ clamp: v => Math.max(0, Math.min(100, v)), Math, Date, Map, Number, isFinite });
const { wilder, parts, score, backtest, SNAP, SNAP_START, SNAP_END } =
  vm.runInContext(code + ';({wilder,parts,score,backtest,SNAP,SNAP_START,SNAP_END})', ctx);

const DEF = { base: 10, wF: 30, wD: 40, wW: 15, wR: 15, m0: 5, m1: 1, m2: 0, m3: 0, m4: 0, sellAt: 80, sellPct: 2, reuseBelow: 20 };
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

test('RSI de Wilder: coincide con el ejemplo de referencia de StockCharts', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    46.00, 46.03, 46.41, 46.22, 45.64];
  const r = wilder(closes);
  assert.equal(r[13], null); // hacen falta 14 variaciones
  // Valores exactos (calculados aparte sin redondear las medias intermedias)
  [70.46, 66.25, 66.48, 69.35, 66.29, 57.92].forEach((v, i) => near(r[14 + i], v));
  // Valores publicados por StockCharts, que redondea las medias intermedias en su hoja: ±0,1
  [70.53, 66.32, 66.55, 69.41, 66.36, 57.97].forEach((v, i) => near(r[14 + i], v, 0.1));
});

test('RSI de Wilder: casos límite', () => {
  assert.equal(wilder([1, 2, 3]).every(v => v === null), true); // muy pocos datos
  assert.equal(wilder(Array.from({ length: 20 }, (_, i) => i + 1)).at(-1), 100); // solo subidas
  assert.equal(wilder(Array.from({ length: 20 }, (_, i) => 20 - i)).at(-1), 0); // solo bajadas
});

test('Indicadores: escalas de caída y de precio/MA200', () => {
  const p = r => parts({ fng: 50, rsi: 50, ...r });
  assert.equal(p({ dd: 0, w200: 1 }).d, 100);
  assert.equal(p({ dd: 80, w200: 1 }).d, 0);
  assert.equal(p({ dd: 95, w200: 1 }).d, 0); // por debajo de −80 % se queda en 0
  near(p({ dd: 40, w200: 1 }).d, 50);
  assert.equal(p({ dd: 0, w200: 1 }).w, 0);
  near(p({ dd: 0, w200: 5 }).w, 100);
  near(p({ dd: 0, w200: Math.sqrt(5) }).w, 50); // escala logarítmica
  assert.equal(p({ dd: 0, w200: 0.5 }).w, 0); // por debajo de la media se queda en 0
});

test('Puntuación: media ponderada y renormalización si falta Fear & Greed', () => {
  // f=20, d=50, w=0, r=60 → (20·30 + 50·40 + 0·15 + 60·15) / 100 = 35
  near(score({ fng: 20, dd: 40, w200: 1, rsi: 60 }, DEF), 35);
  // Sin Fear & Greed: (50·40 + 0·15 + 60·15) / 70
  near(score({ fng: null, dd: 40, w200: 1, rsi: 60 }, DEF), 2900 / 70);
  // Un peso a 0 no cuenta
  near(score({ fng: 20, dd: 40, w200: 1, rsi: 60 }, { ...DEF, wF: 0 }), 2900 / 70);
});

test('Backtest: DCA fijo y compras por tramos', () => {
  // Puntuaciones controladas: fng=rsi=s, dd y w200 con peso 0
  const c = { ...DEF, wD: 0, wW: 0 };
  const row = (s, p) => ({ t: '2020-01-01', p, fng: s, rsi: s, dd: 0, w200: 1 });
  const { S, D } = backtest([row(10, 100), row(30, 200), row(50, 100)], c);
  assert.equal(D.inv, 30); near(D.btc, 0.1 + 0.05 + 0.1, 1e-12);
  assert.equal(S.inv, 60); // ×5 (50 $) + ×1 (10 $) + 0
  near(S.btc, 50 / 100 + 10 / 200, 1e-12);
  near(S.avg, 60 / 0.55, 1e-9);
});

test('Backtest: venta parcial y reutilización de la reserva en miedo extremo', () => {
  const c = { ...DEF, wD: 0, wW: 0 };
  const row = (s, p) => ({ t: '2020-01-01', p, fng: s, rsi: s, dd: 0, w200: 1 });
  // Compra 50 $ a 100 (0,5 BTC) → vende el 2 % a 1000 (0,01 BTC = 10 $) → miedo: compra 50 $ + 10 $ de reserva a 100
  const { S } = backtest([row(10, 100), row(90, 1000), row(10, 100)], c);
  assert.equal(S.inv, 100); // la reserva no es dinero nuevo
  near(S.cash, 0, 1e-9);
  near(S.btc, 0.5 - 0.01 + 0.6, 1e-12);
  // Con el umbral de reserva a 0 la reserva se queda en efectivo
  const b = backtest([row(10, 100), row(90, 1000), row(10, 100)], { ...c, reuseBelow: 0 });
  near(b.S.cash, 10, 1e-9); near(b.S.btc, 0.5 - 0.01 + 0.5, 1e-12);
});

test('Instantánea: semanas consecutivas y datos completos', () => {
  assert.equal(SNAP[0].t, SNAP_START);
  assert.equal(SNAP.at(-1).t, SNAP_END);
  for (let i = 1; i < SNAP.length - 1; i++) assert.equal(Date.parse(SNAP[i].t) - Date.parse(SNAP[i - 1].t), 7 * 864e5, `semana ${i}`);
  for (const r of SNAP) {
    assert.ok(r.p > 0 && r.w200 > 0 && r.dd >= 0 && r.dd <= 100, r.t);
    assert.ok(r.rsi >= 0 && r.rsi <= 100, r.t);
    assert.ok(score(r, DEF) >= 0 && score(r, DEF) <= 100, r.t);
  }
});

test('Backtest: la comparación destaca la diferencia de valor, no la rentabilidad', () => {
  const { btCompare } = vm.runInContext('({btCompare})', ctx);
  const S = { val: 30178, inv: 3570, ret: 745.3 }, D = { val: 20935, inv: 4580, ret: 357.1 };
  const r = btCompare(S, D);
  assert.equal(r.diff, 9243);  // dato principal: +9.243 $ más que el DCA fijo
  assert.equal(r.inv, -1010);  // con 1010 $ menos invertidos
  assert.equal(btCompare(D, S).diff, -9243);
});
