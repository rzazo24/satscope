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
| Weekly RSI (14, Wilder) | 15 | Raw value |

The signal only uses **closed weeks**: the weekly close is Sunday's close in UTC, the same as Binance's weekly candle, so the action doesn't change during the week. The 200-week average uses 200 weekly closes and the RSI uses Wilder's smoothing, like TradingView.

### Weekly rules

On a base amount of **$10**, by 20-point band:

| Score | 0–20 | 20–40 | 40–60 | 60–80 | 80–100 |
|---|---|---|---|---|---|
| Multiplier | ×5 | ×1 | 0 | 0 | 0 |

At a score of **80 or more**, sell **2%** of the BTC you hold. The proceeds are kept as a **reserve**: when the score drops below **20** (extreme fear), that week's purchase is doubled with money from the reserve. If you log your trades, the app keeps track of the reserve and tells you how much to use.

You can change the weights, multipliers, base amount and sell threshold under "Strategy settings". They're saved in your browser.

## Data

- **Live:** daily BTCUSDT candles from [Binance](https://www.binance.com) (3 calls of 1,000 days) and the Fear & Greed index from [alternative.me](https://alternative.me/crypto/fear-and-greed-index/). Your browser makes these calls.
- **Price fallback:** if Binance fails, daily candles come from [Bitstamp](https://www.bitstamp.net). Over the last 104 weeks the score differs by less than 0.2 points between the two.
- **Fear & Greed fallback:** if alternative.me fails, the snapshot's weekly values are used; if they don't cover the week, the score is worked out without that indicator and the app says so.
- **Built-in snapshot:** if no price source works, the page uses a weekly snapshot (Bitstamp prices, from February 2018 to 9 November 2026).
- Each call times out after 10 seconds, so a hanging API doesn't block the app.

## Other features

- Spanish and English.
- **Trade log:** mark this week's action as done or add trades by hand. The app works out your BTC, money put in, value, return, average price, sales reserve and skipped weeks, and uses them to tell you exactly how much BTC to sell and how much reserve to use. It's only saved in your browser; you can export and import it as CSV.
- **Backtest** from any year you choose: your strategy against fixed DCA (invested, BTC accumulated, sales, value, return and average price).
- Light, dark or automatic theme.
- Installable as an app (PWA): works offline and lets you know when a new version is out.
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
