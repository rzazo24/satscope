// Tests del registro de operaciones, la acción semanal, el CSV y la migración de ajustes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, DEF } from './helpers.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const json = v => JSON.parse(JSON.stringify(v)); // copia fuera del contexto aislado para comparar

test('Resumen de cartera: BTC, reserva, dinero aportado y precio medio', () => {
  const env = load();
  env.run(`LEDGER=[
    {id:'1',d:'2026-01-05',type:'buy',usd:50,btc:0.001,res:0},
    {id:'2',d:'2026-03-02',type:'sell',usd:30,btc:0.0003,res:0},
    {id:'3',d:'2026-06-01',type:'buy',usd:20,btc:0.0004,res:10},
    {id:'4',d:'2026-07-01',type:'res',usd:5,btc:0,res:0}]`);
  const s = env.get('ledgerStats()');
  near(s.btc, 0.001 - 0.0003 + 0.0004);
  near(s.reserve, 30 - 10 + 5);        // ventas − reserva usada + ajustes
  near(s.invested, 50 + 20 - 10 + 5);  // la reserva usada no es dinero nuevo
  near(s.avg, 70 / 0.0014);            // precio medio de todas las compras
});

test('Resumen de cartera: vacío y sin BTC negativo', () => {
  const env = load();
  assert.deepEqual(json(env.get('ledgerStats()')), { btc: 0, reserve: 0, invested: 0, avg: null });
  env.run(`LEDGER=[{id:'1',d:'2026-01-05',type:'sell',usd:10,btc:0.5,res:0}]`);
  assert.equal(env.get('ledgerStats()').btc, 0);
});

test('Acción de la semana por tramos', () => {
  const env = load(), decide = env.get('decide');
  // Multiplicadores y aportación por defecto: los del HTML (DEF), no valores fijos
  assert.deepEqual(json(decide(10, DEF)), { kind: 'buy', mult: DEF.m0, usd: DEF.base * DEF.m0 });
  assert.deepEqual(json(decide(25, DEF)), { kind: 'buy', mult: DEF.m1, usd: DEF.base * DEF.m1 });
  assert.equal(decide(45, DEF).kind, 'hold');
  assert.equal(decide(79.9, DEF).kind, 'hold');
  assert.equal(decide(80, DEF).kind, 'sell');
  assert.equal(decide(100, DEF).kind, 'sell');
  assert.equal(decide(null, DEF).kind, 'none');
  assert.equal(decide(100, { ...DEF, sellAt: 101, m4: 2 }).kind, 'buy'); // 100 cae en el tramo 80–100
});

test('Semana de una operación: de lunes a domingo tras el cierre', () => {
  const env = load(), inWeek = env.get('inWeek');
  assert.equal(inWeek('2026-11-08', '2026-11-08'), false); // el domingo del cierre es de la semana anterior
  assert.equal(inWeek('2026-11-09', '2026-11-08'), true);
  assert.equal(inWeek('2026-11-15', '2026-11-08'), true);
  assert.equal(inWeek('2026-11-16', '2026-11-08'), false);
  env.run("SRC='snap'"); // con la instantánea, la fecha es la del propio lunes
  assert.equal(inWeek('2026-11-09', '2026-11-09'), true);
  assert.equal(inWeek('2026-11-16', '2026-11-09'), false);
});

test('Semanas saltadas: solo cuentan semanas cerradas con compra o venta sin apuntar', () => {
  const env = load();
  // Puntuaciones controladas: Fear & Greed y RSI iguales a la puntuación, el resto sin peso
  env.run(`ROWS=[['2026-10-11',10],['2026-10-18',50],['2026-10-25',30],['2026-11-01',90],['2026-11-08',10]]
    .map(([t,s])=>({t,p:1,fng:s,rsi:s,dd:0,w200:1}))`);
  const c = { ...DEF, wD: 0, wW: 0 };
  env.run(`LEDGER=[{id:'1',d:'2026-10-13',type:'buy',usd:50,btc:0.001,res:0}]`);
  // 11-oct compra (hecha) · 18-oct esperar · 25-oct compra (saltada) · 1-nov venta (saltada) · 8-nov es la semana en curso
  assert.equal(env.get('skipped')(c), 2);
  env.run(`LEDGER.push({id:'2',d:'2026-10-27',type:'buy',usd:10,btc:0.001,res:0})`);
  assert.equal(env.get('skipped')(c), 1);
  env.run(`LEDGER=[{id:'r',d:'2026-10-01',type:'res',usd:5,btc:0,res:0}]`); // los ajustes de reserva no cuentan
  assert.equal(env.get('skipped')(c), 0);
});

