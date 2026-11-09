# SatScope

Panel web de DCA dinámico para Bitcoin. Publicado en https://satscope-seven.vercel.app (repo público `rzazo24/satscope`). El usuario lo usa con dinero real: compra **WBTC en Polygon** con USDC una vez por semana.

Idioma del proyecto: **español** (código comentado en español, commits en español, respuestas al usuario en español). La interfaz es bilingüe ES/EN.

## Restricciones
- **Toda la app vive en `index.html`**: HTML, CSS y JS en línea, sin dependencias, sin framework y sin paso de compilación propio. No añadir `package.json`, bundlers ni librerías externas.
- Solo se contactan estos dominios externos (lo comprueba `tests/files.test.mjs`): `api.binance.com`, `www.bitstamp.net`, `api.alternative.me`, los nodos de Polygon (`polygon-bor-rpc.publicnode.com`, `1rpc.io`, `polygon.drpc.org`) y enlaces a `github.com`. Nada de Google Fonts ni CDNs: las fuentes están en `fonts/`.
- Todo el estado del usuario está en `localStorage` (`cfg`, `ledger`, `lang`, `theme`, `unit`, `wallet`, `eur`, `seenHelp`, `btFrom`). No hay servidor ni cuentas.

## Estructura
- `index.html`: la app. El script principal está ordenado en bloques; **los tests extraen bloques por estas marcas literales, no las renombres ni las muevas sin actualizar `tests/helpers.mjs`**:
  - `// Instantánea semanal` … `let ROWS=null`: datos, RSI de Wilder, `parts`, `score`, `live()` (Binance → Bitstamp → error), `backtest`.
  - `const I18N={` … `let LANG=`: textos ES/EN.
  - `// Registro de operaciones` … `let CUR=null`: lógica pura del registro, CSV, migración de ajustes y saldo de WBTC. Aquí solo funciones sin DOM.
- `<template id="help-es">` y `<template id="help-en">`: la ayuda. Misma estructura en los dos idiomas (secciones `h3#h-…`, valores `data-v`, enlaces `data-help`); lo comprueba `tests/i18n.test.mjs`.
- `sw.js`: service worker (instalable, sin conexión, aviso de versión nueva). `VERSION = '__BUILD__'` lo sustituye Vercel por el commit.
- `vercel.json`: el `buildCommand` copia a `public/` una lista explícita de archivos. **Un archivo nuevo que deba publicarse hay que añadirlo ahí** (y a `SHELL` en `sw.js` si debe ir en la caché).
- `tests/`: `node --test`. `helpers.mjs` carga los bloques en un `vm` con reloj, `fetch` y `localStorage` simulados; `fixtures.mjs` imita las APIs.

## Comandos
```bash
node --test                                   # todos los tests (unos 30 s; la mayor parte, los de Chrome)
node --test tests/e2e.test.mjs                # solo los de Chrome
node --test --test-name-pattern="WBTC"        # por nombre
python3 -m http.server 8080                   # servir en local (las rutas son absolutas: /fonts, /icons…)
```
Los tests e2e necesitan Chrome (`/usr/bin/google-chrome` o `CHROME_PATH`) y Node ≥ 22; si no hay Chrome se saltan. Interceptan las APIs con el dominio `Fetch` de DevTools, fijan `lang: 'es'` y responden también al preflight `OPTIONS` de los nodos de Polygon.

## Reglas de la estrategia (valores por defecto en los `<input>` de ajustes)
Puntuación 0–100 = media ponderada de Fear & Greed (30), caída desde máximo (40; −80 % = 0), precio/MA de 200 cierres semanales (15; log, ×5 = 100) y RSI semanal de Wilder (15). Solo **semanas cerradas**: cierre del domingo en UTC, se descarta la vela abierta. Aportación base 10 $, multiplicadores ×5/×1/0/0/0 por tramos de 20, vender 2 % desde 80, reserva de ventas que duplica la compra por debajo de 20. Si cambias un valor por defecto, cambia también el `value` del `<input>`: `DEF` y los tests lo leen de ahí.

## Trampas conocidas (ya nos han pasado)
- **TDZ al arrancar**: código que se ejecuta al cargar la página no puede usar `const`/`let` declarados más abajo en el script. El error queda tragado por un `try` o rompe toda la página. Ej.: `migrateCfg` tiene sus constantes dentro; `$('wallet').value` se asigna después de declarar `WALLET`.
- **`T` sombreado**: en `draw`/`drawBt` hay una variable local `T` (margen superior); ahí usa `I18N[LANG]`, no `T()`.
- **`T()` es un Proxy** que sustituye `{U}` por `BTC` o `WBTC` en todos los textos. Para textos de tenencias usa `{U}` en I18N, no «BTC» literal. El precio («BTC ahora a…») sigue siendo BTC.
- **CSS**: `[hidden]{display:none!important}` existe porque reglas con `display` pisaban `hidden`. Los campos comparten estilo (`input:not([type=checkbox]):not([type=file]),select`, 16 px para evitar el zoom de iPhone). `.btn` usa `box-sizing:border-box` para que un `<a class="btn">` mida igual que un `<button>`. El recuadro de foco solo se ve en modo teclado (clase `kbd` en `<html>`, que se activa con Tab).
- **Service worker**: la caché en tiempo de ejecución solo sirve y guarda rutas de `SHELL` exactas, sin parámetros y sin `ignoreSearch`; `/sw.js` y todo lo demás va a la red. Solo la navegación a `/` devuelve la app guardada: otras navegaciones (p. ej. `/recordatorio.ics`) deben llegar a la red. Lo cubre `tests/sw.test.mjs`.
- **Ajustes**: solo se guardan las diferencias con `DEF` en `cfg`; la versión antigua `dcaCfg` se migra con `migrateCfg`.
- **Textos nuevos**: añádelos en `es` y `en` con los mismos parámetros; si un parámetro elige variante en vez de insertarse, decláralo en `SELECTORS` de `tests/i18n.test.mjs`.

## Cómo trabajar
1. Cambia `index.html` (o lo que toque) y comprueba la sintaxis del script.
2. `node --test`. Si añades una función o un comportamiento, añade su test; para lógica pura, ponla en el bloque del registro y pruébala con `load()`.
3. **Mira el resultado en Chrome a 390 px de ancho** (el usuario usa iPhone): capturas por CDP, sin desbordes horizontales ni errores de JS. Safari no se puede probar aquí: dilo cuando un cambio dependa de él.
4. Commit en español con la línea `Co-Authored-By` que indique el sistema, y push a `main`.
5. Vercel despliega solo al hacer push. Comprueba que `https://satscope-seven.vercel.app/sw.js` contiene el hash del commit y que GitHub Actions (`gh run list`) pasa. Si Vercel no recibe el push (pasó una vez), `vercel deploy --prod --yes`. Los e2e en Actions pueden fallar de forma intermitente si Chrome tarda en arrancar: mira el log antes de cambiar código.

## Otros
- Dominio: de momento no hay dominio propio. Las URLs absolutas de `og:image`, `og:url`, los `.ics` y el README apuntan a `satscope-seven.vercel.app`; si algún día cambia, actualízalas todas.
- `og.png` y los iconos se generaron renderizando HTML/SVG con Chrome; la puntuación de `og.png` (37) es ilustrativa.
- No es asesoramiento financiero: no añadas textos que lo parezcan.
