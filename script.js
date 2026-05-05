/* ============================================================
   QUANTEDGE TRADING TERMINAL — script.js
   Full-stack trading simulation with real stock data
   ============================================================ */

/* ============================================================
   🔑 ══════════════════════════════════════════════════════
      API KEY CONFIGURATION — PASTE YOUR KEY BELOW
      ──────────────────────────────────────────────────────
      1. Go to: https://finnhub.io/register  (FREE account)
      2. Copy your API token from the dashboard
      3. Replace 'YOUR_FINNHUB_API_KEY_HERE' with your key
   ══════════════════════════════════════════════════════ 🔑
   ============================================================ */
const API_KEY = 'd7sq1uhr01qorsvjka10d7sq1uhr01qorsvjka1g'; // ← 📌 LINE 19 — PASTE YOUR KEY HERE

/* ── API ENDPOINT BASE ── */
const API_BASE = 'https://finnhub.io/api/v1';

/* ============================================================
   APP CONFIGURATION
   ============================================================ */
const CONFIG = {
  startingBalance:   10000,           // Virtual starting balance in USD
  refreshInterval:   6000,            // Auto-refresh quotes every 6 seconds (ms)
  defaultStocks:     ['AAPL', 'TSLA', 'AMZN', 'GOOGL', 'MSFT', 'META', 'NVDA'],
  defaultChartType:  'candlestick',   // 'candlestick' | 'line' | 'bar'
  defaultResolution: 'D',             // 'D' = daily | 'W' = weekly | 'M' = monthly
  historyDays:       365,             // Days of historical data to fetch
  storageKey:        'quantedge_v1',  // localStorage key
  portfolioSnapshotInterval: 60000,   // Take portfolio snapshot every 60s
};

/* ── STOCK NAME MAP ── */
const STOCK_NAMES = {
  AAPL: 'Apple Inc.',      TSLA: 'Tesla Inc.',       AMZN: 'Amazon.com Inc.',
  GOOGL: 'Alphabet Inc.',  MSFT: 'Microsoft Corp.',  META: 'Meta Platforms',
  NVDA: 'NVIDIA Corp.',    NFLX: 'Netflix Inc.',     AMD: 'Advanced Micro Devices',
  BABA: 'Alibaba Group',   JPM: 'JPMorgan Chase',    BAC: 'Bank of America',
  DIS: 'Walt Disney Co.',  V: 'Visa Inc.',            PYPL: 'PayPal Holdings',
  UBER: 'Uber Technologies', SPOT: 'Spotify Tech.',  COIN: 'Coinbase Global',
  INTC: 'Intel Corp.',     ORCL: 'Oracle Corp.',     CRM: 'Salesforce Inc.',
};

/* ── MOCK BASE PRICES (demo mode fallback) ── */
const MOCK_PRICES = {
  AAPL: 178.5,  TSLA: 242.1,  AMZN: 184.7,  GOOGL: 162.3,
  MSFT: 418.4,  META: 507.2,  NVDA: 882.6,  NFLX: 625.3,
  AMD: 172.8,   JPM: 204.5,   BAC: 38.2,    DIS: 112.4,
  V: 276.8,     PYPL: 65.4,   UBER: 72.1,   COIN: 234.7,
  INTC: 30.8,   ORCL: 122.5,  CRM: 285.1,   SPOT: 315.8,
};

/* ============================================================
   APPLICATION STATE
   ============================================================ */
let STATE = {
  balance:         CONFIG.startingBalance,
  holdings:        {},        // { AAPL: { shares: 5, avgCost: 170.20 } }
  tradeHistory:    [],        // Array of trade records
  portfolioHistory:[],        // Array of { time, value } snapshots
  watchlist:       [...CONFIG.defaultStocks],
  activeSymbol:    CONFIG.defaultStocks[0],
  currentPrices:   {},        // { AAPL: { c, d, dp, h, l, o, pc, v } }
  chartType:       CONFIG.defaultChartType,
  resolution:      CONFIG.defaultResolution,
  isDemo:          false,     // true when using generated data
  refreshTimer:    null,
  snapshotTimer:   null,
  chart:           null,      // LightweightCharts instance
  series:          null,      // Active chart series
  portfolioChart:  null,      // Portfolio performance chart
  portfolioSeries: null,
};

/* ============================================================
   LOCAL STORAGE MODULE
   ============================================================ */
const STORAGE = {
  save() {
    const data = {
      balance:          STATE.balance,
      holdings:         STATE.holdings,
      tradeHistory:     STATE.tradeHistory,
      portfolioHistory: STATE.portfolioHistory,
      watchlist:        STATE.watchlist,
      chartType:        STATE.chartType,
    };
    try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(data)); }
    catch(e) { console.warn('Storage save failed:', e); }
  },

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      STATE.balance          = data.balance          ?? CONFIG.startingBalance;
      STATE.holdings         = data.holdings          ?? {};
      STATE.tradeHistory     = data.tradeHistory      ?? [];
      STATE.portfolioHistory = data.portfolioHistory  ?? [];
      STATE.watchlist        = data.watchlist?.length ? data.watchlist : [...CONFIG.defaultStocks];
      STATE.chartType        = data.chartType          ?? CONFIG.defaultChartType;
    } catch(e) { console.warn('Storage load failed:', e); }
  },

  clear() {
    localStorage.removeItem(CONFIG.storageKey);
  }
};

/* ============================================================
   API MODULE — Finnhub REST calls
   ============================================================ */
