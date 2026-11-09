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
- **Respaldo:** si alguna API falla, se usa una instantánea semanal integrada (precios de Bitstamp, desde febrero de 2018 hasta el 9 de noviembre de 2026).

## Otras funciones

- Español e inglés.
- **Registro de operaciones:** marca la acción de la semana como hecha o añade operaciones a mano. La app calcula tu BTC, lo aportado, el valor, la rentabilidad, el precio medio, la reserva de ventas y las semanas saltadas, y con ello te dice cuánto BTC vender exactamente y cuánta reserva usar. Se guarda solo en tu navegador; puedes exportarlo e importarlo en CSV.
- **Backtest** desde el año que elijas: tu estrategia frente a un DCA fijo (invertido, BTC acumulado, ventas, valor, rentabilidad y precio medio).
- Tema claro, oscuro o automático.
- Instalable como app (PWA): funciona sin conexión y avisa cuando hay una versión nueva.
- Analítica de visitas con [Vercel Web Analytics](https://vercel.com/docs/analytics): sin cookies y sin datos personales.

## Uso local

Abre `index.html` en el navegador, o sirve la carpeta:

```bash
python3 -m http.server 8000
```

## Despliegue

Está en Vercel como sitio estático y cada push a `main` se publica solo. La analítica solo funciona en Vercel.

## Aviso

Herramienta de análisis basada en datos históricos. **No es asesoramiento financiero.**

## Licencia

[MIT](LICENSE)
