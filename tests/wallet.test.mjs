// Tests de la lectura del saldo de WBTC en Polygon (sin red: nodos simulados).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const ADDR = '0xAbCdEf0123456789aBcDeF0123456789ABCDEF01';
const rpcOk = hex => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: hex }) });

test('Direcciones válidas e inválidas', () => {
  const isAddr = load().get('isAddr');
  assert.ok(isAddr(ADDR));
  assert.ok(isAddr(ADDR.toLowerCase()));
  for (const a of ['', '0x123', ADDR.slice(2), ADDR + '0', '0xZZcdef0123456789abcdef0123456789abcdef01', ' ' + ADDR]) assert.ok(!isAddr(a), a);
});

test('Llamada a balanceOf y conversión de unidades (8 decimales)', () => {
  const env = load();
  assert.equal(env.get('balanceOfData')(ADDR), '0x70a08231' + '0'.repeat(24) + ADDR.slice(2).toLowerCase());
  const fromUnits = env.get('fromUnits');
  assert.equal(fromUnits('0x3426'), 0.0001335);        // 13 350 satoshis
  assert.equal(fromUnits('0x' + '0'.repeat(64)), 0);
  assert.equal(fromUnits('0x'), 0);
  assert.equal(fromUnits('0x5f5e100'), 1);             // 100 000 000 = 1 WBTC
});

test('Lee el saldo del contrato de WBTC en Polygon con eth_call', async () => {
  const calls = [];
  const env = load({ fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), method: opts.method }); return rpcOk('0x3426'); } });
  assert.equal(await env.get('wbtcBalance')(ADDR), 0.0001335);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.method, 'eth_call');
  assert.equal(calls[0].body.params[0].to, '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6');
  assert.equal(calls[0].body.params[0].data, env.get('balanceOfData')(ADDR));
});

test('Si un nodo falla o responde mal, prueba el siguiente', async () => {
  const urls = [];
  const env = load({ fetch: async url => {
    urls.push(url);
    if (urls.length === 1) throw new TypeError('Failed to fetch');
    if (urls.length === 2) return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: 'límite' } }) };
    return rpcOk('0x5f5e100');
  } });
  assert.equal(await env.get('wbtcBalance')(ADDR), 1);
  assert.deepEqual(urls, [...env.get('POLYGON_RPC')]);
});

test('Si ningún nodo responde, falla (y la app usa el registro)', async () => {
  const env = load({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(env.get('wbtcBalance')(ADDR));
});

test('Una dirección inválida no se envía a ningún nodo', async () => {
  let n = 0;
  const env = load({ fetch: async () => { n++; return rpcOk('0x1'); } });
  await assert.rejects(env.get('wbtcBalance')('0x123'));
  assert.equal(n, 0);
});