const API = {
  /* Check if API key is set (not placeholder) */
  isKeySet() {
    return API_KEY && API_KEY !== 'YOUR_FINNHUB_API_KEY_HERE' && API_KEY.trim().length > 0;
  },

  /* Fetch real-time quote for a symbol */
  async getQuote(symbol) {
    if (!this.isKeySet()) return null;
    try {
      const url = `${API_BASE}/quote?symbol=${symbol}&token=${API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Finnhub returns { c: current, d: change, dp: changePercent, h, l, o, pc, t, v }
      if (!data.c || data.c === 0) return null;
      return data;
    } catch (e) {
      console.warn(`Quote fetch failed for ${symbol}:`, e.message);
      return null;
    }
  },

  /* Fetch historical candle data */
  async getCandles(symbol, resolution = 'D') {
    if (!this.isKeySet()) return null;
    try {
      const toTs   = Math.floor(Date.now() / 1000);
      const days   = resolution === 'D' ? CONFIG.historyDays
                   : resolution === 'W' ? CONFIG.historyDays * 2
                   : CONFIG.historyDays * 4;
      const fromTs = toTs - days * 86400;
      const url = `${API_BASE}/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${fromTs}&to=${toTs}&token=${API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.s !== 'ok' || !data.c?.length) return null;
      // Transform Finnhub format → LightweightCharts format
      return data.t.map((timestamp, i) => ({
        time:   timestamp,
        open:   data.o[i],
        high:   data.h[i],
        low:    data.l[i],
        close:  data.c[i],
        volume: data.v[i],
      }));
    } catch (e) {
      console.warn(`Candle fetch failed for ${symbol}:`, e.message);
      return null;
    }
  },

  /* Fetch multiple quotes in sequence (rate-limit friendly) */
  async getMultipleQuotes(symbols) {
    const results = {};
    for (const sym of symbols) {
      results[sym] = await this.getQuote(sym);
      await this._delay(120); // ~120ms between calls to respect rate limits
    }
    return results;
  },

  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
};

/* ============================================================
   MOCK DATA GENERATOR — Realistic random walk
   Used when API key is not set or API call fails
   ============================================================ */
const MOCK = {
  /* Generate a realistic mock quote */
  quote(symbol) {
    const base = MOCK_PRICES[symbol] || 100;
    const stored = STATE.currentPrices[symbol];
    const prev = stored ? stored.c : base;
    const change = (Math.random() - 0.49) * prev * 0.015;
    const current = Math.max(1, prev + change);
    const d  = current - (stored?.pc || base);
    const dp = (d / (stored?.pc || base)) * 100;
    return {
      c:  +current.toFixed(2),
      d:  +d.toFixed(2),
      dp: +dp.toFixed(4),
      h:  +(current * (1 + Math.random() * 0.008)).toFixed(2),
      l:  +(current * (1 - Math.random() * 0.008)).toFixed(2),
      o:  +(prev * (1 + (Math.random() - 0.5) * 0.004)).toFixed(2),
      pc: stored?.pc || +base.toFixed(2),
      v:  Math.floor(Math.random() * 60000000 + 5000000),
    };
  },

  /* Generate historical candle data (random walk, looks realistic) */
  candles(symbol, resolution = 'D') {
    const base = MOCK_PRICES[symbol] || 100;
    const candles = [];
    let price = base * (0.75 + Math.random() * 0.1); // start ~75% of current
    const now = Math.floor(Date.now() / 1000);
    const step = resolution === 'D' ? 86400 : resolution === 'W' ? 86400 * 7 : 86400 * 30;
    const count = resolution === 'D' ? 250 : resolution === 'W' ? 104 : 36;

    for (let i = count; i >= 0; i--) {
      const ts = now - i * step;
      // Skip weekends for daily
      if (resolution === 'D') {
        const d = new Date(ts * 1000).getDay();
        if (d === 0 || d === 6) continue;
      }

      const volatility = 0.018 + Math.random() * 0.01;
      const drift = 0.0004; // slight upward drift
      const pct = (Math.random() - 0.48) * volatility + drift;
      const close = Math.max(1, price * (1 + pct));
      const open  = price;
      const high  = Math.max(open, close) * (1 + Math.random() * 0.006);
      const low   = Math.min(open, close) * (1 - Math.random() * 0.006);

      candles.push({
        time:   ts,
        open:   +open.toFixed(2),
        high:   +high.toFixed(2),
        low:    +low.toFixed(2),
        close:  +close.toFixed(2),
        volume: Math.floor(Math.random() * 50000000 + 3000000),
      });
      price = close;
    }
    return candles;
  },

  /* Mock multiple quotes */
  multipleQuotes(symbols) {
    return Object.fromEntries(symbols.map(s => [s, this.quote(s)]));
  }
};

/* ============================================================
   CHART MODULE — TradingView Lightweight Charts v3
   ============================================================ */
