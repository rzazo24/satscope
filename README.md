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
| RSI semanal (14) | 15 | Valor directo |

### Reglas semanales

Sobre una aportación base de **5 $**, según el tramo de 20 puntos:

| Puntuación | 0–20 | 20–40 | 40–60 | 60–80 | 80–100 |
|---|---|---|---|---|---|
| Multiplicador | ×5 | ×1 | 0 | 0 | 0 |

Con una puntuación de **75 o más** se vende un **5 %** del BTC acumulado.

Pesos, multiplicadores, aportación y umbral de venta se pueden cambiar en «Ajustes de la estrategia». Se guardan en el navegador.

## Datos

- **En directo:** velas diarias BTCUSDT de [Binance](https://www.binance.com) (3 llamadas de 1000 días) y el índice Fear & Greed de [alternative.me](https://alternative.me/crypto/fear-and-greed-index/). Las llamadas las hace tu navegador.
- **Respaldo:** si alguna API falla, se usa una instantánea semanal integrada (precios de Bitstamp, desde febrero de 2018 hasta el 9 de noviembre de 2026).

## Otras funciones

- Español e inglés.
- Tema claro, oscuro o automático.
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
