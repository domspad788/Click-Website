/* Stock data API wrapper.
 *
 * As of 2026, Yahoo's /v7/finance/quote and /v1/finance/trending endpoints
 * require a crumb + cookie session and return 401 to unauthenticated callers.
 * The /v8/finance/chart endpoint still works without auth and its `meta`
 * object carries everything we need for the quote header (price, prev close,
 * day high/low, volume, 52w high/low, currency, exchange). So we source
 * EVERYTHING from the chart endpoint and synthesize the rest.
 *
 * Yahoo doesn't send CORS headers, so requests are routed through a public
 * CORS proxy with fallback. To remove the third-party dependency, deploy
 * your own (e.g. a Cloudflare Worker) and put its URL first in PROXIES.
 */
(function (global) {
  const PROXIES = [
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  async function proxiedJson(targetUrl) {
    let lastErr;
    for (const wrap of PROXIES) {
      try {
        const res = await fetch(wrap(targetUrl), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        try { return JSON.parse(text); }
        catch { throw new Error("non-JSON response from proxy"); }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("All CORS proxies failed");
  }

  // Range -> (yahoo range, yahoo interval).
  // For "live" we use a 1-day, 1-minute pull and re-fetch periodically.
  const RANGE_MAP = {
    live: { range: "1d",  interval: "1m"  },
    "1d": { range: "1d",  interval: "5m"  },
    "1w": { range: "5d",  interval: "30m" },
    "1mo":{ range: "1mo", interval: "1d"  },
    "3mo":{ range: "3mo", interval: "1d"  },
    "1y": { range: "1y",  interval: "1d"  },
    "5y": { range: "5y",  interval: "1wk" },
  };

  function quoteFromMeta(meta, points, fallbackSymbol) {
    const last = points.length ? points[points.length - 1].y : null;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const price = meta.regularMarketPrice ?? last;
    const change = price != null && prev != null ? price - prev : null;
    const pct = change != null && prev ? (change / prev) * 100 : null;
    return {
      symbol: meta.symbol || fallbackSymbol,
      shortName: meta.shortName || meta.longName || meta.symbol || fallbackSymbol,
      regularMarketPrice: price,
      regularMarketChange: change,
      regularMarketChangePercent: pct,
      regularMarketPreviousClose: prev,
      regularMarketOpen: points.length ? points[0].y : null,
      regularMarketDayHigh: meta.regularMarketDayHigh,
      regularMarketDayLow: meta.regularMarketDayLow,
      regularMarketVolume: meta.regularMarketVolume,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      currency: meta.currency,
      fullExchangeName: meta.exchangeName || meta.fullExchangeName,
      marketState: meta.marketState,
      // marketCap is not exposed by the chart endpoint; left undefined.
    };
  }

  async function fetchChart(symbol, rangeKey) {
    const sym = String(symbol).toUpperCase();
    const { range, interval } = RANGE_MAP[rangeKey] || RANGE_MAP["1d"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
    const data = await proxiedJson(url);
    const result = data?.chart?.result?.[0];
    if (!result) {
      const msg = data?.chart?.error?.description || `No data for ${sym}`;
      throw new Error(msg);
    }
    const ts = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      points.push({ x: ts[i] * 1000, y: c });
    }
    const meta = result.meta || {};
    return {
      symbol: meta.symbol || sym,
      points,
      quote: quoteFromMeta(meta, points, sym),
    };
  }

  // Batch quote: fan out to the chart endpoint in parallel and pull each
  // symbol's `meta`. The `/v7/finance/quote` batch endpoint requires a crumb
  // and is unusable without a cookie session.
  async function fetchQuote(symbols) {
    const list = (Array.isArray(symbols) ? symbols : [symbols])
      .filter(Boolean)
      .map((s) => String(s).toUpperCase());
    if (!list.length) return [];
    const settled = await Promise.allSettled(
      list.map((s) => fetchChart(s, "1d").then((r) => r.quote))
    );
    return settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
  }

  // Curated trending list. Yahoo's trending endpoint is gated behind crumb
  // auth now, so we ship a hardcoded set of frequently-traded US tickers
  // (mega-caps + popular AI / momentum names) and pull live quotes for them.
  const TRENDING = [
    "NVDA","AAPL","MSFT","GOOGL","AMZN","META","TSLA","AMD",
    "AVGO","NFLX","PLTR","SMCI","COIN","MU","ARM","MSTR",
    "GME","BABA","DIS","SPY",
  ];

  async function fetchTrending() {
    return await fetchQuote(TRENDING);
  }

  function formatNumber(n, opts = {}) {
    if (n == null || isNaN(n)) return "—";
    const { decimals = 2, compact = false } = opts;
    if (compact && Math.abs(n) >= 1000) {
      return n.toLocaleString(undefined, {
        notation: "compact",
        maximumFractionDigits: 2,
      });
    }
    return n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  global.StockAPI = {
    fetchChart, fetchQuote, fetchTrending,
    formatNumber, RANGE_MAP, TRENDING,
  };
})(window);
