/* Investment Dashboard frontend logic. */
(function () {
  const fmt = StockAPI.formatNumber;

  const state = {
    symbol: "AAPL",
    range: "1d",
    chart: null,
    refreshTimer: null,   // setInterval handle for live mode
    inflight: 0,          // monotonically increasing token to ignore stale fetches
  };

  const els = {
    symbolInput: document.getElementById("symbol-input"),
    symbolGo: document.getElementById("symbol-go"),
    tabs: document.querySelectorAll(".tab"),
    panels: document.querySelectorAll(".panel"),
    rangeBtns: document.querySelectorAll(".range-btn"),
    canvas: document.getElementById("price-chart"),
    chartStatus: document.getElementById("chart-status"),
    qSymbol: document.getElementById("q-symbol"),
    qName: document.getElementById("q-name"),
    qPrice: document.getElementById("q-price"),
    qChange: document.getElementById("q-change"),
    qState: document.getElementById("q-state"),
    qCurrency: document.getElementById("q-currency"),
    qExchange: document.getElementById("q-exchange"),
    watchToggle: document.getElementById("watch-toggle"),
    sOpen: document.getElementById("s-open"),
    sHigh: document.getElementById("s-high"),
    sLow: document.getElementById("s-low"),
    sPrev: document.getElementById("s-prev"),
    sVolume: document.getElementById("s-volume"),
    s52h: document.getElementById("s-52h"),
    s52l: document.getElementById("s-52l"),
    sCap: document.getElementById("s-cap"),
    trendingBody: document.getElementById("trending-body"),
    trendingRefresh: document.getElementById("trending-refresh"),
    watchlistBody: document.getElementById("watchlist-body"),
    watchlistRefresh: document.getElementById("watchlist-refresh"),
  };

  // ===== Watchlist (localStorage) =====
  const WATCH_KEY = "invdash.watchlist.v1";
  const watchlist = {
    get() {
      try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; }
      catch { return []; }
    },
    set(list) { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); },
    has(sym) { return this.get().includes(sym.toUpperCase()); },
    add(sym) {
      const s = sym.toUpperCase();
      const list = this.get();
      if (!list.includes(s)) { list.push(s); this.set(list); }
    },
    remove(sym) {
      const s = sym.toUpperCase();
      this.set(this.get().filter((x) => x !== s));
    },
  };

  // ===== Tabs =====
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });
  function switchTab(name) {
    els.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    els.panels.forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
    if (name === "trending") loadTrending();
    if (name === "watchlist") loadWatchlist();
  }

  // ===== Symbol input =====
  els.symbolGo.addEventListener("click", () => loadFromInput());
  els.symbolInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadFromInput();
  });
  function loadFromInput() {
    const v = els.symbolInput.value.trim().toUpperCase();
    if (!v) return;
    state.symbol = v;
    switchTab("chart");
    refreshAll();
  }

  // ===== Range buttons =====
  els.rangeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.rangeBtns.forEach((b) => b.classList.toggle("active", b === btn));
      state.range = btn.dataset.range;
      refreshAll();
    });
  });

  // ===== Watch toggle =====
  els.watchToggle.addEventListener("click", () => {
    if (watchlist.has(state.symbol)) watchlist.remove(state.symbol);
    else watchlist.add(state.symbol);
    updateWatchButton();
  });
  function updateWatchButton() {
    const on = watchlist.has(state.symbol);
    els.watchToggle.classList.toggle("active", on);
    els.watchToggle.textContent = on ? "★ Watching" : "+ Watch";
  }

  // ===== Chart rendering =====
  function initChart() {
    const ctx = els.canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 460);
    gradient.addColorStop(0, "rgba(79, 124, 255, 0.35)");
    gradient.addColorStop(1, "rgba(79, 124, 255, 0)");

    state.chart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [{
          label: "Price",
          data: [],
          borderColor: "#4f7cff",
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: "#4f7cff",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#131a32",
            titleColor: "#e6ecff",
            bodyColor: "#e6ecff",
            borderColor: "#25305a",
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (ctx) => `$${fmt(ctx.parsed.y, { decimals: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            type: "time",
            time: { tooltipFormat: "PP p" },
            grid: { color: "rgba(255,255,255,0.04)" },
            ticks: { color: "#9aa6c7", maxRotation: 0, autoSkipPadding: 24 },
          },
          y: {
            position: "right",
            grid: { color: "rgba(255,255,255,0.06)" },
            ticks: {
              color: "#9aa6c7",
              callback: (v) => `$${fmt(v, { decimals: 2 })}`,
            },
          },
        },
      },
    });
  }

  function setChartColors(isUp) {
    const ctx = els.canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, els.canvas.height || 460);
    const color = isUp ? "#22c55e" : "#ef4444";
    const rgba = isUp ? "34, 197, 94" : "239, 68, 68";
    gradient.addColorStop(0, `rgba(${rgba}, 0.30)`);
    gradient.addColorStop(1, `rgba(${rgba}, 0)`);
    state.chart.data.datasets[0].borderColor = color;
    state.chart.data.datasets[0].backgroundColor = gradient;
    state.chart.data.datasets[0].pointHoverBackgroundColor = color;
  }

  // ===== Refresh chart + quote =====
  function clearLiveTimer() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  async function refreshAll() {
    clearLiveTimer();
    updateWatchButton();
    await loadChartAndQuote();
    if (state.range === "live") {
      // 3s feels live without hammering free CORS proxies into rate-limit
      // territory. Yahoo data is delayed ~15 min for most US equities, so a
      // tighter interval wouldn't reveal anything new anyway.
      state.refreshTimer = setInterval(() => {
        loadChartAndQuote().catch(() => {});
      }, 3000);
    }
  }

  async function loadChartAndQuote() {
    const token = ++state.inflight;
    els.chartStatus.textContent = "Loading…";
    try {
      const chartData = await StockAPI.fetchChart(state.symbol, state.range);
      if (token !== state.inflight) return; // stale
      renderChart(chartData);
      renderQuote(chartData.quote, chartData);
      els.chartStatus.textContent = "";
    } catch (err) {
      if (token !== state.inflight) return;
      console.error(err);
      els.chartStatus.textContent = `Couldn't load ${state.symbol}: ${err.message}`;
    }
  }

  function renderChart(chartData) {
    const pts = chartData.points;
    if (!pts.length) {
      state.chart.data.datasets[0].data = [];
      state.chart.update();
      els.chartStatus.textContent = "No data for this range.";
      return;
    }
    const isUp = pts[pts.length - 1].y >= pts[0].y;
    setChartColors(isUp);
    state.chart.data.datasets[0].data = pts;
    state.chart.update();
  }

  function renderQuote(q, chartData) {
    if (!q) {
      els.qSymbol.textContent = state.symbol;
      els.qName.textContent = "";
      els.qPrice.textContent = "—";
      els.qChange.textContent = "—";
      return;
    }
    els.qSymbol.textContent = q.symbol || state.symbol;
    els.qName.textContent = q.shortName || q.longName || "";
    const price = q.regularMarketPrice;
    const change = q.regularMarketChange;
    const pct = q.regularMarketChangePercent;
    els.qPrice.textContent = price != null ? `$${fmt(price)}` : "—";
    if (change != null && pct != null) {
      const sign = change >= 0 ? "+" : "";
      els.qChange.textContent = `${sign}${fmt(change)} (${sign}${fmt(pct)}%)`;
      els.qChange.classList.toggle("up", change >= 0);
      els.qChange.classList.toggle("down", change < 0);
    } else {
      els.qChange.textContent = "—";
      els.qChange.classList.remove("up", "down");
    }
    els.qState.textContent = q.marketState || "—";
    els.qCurrency.textContent = q.currency || chartData?.currency || "—";
    els.qExchange.textContent = q.fullExchangeName || chartData?.exchangeName || "—";

    els.sOpen.textContent = q.regularMarketOpen != null ? `$${fmt(q.regularMarketOpen)}` : "—";
    els.sHigh.textContent = q.regularMarketDayHigh != null ? `$${fmt(q.regularMarketDayHigh)}` : "—";
    els.sLow.textContent = q.regularMarketDayLow != null ? `$${fmt(q.regularMarketDayLow)}` : "—";
    els.sPrev.textContent = q.regularMarketPreviousClose != null ? `$${fmt(q.regularMarketPreviousClose)}` : "—";
    els.sVolume.textContent = q.regularMarketVolume != null ? fmt(q.regularMarketVolume, { decimals: 0, compact: true }) : "—";
    els.s52h.textContent = q.fiftyTwoWeekHigh != null ? `$${fmt(q.fiftyTwoWeekHigh)}` : "—";
    els.s52l.textContent = q.fiftyTwoWeekLow != null ? `$${fmt(q.fiftyTwoWeekLow)}` : "—";
    els.sCap.textContent = q.marketCap != null ? `$${fmt(q.marketCap, { decimals: 2, compact: true })}` : "—";
  }

  // ===== Trending tab =====
  els.trendingRefresh.addEventListener("click", loadTrending);
  async function loadTrending() {
    els.trendingBody.innerHTML = `<tr><td colspan="6" class="muted">Loading 20 tickers…</td></tr>`;
    try {
      const quotes = await StockAPI.fetchTrending();
      if (!quotes.length) throw new Error("no quotes returned");
      renderQuotesTable(els.trendingBody, quotes, { showRemove: false });
    } catch (err) {
      els.trendingBody.innerHTML = `<tr><td colspan="6" class="muted">Couldn't load trending: ${err.message}</td></tr>`;
    }
  }

  // ===== Watchlist tab =====
  els.watchlistRefresh.addEventListener("click", loadWatchlist);
  async function loadWatchlist() {
    const list = watchlist.get();
    if (list.length === 0) {
      els.watchlistBody.innerHTML = `<tr><td colspan="6" class="muted">Watchlist is empty. Open a ticker on the Chart tab and tap "+ Watch".</td></tr>`;
      return;
    }
    els.watchlistBody.innerHTML = `<tr><td colspan="6" class="muted">Loading…</td></tr>`;
    try {
      const quotes = await StockAPI.fetchQuote(list);
      renderQuotesTable(els.watchlistBody, quotes, { showRemove: true });
    } catch (err) {
      els.watchlistBody.innerHTML = `<tr><td colspan="6" class="muted">Couldn't load watchlist: ${err.message}</td></tr>`;
    }
  }

  function renderQuotesTable(tbody, quotes, { showRemove }) {
    if (!quotes.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No data.</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    for (const q of quotes) {
      const change = q.regularMarketChange;
      const pct = q.regularMarketChangePercent;
      const cls = change >= 0 ? "up" : "down";
      const sign = change >= 0 ? "+" : "";
      const tr = document.createElement("tr");
      tr.dataset.symbol = q.symbol;
      tr.innerHTML = `
        <td class="symbol-cell">${escapeHtml(q.symbol || "")}</td>
        <td>${escapeHtml(q.shortName || q.longName || "")}</td>
        <td class="num">${q.regularMarketPrice != null ? "$" + fmt(q.regularMarketPrice) : "—"}</td>
        <td class="num ${cls}">${change != null ? sign + fmt(change) : "—"}</td>
        <td class="num ${cls}">${pct != null ? sign + fmt(pct) + "%" : "—"}</td>
        <td class="num">${
          showRemove
            ? `<button class="row-action remove" data-action="remove">Remove</button>`
            : `<button class="row-action" data-action="open">Chart</button>`
        }</td>
      `;
      tr.addEventListener("click", (e) => {
        const action = e.target?.dataset?.action;
        if (action === "remove") {
          e.stopPropagation();
          watchlist.remove(q.symbol);
          loadWatchlist();
          if (q.symbol === state.symbol) updateWatchButton();
          return;
        }
        state.symbol = q.symbol;
        switchTab("chart");
        refreshAll();
      });
      tbody.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ===== Boot =====
  initChart();
  els.symbolInput.value = state.symbol;
  refreshAll();
})();
