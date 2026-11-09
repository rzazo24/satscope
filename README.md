# SatScope

**Español** · [English](README.en.md)

Panel web de **DCA dinámico para Bitcoin**: cada semana calcula una puntuación de 0 a 100 y te dice cuánto comprar, si esperar o si vender una parte.

🔗 **Demo:** https://satscope-seven.vercel.app

Es un único `index.html`, sin dependencias ni paso de compilación.

## Cómo funciona

### Puntuación (0 = miedo extremo, 100 = euforia)

Media ponderada de cuatro indicadores, cada uno llevado a una escala de 0 a 100:

| Indicador | Peso | Escala |
|---|---|---|
| Fear & Greed | 30 | Valor directo de alternative.me |
| Caída desde máximo histórico | 40 | 0 % de caída = 100, −80 % = 0 |
| Precio / media de 200 semanas | 15 | Logarítmica: ×1 = 0, ×5 = 100 |
| RSI semanal (14, Wilder) | 15 | Valor directo |

La señal se calcula solo con **semanas cerradas**: el cierre semanal es el del domingo en UTC, igual que la vela semanal de Binance. Así la acción no cambia durante la semana. La media de 200 semanas usa 200 cierres semanales y el RSI usa el suavizado de Wilder, como TradingView.

### Reglas semanales

Sobre una aportación base de **10 $**, según el tramo de 20 puntos:

| Puntuación | 0–20 | 20–40 | 40–60 | 60–80 | 80–100 |
|---|---|---|---|---|---|
| Multiplicador | ×5 | ×1 | 0 | 0 | 0 |

Con una puntuación de **80 o más** se vende un **2 %** del BTC acumulado. Lo cobrado se guarda como **reserva**: cuando la puntuación baja de **20** (miedo extremo), la compra de esa semana se duplica con dinero de la reserva. Si apuntas tus operaciones, la app lleva la reserva por ti y te dice cuánto usar.

Pesos, multiplicadores, aportación y umbral de venta se pueden cambiar en «Ajustes de la estrategia». Se guardan en el navegador.

## Datos

- **En directo:** velas diarias BTCUSDT de [Binance](https://www.binance.com) (3 llamadas de 1000 días) y el índice Fear & Greed de [alternative.me](https://alternative.me/crypto/fear-and-greed-index/). Las llamadas las hace tu navegador.
- **Respaldo de precios:** si Binance falla, las velas diarias se piden a [Bitstamp](https://www.bitstamp.net). En las últimas 104 semanas la puntuación con una u otra fuente difiere menos de 0,2 puntos.
- **Respaldo de Fear & Greed:** si alternative.me falla, se usan los valores semanales de la instantánea; si no cubren la semana, la puntuación se calcula sin ese indicador y la app lo avisa.
- **Instantánea integrada:** si no hay ninguna fuente de precios, se usa una instantánea semanal (precios de Bitstamp, desde febrero de 2018 hasta el 9 de noviembre de 2026).
- Cada llamada tiene un límite de 10 segundos, para que una API colgada no bloquee la app.

## Otras funciones

- Español e inglés.
- **Registro de operaciones:** marca la acción de la semana como hecha o añade operaciones a mano. La app calcula tu BTC, lo aportado, el valor, la rentabilidad, el precio medio, la reserva de ventas y las semanas saltadas, y con ello te dice cuánto BTC vender exactamente y cuánta reserva usar. Se guarda solo en tu navegador; puedes exportarlo e importarlo en CSV.
- **Backtest** desde el año que elijas: tu estrategia frente a un DCA fijo (invertido, BTC acumulado, ventas, valor, rentabilidad y precio medio).
- Tema claro, oscuro o automático.
- Equivalencia en euros de la acción y del precio (opcional). La estrategia y el registro van en dólares, porque las compras se hacen en dólares (USDC) en Polygon.
- Recordatorio semanal para tu calendario (.ics), cada lunes a las 9:00.
- Fuentes servidas desde el propio sitio: no se contacta con Google y la app funciona del todo sin conexión.
- Instalable como app (PWA): funciona sin conexión y avisa cuando hay una versión nueva.
- Analítica de visitas con [Vercel Web Analytics](https://vercel.com/docs/analytics): sin cookies y sin datos personales.

## Uso local

Abre `index.html` en el navegador, o sirve la carpeta:

```bash
python3 -m http.server 8000
```

## Tests

Sin dependencias: solo Node 22 o superior.

```bash
node --test
```

| Archivo | Qué comprueba |
|---|---|
| `tests/logic.test.mjs` | RSI de Wilder (con un ejemplo de referencia), escalas de los indicadores, puntuación, backtest e instantánea |
| `tests/data.test.mjs` | Carga de datos: paginación de Binance, solo semanas cerradas, MA200, caída, respaldo de Bitstamp y de Fear & Greed |
| `tests/ledger.test.mjs` | Registro de operaciones: cartera, acción semanal, semanas saltadas, CSV y migración de ajustes |
| `tests/i18n.test.mjs` | Que español e inglés tengan los mismos textos y que no quede ninguno sin traducir |
| `tests/files.test.mjs` | Que lo que usan la página, el manifest y el service worker exista y se publique |
| `tests/e2e.test.mjs` | La página real en Chrome con datos simulados: carga, respaldos, registro, idioma, tema y migración. Se salta si no hay Chrome (o usa `CHROME_PATH`) |

Los tests cargan el código directamente de `index.html`, así que prueban exactamente lo que se publica. Se ejecutan en GitHub Actions con cada push.

## Despliegue

Está en Vercel como sitio estático y cada push a `main` se publica solo. La analítica solo funciona en Vercel.

## Aviso

Herramienta de análisis basada en datos históricos. **No es asesoramiento financiero.**

## Licencia

[MIT](LICENSE). Las fuentes IBM Plex se distribuyen con la licencia [SIL Open Font License 1.1](fonts/OFL.txt).