const CHART = {
  /* Initialize or re-initialize main stock chart */
  init() {
    const container = document.getElementById('chartContainer');
    if (!container) return;

    // Destroy existing chart
    if (STATE.chart) {
      try { STATE.chart.remove(); } catch(e) {}
      STATE.chart = null;
      STATE.series = null;
    }
    container.innerHTML = '';

    STATE.chart = LightweightCharts.createChart(container, {
      width:  container.clientWidth,
      height: container.clientHeight,
      layout: {
        backgroundColor: '#080a0f',
        textColor:       '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1a2238', style: 1 },
        horzLines: { color: '#1a2238', style: 1 },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#22d3ee', width: 1, style: 1, labelBackgroundColor: '#0e7490' },
        horzLine: { color: '#22d3ee', width: 1, style: 1, labelBackgroundColor: '#0e7490' },
      },
      rightPriceScale: {
        borderColor: '#1a2238',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor:     '#1a2238',
        timeVisible:     true,
        secondsVisible:  false,
        barSpacing:      8,
        rightOffset:     5,
        fixLeftEdge:     false,
        fixRightEdge:    true,
      },
      handleScroll:  true,
      handleScale:   true,
    });

    // Resize chart when window resizes
    const ro = new ResizeObserver(() => {
      if (STATE.chart) {
        STATE.chart.applyOptions({
          width:  container.clientWidth,
          height: container.clientHeight,
        });
      }
    });
    ro.observe(container);
  },

  /* Add the correct series based on chart type */
  addSeries(type) {
    if (!STATE.chart) return;
    // Remove previous series
    if (STATE.series) {
      try { STATE.chart.removeSeries(STATE.series); } catch(e) {}
      STATE.series = null;
    }

    switch (type) {
      case 'candlestick':
        STATE.series = STATE.chart.addCandlestickSeries({
          upColor:        '#10b981',
          downColor:      '#ef4444',
          borderUpColor:  '#10b981',
          borderDownColor:'#ef4444',
          wickUpColor:    '#10b981',
          wickDownColor:  '#ef4444',
        });
        break;

      case 'line':
        STATE.series = STATE.chart.addLineSeries({
          color:     '#22d3ee',
          lineWidth: 2,
          crosshairMarkerRadius:     5,
          crosshairMarkerBorderColor:'#22d3ee',
          crosshairMarkerBackgroundColor:'#0d1018',
          priceLineColor: 'rgba(34,211,238,0.3)',
          lastValueVisible: true,
        });
        break;

      case 'bar':
        STATE.series = STATE.chart.addBarSeries({
          upColor:   '#10b981',
          downColor: '#ef4444',
        });
        break;
    }
  },

  /* Load candle data into chart */
  setData(candles) {
    if (!STATE.series || !candles?.length) return;
    try {
      if (STATE.chartType === 'line') {
        // Line chart needs value not OHLC
        const lineData = candles.map(c => ({ time: c.time, value: c.close }));
        STATE.series.setData(lineData);
      } else {
        STATE.series.setData(candles);
      }
      STATE.chart.timeScale().fitContent();
    } catch(e) {
      console.warn('Chart set data error:', e);
    }
  },

  /* Switch chart type (candle/line/bar) */
  switchType(type) {
    STATE.chartType = type;
    this.addSeries(type);
    // Re-fetch and display data
    APP.loadChartData(STATE.activeSymbol);
  },

  /* Initialize portfolio performance chart */
  initPortfolio() {
    const container = document.getElementById('portfolioChartContainer');
    if (!container || STATE.portfolioChart) return;

    STATE.portfolioChart = LightweightCharts.createChart(container, {
      width:  container.clientWidth,
      height: 80,
      layout: { backgroundColor: 'transparent', textColor: '#475569' },
      grid:   { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale:  { visible: false },
      timeScale:       { visible: false },
      crosshair:       { mode: LightweightCharts.CrosshairMode.Magnet },
      handleScroll:    false,
      handleScale:     false,
    });

    STATE.portfolioSeries = STATE.portfolioChart.addAreaSeries({
      lineColor:    '#22d3ee',
      topColor:     'rgba(34,211,238,0.25)',
      bottomColor:  'rgba(34,211,238,0.0)',
      lineWidth:    2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Resize
    new ResizeObserver(() => {
      if (STATE.portfolioChart) {
        STATE.portfolioChart.applyOptions({ width: container.clientWidth });
      }
    }).observe(container);
  },

  /* Update portfolio chart with current snapshot data */
  updatePortfolio() {
    if (!STATE.portfolioSeries || STATE.portfolioHistory.length < 2) return;
    try {
      const data = STATE.portfolioHistory.map(s => ({
        time:  Math.floor(s.timestamp / 1000),
        value: s.value,
      }));
      // Ensure ascending time, deduplicate by second
      const seen = new Set();
      const deduped = data.filter(d => {
        if (seen.has(d.time)) return false;
        seen.add(d.time);
        return true;
      }).sort((a, b) => a.time - b.time);

      if (deduped.length >= 2) {
        STATE.portfolioSeries.setData(deduped);
        STATE.portfolioChart.timeScale().fitContent();
        // Color portfolio line based on gain/loss
        const first = deduped[0].value;
        const last  = deduped[deduped.length - 1].value;
        const isUp  = last >= first;
        STATE.portfolioSeries.applyOptions({
          lineColor:   isUp ? '#10b981' : '#ef4444',
          topColor:    isUp ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)',
          bottomColor: 'rgba(0,0,0,0)',
        });
      }
    } catch(e) {}
  },
};

/* ============================================================
   TRADING ENGINE
   ============================================================ */
const TRADING = {
  /* Execute a BUY order */
  buy(symbol, qty) {
    const price = STATE.currentPrices[symbol]?.c;
    if (!price || price <= 0) return { ok: false, msg: 'Price unavailable — wait for data' };

    qty = parseInt(qty);
    if (!qty || qty <= 0) return { ok: false, msg: 'Invalid quantity' };

    const cost = +(price * qty).toFixed(2);
    if (cost > STATE.balance) return { ok: false, msg: `Insufficient balance — need $${fmt(cost)}` };

    // Deduct balance
    STATE.balance = +(STATE.balance - cost).toFixed(2);

    // Update holdings (average cost basis)
    if (!STATE.holdings[symbol]) {
      STATE.holdings[symbol] = { shares: 0, avgCost: 0 };
    }
    const h = STATE.holdings[symbol];
    const totalShares = h.shares + qty;
    h.avgCost = +((h.avgCost * h.shares + price * qty) / totalShares).toFixed(4);
    h.shares  = totalShares;

    // Record trade
    STATE.tradeHistory.unshift({
      id:        Date.now(),
      type:      'BUY',
      symbol,
      qty,
      price,
      total:     cost,
      timestamp: new Date().toISOString(),
    });

    STORAGE.save();
    APP.takePortfolioSnapshot();
    return { ok: true, msg: `✓ Bought ${qty} ${symbol} @ $${fmt(price)}` };
  },

  /* Execute a SELL order */
  sell(symbol, qty) {
    const price = STATE.currentPrices[symbol]?.c;
    if (!price || price <= 0) return { ok: false, msg: 'Price unavailable — wait for data' };

    qty = parseInt(qty);
    if (!qty || qty <= 0) return { ok: false, msg: 'Invalid quantity' };

    const holding = STATE.holdings[symbol];
    if (!holding || holding.shares < qty) {
      return { ok: false, msg: `You only hold ${holding?.shares || 0} shares` };
    }

    const proceeds = +(price * qty).toFixed(2);
    const costBasis = +(holding.avgCost * qty).toFixed(2);
    const realized  = +(proceeds - costBasis).toFixed(2);

    // Update balance & holdings
    STATE.balance = +(STATE.balance + proceeds).toFixed(2);
    holding.shares -= qty;
    if (holding.shares === 0) delete STATE.holdings[symbol];

    // Record trade
    STATE.tradeHistory.unshift({
      id:        Date.now(),
      type:      'SELL',
      symbol,
      qty,
      price,
      total:     proceeds,
      realized,
      timestamp: new Date().toISOString(),
    });

    STORAGE.save();
    APP.takePortfolioSnapshot();
    return { ok: true, msg: `✓ Sold ${qty} ${symbol} @ $${fmt(price)} | P&L: ${realized >= 0 ? '+' : ''}$${fmt(realized)}` };
  },

  /* Calculate total portfolio market value */
  portfolioValue() {
    let total = STATE.balance;
    for (const [sym, h] of Object.entries(STATE.holdings)) {
      const price = STATE.currentPrices[sym]?.c || 0;
      total += price * h.shares;
    }
    return +total.toFixed(2);
  },

  /* Calculate invested amount */
  investedAmount() {
    return Object.entries(STATE.holdings).reduce((sum, [sym, h]) => {
      const price = STATE.currentPrices[sym]?.c || 0;
      return sum + price * h.shares;
    }, 0);
  },

  /* Calculate P&L for a holding */
  holdingPnL(sym, h) {
    const price = STATE.currentPrices[sym]?.c || 0;
    const marketVal  = price * h.shares;
    const costBasis  = h.avgCost * h.shares;
    return { marketVal: +marketVal.toFixed(2), pnl: +(marketVal - costBasis).toFixed(2), pct: +((marketVal - costBasis) / costBasis * 100).toFixed(2) };
  },
};

/* ============================================================
   UI RENDERING MODULE
   ============================================================ */
const UI = {
  /* ── WATCHLIST ── */
  renderWatchlist() {
    const el = document.getElementById('watchlist');
    if (!el) return;

    el.innerHTML = STATE.watchlist.map(sym => {
      const q = STATE.currentPrices[sym];
      const name  = STOCK_NAMES[sym] || sym;
      const price = q ? `$${fmt(q.c)}`  : '—';
      const chg   = q ? (q.d >= 0 ? '+' : '') + fmt(q.d) : '';
      const pct   = q ? (q.dp >= 0 ? '+' : '') + q.dp.toFixed(2) + '%' : '';
      const cls   = !q ? '' : q.d >= 0 ? 'pos' : 'neg';
      const active= sym === STATE.activeSymbol ? 'active' : '';

      return `
        <div class="watch-item ${active}" data-sym="${sym}">
          <div class="watch-sym">${sym}</div>
          <div class="watch-price ${cls}">${price}</div>
          <div class="watch-name">${name}</div>
          <div class="watch-change ${cls}">${q ? `${chg} (${pct})` : 'Loading…'}</div>
        </div>`;
    }).join('');

    // Bind click events
    el.querySelectorAll('.watch-item').forEach(item => {
      item.addEventListener('click', () => {
        APP.selectStock(item.dataset.sym);
      });
    });
  },

  /* ── STOCK HEADER ── */
  updateStockHeader(sym) {
    const q = STATE.currentPrices[sym];
    const name = STOCK_NAMES[sym] || sym;

    document.getElementById('stockSymbol').textContent = sym;
    document.getElementById('stockName').textContent   = name;
    document.getElementById('orderSymbol').textContent = sym;

    if (!q) return;

    const priceEl  = document.getElementById('stockPrice');
    const changeEl = document.getElementById('stockChange');

    priceEl.textContent = `$${fmt(q.c)}`;
    changeEl.textContent= `${q.d >= 0 ? '+' : ''}$${fmt(q.d)} (${q.dp >= 0 ? '+' : ''}${q.dp.toFixed(2)}%)`;
    changeEl.className  = `price-change ${q.d >= 0 ? 'positive' : 'negative'}`;

    document.getElementById('statOpen').textContent = q.o ? `$${fmt(q.o)}` : '—';
    document.getElementById('statHigh').textContent = q.h ? `$${fmt(q.h)}` : '—';
    document.getElementById('statLow').textContent  = q.l ? `$${fmt(q.l)}` : '—';
    document.getElementById('statPrev').textContent = q.pc? `$${fmt(q.pc)}`:'—';
    document.getElementById('statVol').textContent  = q.v ? fmtVol(q.v)    :'—';

    document.getElementById('orderPrice').textContent = `$${fmt(q.c)}`;

    // Flash animation on price update
    const flashClass = (STATE.currentPrices[sym]?._prevC || 0) < q.c ? 'flash-green' : 'flash-red';
    priceEl.classList.remove('flash-green', 'flash-red');
    void priceEl.offsetWidth; // reflow
    priceEl.classList.add(flashClass);
  },

  /* ── TOP BAR PORTFOLIO STRIP ── */
  updatePortfolioStrip() {
    const total    = TRADING.portfolioValue();
    const invested = TRADING.investedAmount();
    const pnl      = +(total - CONFIG.startingBalance).toFixed(2);
    const ret      = +((pnl / CONFIG.startingBalance) * 100).toFixed(2);

    document.getElementById('portfolioTotal').textContent = `$${fmt(total)}`;
    document.getElementById('balanceDisplay').textContent = `$${fmt(STATE.balance)}`;
    document.getElementById('investedDisplay').textContent= `$${fmt(invested)}`;

    const pnlEl  = document.getElementById('pnlDisplay');
    const retEl  = document.getElementById('returnDisplay');
    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}$${fmt(Math.abs(pnl))}`;
    retEl.textContent = `${ret >= 0 ? '+' : ''}${ret}%`;
    pnlEl.className = `strip-value ${pnl >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
    retEl.className = `strip-value ${ret >= 0 ? 'pnl-pos' : 'pnl-neg'}`;
  },

  /* ── HOLDINGS LIST (sidebar) ── */
  renderHoldings() {
    const el = document.getElementById('holdingsList');
    const entries = Object.entries(STATE.holdings);

    document.getElementById('posCount').textContent = entries.length;

    if (!entries.length) {
      el.innerHTML = '<div class="empty-hint">No open positions</div>';
      return;
    }

    el.innerHTML = entries.map(([sym, h]) => {
      const { marketVal, pnl, pct } = TRADING.holdingPnL(sym, h);
      const cls = pnl >= 0 ? 'pos' : 'neg';
      const sign = pnl >= 0 ? '+' : '';
      return `
        <div class="holding-item" data-sym="${sym}">
          <div class="hi-top">
            <span class="hi-sym">${sym}</span>
            <span class="hi-shares">${h.shares} sh</span>
          </div>
          <div class="hi-bottom">
            <span class="hi-val">$${fmt(marketVal)}</span>
            <span class="hi-pnl ${cls}">${sign}$${fmt(Math.abs(pnl))} (${sign}${pct}%)</span>
          </div>
        </div>`;
    }).join('');

    // Click holding to select that stock
    el.querySelectorAll('.holding-item').forEach(item => {
      item.addEventListener('click', () => APP.selectStock(item.dataset.sym));
    });
  },

  /* ── ORDER PANEL ── */
  updateOrderPanel() {
    const sym = STATE.activeSymbol;
    const q   = STATE.currentPrices[sym];
    const qty = parseInt(document.getElementById('qtyInput').value) || 1;
    const price = q?.c || 0;
    const total = +(price * qty).toFixed(2);
    const side  = document.querySelector('.side-btn.active')?.dataset.side || 'buy';

    document.getElementById('orderPrice').textContent   = `$${fmt(price)}`;
    document.getElementById('totalCost').textContent    = `$${fmt(total)}`;
    document.getElementById('orderBalance').textContent = `$${fmt(STATE.balance)}`;

    // Usage bar
    const pct = Math.min(100, STATE.balance > 0 ? (total / STATE.balance) * 100 : 0);
    const fill= document.getElementById('usageFill');
    fill.style.width = pct + '%';
    fill.className = `usage-bar-fill ${pct > 90 ? 'over' : pct > 60 ? 'high' : ''}`;
    document.getElementById('usagePct').textContent = pct.toFixed(1) + '%';

    // Holding info for sell side
    const holding = STATE.holdings[sym];
    const hi = document.getElementById('holdingInfo');
    if (side === 'sell' && holding) {
      hi.style.display = 'flex';
      document.getElementById('holdingShares').textContent = `${holding.shares} shares @ $${fmt(holding.avgCost)}`;
    } else {
      hi.style.display = 'none';
    }
  },

  /* ── TRADE HISTORY ── */
  renderHistory() {
    const el = document.getElementById('historyList');
    if (!STATE.tradeHistory.length) {
      el.innerHTML = '<div class="empty-hint">No trades executed yet</div>';
      return;
    }

    el.innerHTML = STATE.tradeHistory.slice(0, 100).map(t => {
      const isBuy = t.type === 'BUY';
      const ts    = new Date(t.timestamp);
      const time  = ts.toLocaleDateString() + ' ' + ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const rl    = t.realized !== undefined ? ` · P&L: ${t.realized >= 0 ? '+' : ''}$${fmt(Math.abs(t.realized))}` : '';

      return `
        <div class="trade-entry ${isBuy ? 'buy-trade' : 'sell-trade'}">
          <div class="te-top">
            <span class="te-sym">${t.symbol}</span>
            <span class="te-type ${isBuy ? 'buy' : 'sell'}">${t.type}</span>
          </div>
          <div class="te-bottom">
            <span class="te-detail">${t.qty} sh @ $${fmt(t.price)}${rl}</span>
            <span class="te-total">$${fmt(t.total)}</span>
          </div>
          <div class="te-time">${time}</div>
        </div>`;
    }).join('');
  },

  /* ── PORTFOLIO PERFORMANCE SECTION ── */
  updatePortfolioPerf() {
    const history = STATE.portfolioHistory;
    const perfEmpty = document.getElementById('perfEmpty');
    const badge = document.getElementById('perfBadge');

    if (history.length < 2) {
      perfEmpty.style.display = 'flex';
      badge.textContent = '—';
      return;
    }
    perfEmpty.style.display = 'none';

    const first = history[0].value;
    const last  = history[history.length - 1].value;
    const pct   = +((last - first) / first * 100).toFixed(2);
    badge.textContent = `${pct >= 0 ? '+' : ''}${pct}%`;
    badge.className   = `perf-badge ${pct >= 0 ? 'pos' : 'neg'}`;
    CHART.updatePortfolio();
  },

  /* ── CLOCK ── */
  updateClock() {
    const now = new Date();
    const t   = now.toTimeString().slice(0, 8);
    const days  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const months= ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const d   = `${days[now.getDay()]} ${String(now.getDate()).padStart(2,'0')} ${months[now.getMonth()]}`;
    document.getElementById('clockTime').textContent = t;
    document.getElementById('clockDate').textContent = d;
  },

  /* ── API STATUS (settings modal) ── */
  updateApiStatus() {
    const dot = document.getElementById('apiDot');
    const txt = document.getElementById('apiStatusText');
    if (API.isKeySet()) {
      dot.className = 'api-dot connected';
      txt.textContent = 'API key is set — connected to Finnhub';
    } else {
      dot.className = 'api-dot demo';
      txt.textContent = 'No API key — running with simulated demo data';
    }
  },

  /* ── SETTINGS CHIPS ── */
  renderSettingsChips() {
    const el = document.getElementById('stockChips');
    if (!el) return;
    el.innerHTML = STATE.watchlist.map(sym => `
      <div class="stock-chip">
        <span>${sym}</span>
        <button class="chip-remove" data-sym="${sym}">×</button>
      </div>`).join('');
    el.querySelectorAll('.chip-remove').forEach(btn => {
      btn.addEventListener('click', () => APP.removeFromWatchlist(btn.dataset.sym));
    });
  },

  /* ── TOAST NOTIFICATIONS ── */
  toast(msg, type = 'info', duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent  = msg;
    el.className    = `toast ${type} show`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.className = 'toast'; }, duration);
  },

  /* ── CHART LOADING STATE ── */
  setChartLoading(show) {
    document.getElementById('chartLoading').style.display = show ? 'flex' : 'none';
  },

  /* ── CHART ERROR STATE ── */
  setChartError(show) {
    document.getElementById('chartError').style.display = show ? 'flex' : 'none';
    document.getElementById('demoBadge').style.display  = show ? 'block': 'none';
  },
};

