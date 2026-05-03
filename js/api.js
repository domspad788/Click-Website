/* Stock data API wrapper.
 *
 * Yahoo Finance's public endpoints don't send CORS headers, so we route
 * requests through a public CORS proxy. We try a small list in order and
 * fall back if one is down.
 *
 * If you want zero dependency on third-party proxies, run your own (e.g.
 * a Cloudflare Worker that fetches and re-emits with Access-Control-Allow-Origin: *)
 * and put its base URL first in PROXIES.
 */
(function (global) {
  const PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  ];

  async function proxiedJson(targetUrl) {
    let lastErr;
    for (const wrap of PROXIES) {
      try {
        const res = await fetch(wrap(targetUrl), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("All proxies failed");
  }

  // Range -> (yahoo range, yahoo interval)
  // For "live" we use a 1-day, 1-minute pull and re-fetch every second.
  const RANGE_MAP = {
    live: { range: "1d", interval: "1m" },
    "1d":  { range: "1d", interval: "5m" },
    "1w":  { range: "5d", interval: "30m" },
    "1mo": { range: "1mo", interval: "1d" },
    "3mo": { range: "3mo", interval: "1d" },
    "1y":  { range: "1y", interval: "1d" },
    "5y":  { range: "5y", interval: "1wk" },
  };

  async function fetchChart(symbol, rangeKey) {
    const { range, interval } = RANGE_MAP[rangeKey] || RANGE_MAP["1d"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
    const data = await proxiedJson(url);
    const result = data?.chart?.result?.[0];
    if (!result) {
      const msg = data?.chart?.error?.description || "No data";
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
    return {
      symbol: result.meta?.symbol || symbol,
      currency: result.meta?.currency,
      exchangeName: result.meta?.exchangeName,
      meta: result.meta || {},
      points,
    };
  }

  async function fetchQuote(symbols) {
    const list = Array.isArray(symbols) ? symbols : [symbols];
    if (list.length === 0) return [];
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list.join(","))}`;
    const data = await proxiedJson(url);
    return data?.quoteResponse?.result || [];
  }

  async function fetchTrending() {
    const url = `https://query1.finance.yahoo.com/v1/finance/trending/US?count=20`;
    const data = await proxiedJson(url);
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    const symbols = quotes.map((q) => q.symbol).filter(Boolean);
    if (symbols.length === 0) return [];
    return await fetchQuote(symbols);
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

  global.StockAPI = { fetchChart, fetchQuote, fetchTrending, formatNumber, RANGE_MAP };
})(window);
