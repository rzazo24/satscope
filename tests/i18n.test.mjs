// Tests de las traducciones: mismas claves en español e inglés y textos que se generan bien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, HTML } from './helpers.mjs';

const I18N = load().get('I18N');
const { es, en } = I18N;

test('Español e inglés tienen las mismas claves', () => {
  const a = Object.keys(es).sort(), b = Object.keys(en).sort();
  assert.deepEqual(a.filter(k => !b.includes(k)), [], 'faltan en inglés');
  assert.deepEqual(b.filter(k => !a.includes(k)), [], 'faltan en español');
});

// Parámetros que no se insertan en el texto sino que eligen la variante del mensaje
const SELECTORS = { live: [1, ['live', 'snap', 'none']] };

test('Los textos con datos aceptan los mismos parámetros y no dejan huecos', () => {
  for (const k of Object.keys(es)) {
    if (k in SELECTORS) {
      const [pos, values] = SELECTORS[k];
      for (const [lang, f] of [['es', es[k]], ['en', en[k]]]) {
        const outs = values.map(v => { const a = ['«0»']; a[pos] = v; return f(...a); });
        outs.forEach(o => assert.ok(o.includes('«0»') && !/undefined|null|NaN/.test(o), `${lang}.${k}: ${o}`));
        assert.equal(new Set(outs).size, values.length, `${lang}.${k}: las variantes deberían ser distintas`);
      }
      continue;
    }
    assert.equal(typeof es[k], typeof en[k], k);
    if (typeof es[k] !== 'function') { assert.ok(String(es[k]).trim() && String(en[k]).trim(), `${k} vacío`); continue; }
    assert.equal(es[k].length, en[k].length, `${k}: distinto número de parámetros`);
    const args = Array.from({ length: es[k].length }, (_, i) => `«${i}»`);
    for (const [lang, f] of [['es', es[k]], ['en', en[k]]]) {
      const out = f(...args);
      assert.ok(!/undefined|null|NaN/.test(out), `${lang}.${k}: ${out}`);
      args.forEach(a => assert.ok(out.includes(a), `${lang}.${k} no usa ${a}: ${out}`));
    }
  }
});

test('Todas las claves que usa la página existen', () => {
  const used = new Set([...HTML.matchAll(/data-i18n(?:-aria)?="(\w+)"/g)].map(m => m[1]));
  for (const k of used) assert.ok(k in es && k in en, `falta la clave «${k}»`);
});

test('Cada idioma usa su formato de números', () => {
  assert.equal(es.loc, 'es-ES');
  assert.equal(en.loc, 'en-US');
});

// Ayuda: dos plantillas, una por idioma, con la misma estructura
const tpl = lang => HTML.match(new RegExp(`<template id="help-${lang}">([\\s\\S]*?)</template>`))[1];
const ids = h => [...h.matchAll(/<h3 id="([\w-]+)"/g)].map(m => m[1]);

test('La ayuda tiene las mismas secciones, valores y enlaces en los dos idiomas', () => {
  const es = tpl('es'), en = tpl('en');
  assert.deepEqual(ids(en), ids(es), 'secciones');
  const vals = h => [...h.matchAll(/data-v="([\w:]+)"/g)].map(m => m[1]);
  assert.deepEqual(vals(en), vals(es), 'valores rellenados con los ajustes');
  const links = h => [...h.matchAll(/data-help="([\w-]*)"/g)].map(m => m[1]);
  assert.deepEqual(links(en), links(es), 'enlaces internos');
});

test('Todos los enlaces de ayuda llevan a una sección que existe', () => {
  const sections = new Set(ids(tpl('es')).map(i => i.replace(/^h-/, '')));
  const used = [...HTML.matchAll(/data-help="([\w-]*)"/g)].map(m => m[1]).filter(Boolean);
  assert.ok(used.length > 10);
  for (const u of used) assert.ok(sections.has(u), `data-help="${u}" no tiene sección`);
});

test('Los valores de la ayuda usan ajustes que existen', () => {
  const inputs = new Set([...HTML.matchAll(/<input type="number" id="(\w+)"/g)].map(m => m[1]));
  for (const [, k, a] of tpl('es').matchAll(/data-v="(\w+):(\w+)"/g)) {
    if (k === 'mul' || k === 'amt') assert.ok(inputs.has('m' + a), `tramo ${a}`);
    else assert.ok(inputs.has(a), `${k}:${a}`);
  }
});
