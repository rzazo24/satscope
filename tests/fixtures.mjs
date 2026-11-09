// Datos sintéticos y deterministas que imitan las respuestas de las APIs que usa SatScope.
const DAY = 864e5;

// Precio de cierre del día que empieza en `t` (ms, 00:00 UTC). Sube a largo plazo con ciclos.
export const price = t => {
  const d = t / DAY;
  return Math.round((20000 + d * 3 + 15000 * Math.sin(d / 180) + 2500 * Math.sin(d / 23)) * 100) / 100;
};
export const fng = t => Math.max(1, Math.min(99, Math.round(50 + 40 * Math.sin(t / DAY / 30))));
export const EURUSD = 1.15;

// Velas diarias desde 2015 hasta el día de `now` (incluida la de hoy, aún abierta)
function candles(now) {
  const out = [], last = Math.floor(now / DAY) * DAY;
  for (let t = Date.UTC(2015, 0, 1); t <= last; t += DAY) out.push(t);
  return out;
}

// Responde como la API correspondiente. Devuelve {status, body} o null si la URL no es de una API conocida.
export function respond(url, now, { fail = [] } = {}) {
  const u = new URL(url), host = u.hostname;
  const down = fail.some(f => host.includes(f));
  if (host === 'api.binance.com' && u.pathname === '/api/v3/klines') {
    if (down) return { status: 500, body: '{"msg":"caído"}' };
    const end = +u.searchParams.get('endTime'), limit = +u.searchParams.get('limit');
    const ts = candles(now).filter(t => t <= end).slice(-limit);
    return { status: 200, body: JSON.stringify(ts.map(t => [t, '0', '0', '0', String(price(t)), '0', t + DAY - 1])) };
  }
  if (host === 'api.binance.com' && u.pathname === '/api/v3/ticker/price') {
    return down ? { status: 500, body: '{}' } : { status: 200, body: JSON.stringify({ symbol: 'EURUSDT', price: String(EURUSD) }) };
  }
  if (host === 'www.bitstamp.net' && u.pathname.startsWith('/api/v2/ohlc/')) {
    if (down) return { status: 500, body: '{}' };
    const end = +u.searchParams.get('end') * 1000, limit = +u.searchParams.get('limit');
    const ts = candles(now).filter(t => t <= end).slice(-limit);
    return { status: 200, body: JSON.stringify({ data: { pair: 'BTC/USD', ohlc: ts.map(t => ({ timestamp: String(t / 1000), close: price(t).toFixed(2) })) } }) };
  }
  if (host === 'www.bitstamp.net' && u.pathname.startsWith('/api/v2/ticker/')) {
    return down ? { status: 500, body: '{}' } : { status: 200, body: JSON.stringify({ last: String(EURUSD) }) };
  }
  if (host === 'api.alternative.me') {
    if (down) return { status: 500, body: '{}' };
    const ts = candles(now).filter(t => t >= Date.UTC(2018, 1, 1)).reverse(); // la API devuelve lo más reciente primero
    return { status: 200, body: JSON.stringify({ data: ts.map(t => ({ value: String(fng(t)), timestamp: String(t / 1000) })) }) };
  }
  return null;
}

// fetch simulado para los tests sin navegador; registra las URLs pedidas en `calls`
export function fakeFetch(now, opts = {}) {
  const calls = [];
  const f = async url => {
    calls.push(url);
    const r = respond(url, now, opts);
    if (!r) throw new TypeError('Failed to fetch ' + url);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body) };
  };
  f.calls = calls;
  return f;
}
