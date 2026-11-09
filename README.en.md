# SatScope

[Español](README.md) · **English**

A web dashboard for **dynamic Bitcoin DCA**: every week it works out a score from 0 to 100 and tells you how much to buy, whether to hold, or whether to sell a slice.

🔗 **Live demo:** https://satscope-seven.vercel.app

It's a single `index.html` with no dependencies and no build step.

## How it works

### Score (0 = extreme fear, 100 = euphoria)

A weighted average of four indicators, each mapped to a 0–100 scale:

| Indicator | Weight | Scale |
|---|---|---|
| Fear & Greed | 30 | Raw value from alternative.me |
| Drawdown from all-time high | 40 | 0% drawdown = 100, −80% = 0 |
| Price / 200-week moving average | 15 | Logarithmic: ×1 = 0, ×5 = 100 |
| Weekly RSI (14) | 15 | Raw value |

### Weekly rules

On a base amount of **$5**, by 20-point band:

| Score | 0–20 | 20–40 | 40–60 | 60–80 | 80–100 |
|---|---|---|---|---|---|
| Multiplier | ×5 | ×1 | 0 | 0 | 0 |

At a score of **75 or more**, sell **5%** of the BTC you hold.

You can change the weights, multipliers, base amount and sell threshold under "Strategy settings". They're saved in your browser.

## Data

- **Live:** daily BTCUSDT candles from [Binance](https://www.binance.com) (3 calls of 1,000 days) and the Fear & Greed index from [alternative.me](https://alternative.me/crypto/fear-and-greed-index/). Your browser makes these calls.
- **Fallback:** if either API fails, the page uses a built-in weekly snapshot (Bitstamp prices, from February 2018 to 9 November 2026).

## Other features

- Spanish and English.
- Light, dark or automatic theme.
- Visit analytics with [Vercel Web Analytics](https://vercel.com/docs/analytics): no cookies and no personal data.

## Running locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deployment

It runs on Vercel as a static site, and every push to `main` goes live automatically. Analytics only works on Vercel.

## Disclaimer

An analysis tool based on historical data. **Not financial advice.**

## License

[MIT](LICENSE)