/* ============================================================
   MAIN APP MODULE
   ============================================================ */
const APP = {
  async init() {
    // Load saved state from localStorage
    STORAGE.load();

    // Initialize charts
    CHART.init();
    CHART.addSeries(STATE.chartType);
    CHART.initPortfolio();

    // Start clock
    UI.updateClock();
    setInterval(UI.updateClock.bind(UI), 1000);

    // Render initial UI with placeholders
    UI.renderWatchlist();
    UI.renderHoldings();
    UI.renderHistory();
    UI.updatePortfolioStrip();
    UI.updatePortfolioPerf();

    // Restore chart type button states
    this.restoreChartControls();

    // Bind all event listeners
    this.bindEvents();

    // Fetch initial data
    await this.refreshAllQuotes();

    // Load chart for default symbol
    await this.loadChartData(STATE.activeSymbol);

    // Start auto-refresh
    this.startAutoRefresh();

    // Portfolio snapshot timer
    STATE.snapshotTimer = setInterval(() => {
      this.takePortfolioSnapshot();
    }, CONFIG.portfolioSnapshotInterval);

    // Take first snapshot
    this.takePortfolioSnapshot();

    console.log('%c⬡ QuantEdge Terminal Ready', 'color:#22d3ee; font-size:14px; font-weight:bold;');
    if (!API.isKeySet()) {
      console.log('%c⚠ No API key detected. Running in demo mode.\nSet your key on line 19 of script.js', 'color:#f59e0b;');
      UI.toast('Running in DEMO mode — add your Finnhub API key (line 19 of script.js)', 'info', 6000);
    }
  },

  /* ── SELECT A STOCK ── */
  async selectStock(sym) {
    if (!STATE.watchlist.includes(sym)) return;
    STATE.activeSymbol = sym;

    // Update active state in watchlist
    document.querySelectorAll('.watch-item').forEach(el => {
      el.classList.toggle('active', el.dataset.sym === sym);
    });

    UI.updateStockHeader(sym);
    UI.updateOrderPanel();
    await this.loadChartData(sym);
  },

  /* ── LOAD CHART DATA ── */
  async loadChartData(sym) {
    UI.setChartLoading(true);
    UI.setChartError(false);

    let candles = null;

    // Try real API first
    if (API.isKeySet()) {
      candles = await API.getCandles(sym, STATE.resolution);
    }

    // Fall back to mock data
    if (!candles) {
      STATE.isDemo = true;
      candles = MOCK.candles(sym, STATE.resolution);
      UI.setChartError(true);
    } else {
      STATE.isDemo = false;
    }

    // Re-add series (in case chart type changed)
    CHART.addSeries(STATE.chartType);
    CHART.setData(candles);
    UI.setChartLoading(false);
  },

  /* ── REFRESH ALL QUOTES ── */
  async refreshAllQuotes() {
    let quotes = {};

    if (API.isKeySet()) {
      quotes = await API.getMultipleQuotes(STATE.watchlist);
    }

    // Fill any missing with mock
    for (const sym of STATE.watchlist) {
      if (!quotes[sym] || !quotes[sym]?.c) {
        quotes[sym] = MOCK.quote(sym);
      }
      // Track previous price for flash animation
      if (STATE.currentPrices[sym]) {
        quotes[sym]._prevC = STATE.currentPrices[sym].c;
      }
    }

    STATE.currentPrices = { ...STATE.currentPrices, ...quotes };

    // Update UI
    UI.renderWatchlist();
    UI.updateStockHeader(STATE.activeSymbol);
    UI.renderHoldings();
    UI.updatePortfolioStrip();
    UI.updateOrderPanel();
  },

  /* ── START AUTO-REFRESH ── */
  startAutoRefresh() {
    if (STATE.refreshTimer) clearInterval(STATE.refreshTimer);
    STATE.refreshTimer = setInterval(async () => {
      // Refresh mock quotes even without API (simulates live price movement)
      if (!API.isKeySet()) {
        for (const sym of STATE.watchlist) {
          const q = MOCK.quote(sym);
          q._prevC = STATE.currentPrices[sym]?.c;
          STATE.currentPrices[sym] = q;
        }
        UI.renderWatchlist();
        UI.updateStockHeader(STATE.activeSymbol);
        UI.renderHoldings();
        UI.updatePortfolioStrip();
        UI.updateOrderPanel();
      } else {
        await this.refreshAllQuotes();
      }
    }, CONFIG.refreshInterval);
  },

  /* ── PORTFOLIO SNAPSHOT ── */
  takePortfolioSnapshot() {
    const value = TRADING.portfolioValue();
    STATE.portfolioHistory.push({ timestamp: Date.now(), value });
    // Keep last 1000 snapshots
    if (STATE.portfolioHistory.length > 1000) {
      STATE.portfolioHistory = STATE.portfolioHistory.slice(-1000);
    }
    STORAGE.save();
    UI.updatePortfolioPerf();
  },

  /* ── ADD TO WATCHLIST ── */
  addToWatchlist(sym) {
    sym = sym.toUpperCase().trim();
    if (!sym) return;
    if (STATE.watchlist.includes(sym)) {
      UI.toast(`${sym} is already in your watchlist`, 'info');
      return;
    }
    if (STATE.watchlist.length >= 20) {
      UI.toast('Watchlist limit reached (20 stocks)', 'error');
      return;
    }
    STATE.watchlist.push(sym);
    STATE.currentPrices[sym] = MOCK.quote(sym);
    STORAGE.save();
    UI.renderWatchlist();
    UI.renderSettingsChips();
    UI.toast(`${sym} added to watchlist`, 'success');
  },

  /* ── REMOVE FROM WATCHLIST ── */
  removeFromWatchlist(sym) {
    if (STATE.watchlist.length <= 1) {
      UI.toast('Must have at least 1 stock in watchlist', 'error');
      return;
    }
    STATE.watchlist = STATE.watchlist.filter(s => s !== sym);
    if (STATE.activeSymbol === sym) {
      STATE.activeSymbol = STATE.watchlist[0];
    }
    STORAGE.save();
    UI.renderWatchlist();
    UI.renderSettingsChips();
    UI.toast(`${sym} removed from watchlist`, 'info');
  },

  /* ── RESTORE CHART CONTROLS STATE ── */
  restoreChartControls() {
    // Chart type buttons
    document.querySelectorAll('[data-type]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === STATE.chartType);
    });
    // Resolution buttons
    document.querySelectorAll('[data-res]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.res === STATE.resolution);
    });
  },

  /* ── RESET ACCOUNT ── */
  resetAccount() {
    if (!confirm('⚠ This will reset your account to $10,000 and erase all trades. Are you sure?')) return;
    STATE.balance          = CONFIG.startingBalance;
    STATE.holdings         = {};
    STATE.tradeHistory     = [];
    STATE.portfolioHistory = [];
    STORAGE.save();
    UI.renderHoldings();
    UI.renderHistory();
    UI.updatePortfolioStrip();
    UI.updateOrderPanel();
    UI.updatePortfolioPerf();
    this.takePortfolioSnapshot();
    UI.toast('Account reset to $10,000', 'info');
    // Close modal
    document.getElementById('settingsModal').classList.remove('open');
  },

  /* ── BIND ALL EVENT LISTENERS ── */
  bindEvents() {
    /* Chart type buttons */
    document.getElementById('chartTypeGroup').addEventListener('click', e => {
      const btn = e.target.closest('[data-type]');
      if (!btn) return;
      document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CHART.switchType(btn.dataset.type);
    });

    /* Resolution buttons */
    document.getElementById('resGroup').addEventListener('click', e => {
      const btn = e.target.closest('[data-res]');
      if (!btn) return;
      document.querySelectorAll('[data-res]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.resolution = btn.dataset.res;
      this.loadChartData(STATE.activeSymbol);
    });

    /* Refresh chart button */
    document.getElementById('refreshChartBtn').addEventListener('click', () => {
      this.loadChartData(STATE.activeSymbol);
      this.refreshAllQuotes();
      UI.toast('Refreshing…', 'info', 1500);
    });

    /* Quantity buttons */
    document.getElementById('qtyMinus').addEventListener('click', () => {
      const inp = document.getElementById('qtyInput');
      inp.value = Math.max(1, parseInt(inp.value || 1) - 1);
      UI.updateOrderPanel();
    });
    document.getElementById('qtyPlus').addEventListener('click', () => {
      const inp = document.getElementById('qtyInput');
      inp.value = Math.min(9999, parseInt(inp.value || 1) + 1);
      UI.updateOrderPanel();
    });
    document.getElementById('qtyInput').addEventListener('input', () => UI.updateOrderPanel());

    /* Quick qty buttons */
    document.querySelectorAll('.qq-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('qtyInput').value = btn.dataset.qty;
        UI.updateOrderPanel();
      });
    });

    /* Buy/Sell toggle */
    document.getElementById('buyBtn').addEventListener('click', () => {
      document.getElementById('buyBtn').classList.add('active');
      document.getElementById('sellBtn').classList.remove('active');
      const execBtn = document.getElementById('executeBtn');
      execBtn.textContent = 'EXECUTE BUY ORDER';
      execBtn.classList.remove('sell-mode');
      UI.updateOrderPanel();
    });
    document.getElementById('sellBtn').addEventListener('click', () => {
      document.getElementById('sellBtn').classList.add('active');
      document.getElementById('buyBtn').classList.remove('active');
      const execBtn = document.getElementById('executeBtn');
      execBtn.textContent = 'EXECUTE SELL ORDER';
      execBtn.classList.add('sell-mode');
      UI.updateOrderPanel();
    });

    /* Execute order button */
    document.getElementById('executeBtn').addEventListener('click', () => {
      const sym  = STATE.activeSymbol;
      const qty  = parseInt(document.getElementById('qtyInput').value) || 0;
      const side = document.querySelector('.side-btn.active')?.dataset.side || 'buy';
      const msgEl= document.getElementById('orderMsg');

      const result = side === 'buy' ? TRADING.buy(sym, qty) : TRADING.sell(sym, qty);

      // Show message
      msgEl.textContent  = result.msg;
      msgEl.className    = `order-msg ${result.ok ? 'success' : 'error'}`;
      setTimeout(() => { msgEl.className = 'order-msg'; }, 3000);

      if (result.ok) {
        UI.renderHoldings();
        UI.updatePortfolioStrip();
        UI.updateOrderPanel();
        UI.renderHistory();
        UI.toast(result.msg, 'success');
      } else {
        UI.toast(result.msg, 'error');
      }
    });

    /* Panel tabs */
    document.querySelectorAll('.ptab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.ptab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`ptab-${tab.dataset.ptab}`).classList.add('active');
      });
    });

    /* Settings modal */
    document.getElementById('settingsBtn').addEventListener('click', () => {
      UI.updateApiStatus();
      UI.renderSettingsChips();
      // Set radio to current chart type
      document.querySelectorAll('[name="settChart"]').forEach(r => {
        r.checked = r.value === STATE.chartType;
      });
      document.getElementById('settingsModal').classList.add('open');
    });
    document.getElementById('settingsClose').addEventListener('click', () => {
      document.getElementById('settingsModal').classList.remove('open');
    });
    document.getElementById('settingsModal').addEventListener('click', e => {
      if (e.target === document.getElementById('settingsModal')) {
        document.getElementById('settingsModal').classList.remove('open');
      }
    });

    /* Settings chart type radio */
    document.querySelectorAll('[name="settChart"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) {
          document.querySelectorAll('[data-type]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === r.value);
          });
          CHART.switchType(r.value);
        }
      });
    });

    /* Settings: add symbol */
    document.getElementById('addSymBtn').addEventListener('click', () => {
      const inp = document.getElementById('newSymInput');
      this.addToWatchlist(inp.value);
      inp.value = '';
    });
    document.getElementById('newSymInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        this.addToWatchlist(e.target.value);
        e.target.value = '';
      }
    });

    /* Settings: reset account */
    document.getElementById('resetBtn').addEventListener('click', () => this.resetAccount());

    /* Add to watchlist button (sidebar) */
    document.getElementById('addWatchBtn').addEventListener('click', () => {
      document.getElementById('quickAddModal').classList.add('open');
      document.getElementById('quickSymInput').focus();
    });
    document.getElementById('quickAddClose').addEventListener('click', () => {
      document.getElementById('quickAddModal').classList.remove('open');
    });
    document.getElementById('quickAddModal').addEventListener('click', e => {
      if (e.target === document.getElementById('quickAddModal')) {
        document.getElementById('quickAddModal').classList.remove('open');
      }
    });
    document.getElementById('quickAddConfirm').addEventListener('click', () => {
      const inp = document.getElementById('quickSymInput');
      this.addToWatchlist(inp.value);
      inp.value = '';
      document.getElementById('quickAddModal').classList.remove('open');
    });
    document.getElementById('quickSymInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        this.addToWatchlist(e.target.value);
        e.target.value = '';
        document.getElementById('quickAddModal').classList.remove('open');
      }
    });

    /* Clear history */
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      if (!STATE.tradeHistory.length) return;
      if (!confirm('Clear all trade history?')) return;
      STATE.tradeHistory = [];
      STORAGE.save();
      UI.renderHistory();
      UI.toast('Trade history cleared', 'info');
    });

    /* Keyboard shortcut: Escape closes modals */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      }
    });

    /* Auto-uppercase stock inputs */
    ['newSymInput','quickSymInput'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', e => {
        const pos = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(pos, pos);
      });
    });
  },
};

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

/* Format number with commas and 2 decimal places */
function fmt(n) {
  if (n === undefined || n === null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Format volume (e.g., 55.2M, 1.2B) */
function fmtVol(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

/* ============================================================
   LAUNCH THE APP 🚀
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  APP.init().catch(console.error);
});

/* ============================================================
   HOW TO USE YOUR API KEY:
   ─────────────────────────────────────────────────────────
   1. Visit https://finnhub.io/register and sign up (FREE)
   2. Go to your dashboard and copy the API token
   3. Find LINE 19 in this file (search for API_KEY)
   4. Replace 'YOUR_FINNHUB_API_KEY_HERE' with your token
      Example: const API_KEY = 'cq1234567890abcdef';
   5. Save the file and reload the page
   6. The DEMO badge will disappear and live data will load
   ─────────────────────────────────────────────────────────
   FREE TIER LIMITS (Finnhub):
   • 60 API calls / minute
   • Real-time US stock quotes
   • Historical daily/weekly/monthly candles
   • No credit card required
   ============================================================ */