test('Validación de operaciones', () => {
  const okOp = load().get('okOp');
  assert.ok(okOp({ d: '2026-01-05', type: 'buy', usd: 10, btc: 0.001, res: 0 }));
  assert.ok(!okOp({ d: '05/01/2026', type: 'buy', usd: 10, btc: 0.001, res: 0 }));
  assert.ok(!okOp({ d: '2026-01-05', type: 'regalo', usd: 10, btc: 0.001, res: 0 }));
  assert.ok(!okOp({ d: '2026-01-05', type: 'buy', usd: NaN, btc: 0.001, res: 0 }));
  assert.ok(!okOp(null));
});

test('El registro guardado se carga y se limpia al arrancar', () => {
  const env = load({ storage: { ledger: JSON.stringify([
    { id: 'a', d: '2026-01-05', type: 'buy', usd: '10', btc: '0.001' },      // números como texto y sin res
    { id: 'b', d: 'mal', type: 'buy', usd: 10, btc: 0.001, res: 0 },         // fecha inválida: se descarta
  ]) } });
  assert.deepEqual(json(env.get('LEDGER')), [{ id: 'a', d: '2026-01-05', type: 'buy', usd: 10, btc: 0.001, res: 0 }]);
  assert.deepEqual(json(load({ storage: { ledger: '{roto' } }).get('LEDGER')), []);
});

test('Guardar el registro lo ordena por fecha y lo persiste', () => {
  const env = load();
  env.run(`LEDGER=[{id:'2',d:'2026-03-01',type:'buy',usd:1,btc:1,res:0},{id:'1',d:'2026-01-01',type:'buy',usd:1,btc:1,res:0}];saveLedger()`);
  assert.deepEqual(JSON.parse(env.store.ledger).map(o => o.id), ['1', '2']);
});

test('CSV: exportar e importar conserva las operaciones', () => {
  const env = load();
  const ops = [
    { id: '1', d: '2026-01-05', type: 'buy', usd: 50, btc: 0.00061234, res: 0 },
    { id: '2', d: '2026-03-02', type: 'sell', usd: 30.5, btc: 0.0003, res: 0 },
    { id: '3', d: '2026-06-01', type: 'buy', usd: 20, btc: 0.0004, res: 10 },
    { id: '4', d: '2026-07-01', type: 'res', usd: -5, btc: 0, res: 0 },
  ];
  const csv = env.get('toCSV')(ops);
  assert.equal(csv.split('\n')[0], 'date,type,usd,btc,from_reserve');
  const back = json(env.get('parseCSV')(csv)).map(({ id, ...o }) => o);
  assert.deepEqual(back, ops.map(({ id, ...o }) => o));
  assert.equal(env.get('parseCSV')(csv.replace(/\n/g, '\r\n') + '\n\n').length, 4); // finales de línea de Windows y líneas vacías
});

test('CSV: rechaza archivos que no son de SatScope o con filas inválidas', () => {
  const parse = load().get('parseCSV');
  assert.throws(() => parse('fecha,importe\n2026-01-01,10'));
  assert.throws(() => parse('date,type,usd,btc,from_reserve\n2026-01-01,regalo,10,0.1,0'));
  assert.throws(() => parse('date,type,usd,btc,from_reserve\n2026-13,buy,10,0.1,0'));
  assert.equal(parse('date,type,usd,btc,from_reserve\n').length, 0);
});

test('Importar no duplica operaciones ya registradas', () => {
  const merge = load().get('mergeOps');
  const a = { id: '1', d: '2026-01-05', type: 'buy', usd: 50, btc: 0.001, res: 0 };
  const b = { id: '2', d: '2026-01-12', type: 'buy', usd: 10, btc: 0.0002, res: 0 };
  const r = merge([a], [{ ...a, id: 'x' }, b, { ...b, id: 'y' }]);
  assert.equal(r.added, 1);
  assert.deepEqual(json(r.list).map(o => o.id), ['1', '2']);
});

test('Migración de ajustes antiguos: solo se conserva lo que el usuario cambió', () => {
  const env = load(), migrate = env.get('migrateCfg'), ids = Object.keys(DEF);
  const old = { base: 5, wF: 35, wD: 40, wW: 15, wR: 15, m0: 5, m1: 1, m2: 0, m3: 0, m4: 0, sellAt: 75, sellPct: 5 };
  assert.deepEqual(json(migrate(old, ids)), { wF: 35 });
  assert.deepEqual(json(migrate({ base: '7', sellAt: 90 }, ids)), { base: 7, sellAt: 90 });
  assert.deepEqual(json(migrate({}, ids)), {});
});
