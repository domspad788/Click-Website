# Investment Dashboard

A static, single-page dashboard for tracking trending stocks. No build step, no backend — open `index.html` in a browser or host the folder on any static host (GitHub Pages, Netlify, S3, etc.).

## Features

- **Chart tab** — load any ticker (AAPL, TSLA, BTC-USD, ^GSPC, etc.) and view price across **1D / 1W / 1M / 3M / 1Y / 5Y**, plus a **Live** mode that re-fetches once per second.
- **Trending tab** — top trending US tickers, click a row to chart it.
- **Watchlist tab** — favorites are persisted in `localStorage`; toggle with the **+ Watch** button on the Chart tab.
- Quote stats: open / high / low / previous close / volume / 52-week high & low / market cap.

## Running

### Desktop app (Mac / Windows / Linux)

The dashboard ships as an Electron app:

```bash
npm install
npm start
```

To produce installer packages (`.dmg` / `.exe` / `.AppImage`):

```bash
npm run dist          # current platform
npm run dist:mac      # macOS .dmg
npm run dist:win      # Windows .exe (NSIS installer)
npm run dist:linux    # Linux AppImage
```

Output lands in `dist-electron/`.

### In a browser

It's also plain HTML/CSS/JS, so you can open `index.html` directly or serve the directory:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How the data works

All data is sourced from Yahoo Finance's `/v8/finance/chart` endpoint, routed through a list of public CORS proxies (`corsproxy.io`, `codetabs.com`, `allorigins.win`, `thingproxy`) with automatic fallback. See `js/api.js`.

**Why only the chart endpoint?** As of 2026, Yahoo's `/v7/finance/quote` (batch quote) and `/v1/finance/trending/US` endpoints require a crumb + cookie session and return `401 Unauthorized` to unauthenticated callers. The chart endpoint still works without auth, and its `meta` block carries everything we need for the quote header (price, change, prev close, day high/low, volume, 52-week high/low, currency, exchange). So we synthesize quotes from chart calls and replace trending with a curated list of frequently-traded tickers (`StockAPI.TRENDING` in `js/api.js` — edit to taste). Market cap is the one field unavailable from the chart endpoint and is hidden.

If you want to remove the third-party proxy dependency, deploy your own (e.g. a Cloudflare Worker that fetches Yahoo and re-emits with `Access-Control-Allow-Origin: *`) and put its URL first in the `PROXIES` array in `js/api.js`.

### A note on "Live" mode

Live mode polls the chart endpoint every 3 seconds. Yahoo's public feed is **delayed ~15 minutes for most US equities**, so polling faster than that wouldn't reveal new ticks and would risk getting rate-limited by the free CORS proxy. If you need true realtime tick data, you'll want a paid feed (Polygon.io, IEX Cloud, Finnhub, Alpaca, etc.) and to swap the data source in `js/api.js`.

## Disclaimer

**This is not financial advice.** The dashboard is a data-visualization tool only. Past performance does not predict future returns, and no software can guarantee that any trade will be profitable. Data is provided as-is and may be delayed or inaccurate. Do your own research and talk to a licensed advisor before investing real money.

## File layout

```
index.html         # markup, three tabs
css/style.css      # dark-theme styles
js/api.js          # Yahoo Finance wrapper with CORS-proxy fallback
js/app.js          # tabs, chart rendering, watchlist, live refresh
electron/main.js   # Electron main process (desktop app)
package.json       # Electron + electron-builder config
```
