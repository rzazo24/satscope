// Carga bloques de código de index.html en un contexto aislado para probarlos sin navegador.
// Así los tests ejecutan exactamente el código que se publica.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const ROOT = new URL('../', import.meta.url);
export const HTML = readFileSync(new URL('index.html', ROOT), 'utf8');
const SCRIPT = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('// Instantánea semanal'));

// Devuelve el texto entre dos marcas del script principal (la primera incluida, la segunda no)
export function segment(from, to) {
  const i = SCRIPT.indexOf(from), j = SCRIPT.indexOf(to, i);
  if (i < 0 || j < 0) throw new Error(`No encuentro el bloque «${from}» … «${to}» en index.html`);
  return SCRIPT.slice(i, j);
}

// Valores por defecto de la estrategia, leídos de los <input> de index.html
export const DEF = Object.fromEntries(
  [...HTML.matchAll(/<input type="number" id="(\w+)" value="([\d.]+)"/g)].map(([, k, v]) => [k, +v]));

// Crea un entorno con reloj fijo, fetch simulado y localStorage en memoria.
// Carga: lógica de datos y puntuación, traducciones y registro de operaciones.
export function load({ now = Date.UTC(2026, 10, 9, 12), fetch = async () => { throw new Error('sin red'); }, storage = {} } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  }
  const store = { ...storage };
  const ctx = vm.createContext({
    Math, Map, Set, Number, String, JSON, Error, Promise, isFinite, AbortSignal, BigInt, console,
    Date: FakeDate,
    fetch: (...a) => ctx.__fetch(...a),
    __fetch: fetch,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    render: () => {},
  });
  vm.runInContext('const clamp=v=>Math.max(0,Math.min(100,v));', ctx);
  vm.runInContext(segment('// Instantánea semanal', 'let ROWS=null'), ctx);
  vm.runInContext(segment('const I18N={', 'let LANG='), ctx);
  vm.runInContext("let SRC='live',ROWS=[],NOW=1;", ctx);
  vm.runInContext(segment('// Registro de operaciones', 'let CUR=null'), ctx);
  // Acceso a variables y funciones del contexto
  const get = expr => vm.runInContext(expr, ctx);
  return { ctx, get, run: get, store, setFetch: f => { ctx.__fetch = f; } };
}
