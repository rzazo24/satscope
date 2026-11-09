// Tests de estructura: lo que referencian la página, el manifest y el service worker existe y se publica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { ROOT, HTML } from './helpers.mjs';

const read = f => readFileSync(new URL(f, ROOT), 'utf8');
const exists = p => existsSync(new URL(p.replace(/^\//, '') || 'index.html', ROOT));
const vercel = JSON.parse(read('vercel.json'));
const SW = read('sw.js');
const copied = vercel.buildCommand.match(/cp -r (.*?) public\//)[1].split(/\s+/);
const published = p => {
  const rel = p.replace(/^\//, '') || 'index.html';
  return rel === 'sw.js' || copied.some(c => rel === c || rel.startsWith(c + '/'));
};

test('Los archivos locales que usa la página existen y se publican', () => {
  const refs = new Set([...HTML.matchAll(/(?:href|src|content)="(\/[^"/][^"]*)"/g)].map(m => m[1]));
  for (const m of HTML.matchAll(/url\((\/[^)]+)\)/g)) refs.add(m[1]);
  for (const m of HTML.matchAll(/'(\/(?:recordatorio|reminder)\.ics)'/g)) refs.add(m[1]);
  refs.add('/sw.js');
  const local = [...refs].filter(r => !r.startsWith('/_vercel/')); // la analítica la sirve Vercel
  assert.ok(local.length >= 8, `pocas referencias encontradas: ${local}`);
  for (const r of local) {
    assert.ok(exists(r), `${r} no existe`);
    assert.ok(published(r), `${r} no se copia en el build de Vercel`);
  }
});

test('El service worker guarda en caché archivos que existen y se publican', () => {
  const shell = JSON.parse(SW.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const f of shell) {
    assert.ok(exists(f), `${f} no existe`);
    assert.ok(published(f), `${f} no se copia en el build`);
  }
  assert.ok(SW.includes("'__BUILD__'"), 'sw.js necesita la marca __BUILD__ para versionar cada despliegue');
  assert.ok(vercel.buildCommand.includes('s/__BUILD__/'), 'el build debe sustituir __BUILD__');
});

test('El manifest es válido y sus iconos existen', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons']) assert.ok(m[k], `falta ${k}`);
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'), 'faltan iconos 192 y 512');
  assert.ok(m.icons.some(i => i.purpose === 'maskable'), 'falta un icono maskable');
  for (const i of m.icons) { assert.ok(exists(i.src), `${i.src} no existe`); assert.ok(published(i.src), `${i.src} no se publica`); }
});

test('Los recordatorios de calendario son iCalendar válidos', () => {
  for (const f of ['recordatorio.ics', 'reminder.ics']) {
    const ics = read(f);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trimEnd().endsWith('END:VCALENDAR'), `${f}: estructura`);
    assert.ok(!/[^\r]\n/.test(ics), `${f}: las líneas deben terminar en CRLF`);
    for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, `${f}: línea de más de 75 bytes: ${l}`);
    assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO/);
    assert.ok(vercel.headers.some(h => h.source.includes('.ics') && h.headers.some(x => /text\/calendar/.test(x.value))), 'tipo text/calendar');
  }
});

test('Los metadatos para compartir apuntan a la imagen publicada', () => {
  const og = HTML.match(/<meta property="og:image" content="([^"]+)"/)[1];
  const url = HTML.match(/<meta property="og:url" content="([^"]+)"/)[1];
  assert.equal(og, new URL('og.png', url).href);
  assert.ok(exists('/og.png') && published('/og.png'));
});

test('La página no carga nada de Google ni de otros dominios salvo las APIs de datos', () => {
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(HTML), 'no debe usar Google Fonts');
  const ext = new Set([...HTML.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(m => m[1]));
  const allowed = ['api.binance.com', 'www.bitstamp.net', 'api.alternative.me', 'satscope-seven.vercel.app', 'github.com',
    'polygon-bor-rpc.publicnode.com', '1rpc.io', 'polygon.drpc.org'];
  for (const h of ext) assert.ok(allowed.includes(h), `dominio inesperado en la página: ${h}`);
});
