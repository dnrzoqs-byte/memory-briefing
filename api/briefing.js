export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const stocks = {
    '005935.KS': 170500,
    '005930.KS': 206000,
    '353200.KS': 91300,
    '240810.KQ': 77700,
    'AMD': 534.06,
    'CLS': 240.34
  };
  const high52w = {
    '005935.KS': 243500,
    '005930.KS': 374500,
    '353200.KS': 198000,
    '240810.KQ': 187800,
    'AMD': 658.52,
    'CLS': 474.03
  };
  const stocksDetail = {};
  const macro = {
    us10y: 5.15,
    us2y: 4.42,
    tlt_price: 79.38,
    wti_oil: 88.92,
    usdkrw: 1335.1,
    kr_base: 3.00,
    kr_10y: 3.85
  };

  async function fetchYahooRich(symbol, isKrw = false) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) return null;
      const j = await r.json();
      const resObj = j?.chart?.result?.[0];
      if (!resObj) return null;
      const meta = resObj.meta || {};
      const tsList = resObj.timestamp || [];
      const closesRaw = resObj.indicators?.quote?.[0]?.close || [];
      const pairs = [];
      for (let i = 0; i < tsList.length; i++) {
        const c = closesRaw[i];
        if (typeof c === 'number' && c > 0) {
          const dt = new Date((tsList[i] + 9 * 3600) * 1000);
          const lbl = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
          pairs.push([lbl, isKrw ? Math.round(c) : Number(c.toFixed(2))]);
        }
      }
      const p = typeof meta.regularMarketPrice === 'number'
        ? (isKrw ? Math.round(meta.regularMarketPrice) : Number(meta.regularMarketPrice.toFixed(2)))
        : (pairs.length ? pairs[pairs.length - 1][1] : null);
      if (pairs.length && p !== null) pairs[pairs.length - 1][1] = p;
      const recent = pairs.slice(-5);
      const recentDates = recent.map(x => x[0]);
      const recentCloses = recent.map(x => x[1]);
      const prev = recentCloses.length >= 2 ? recentCloses[recentCloses.length - 2] : (meta.chartPreviousClose || p);
      const chgPct = prev ? Number((((p - prev) / prev) * 100).toFixed(2)) : 0;
      const wkBase = recentCloses.length ? recentCloses[0] : prev;
      const wkPct = wkBase ? Number((((p - wkBase) / wkBase) * 100).toFixed(2)) : 0;
      return {
        price: p,
        prev_close: prev,
        change_pct: chgPct,
        week_change_pct: wkPct,
        high52w: meta.fiftyTwoWeekHigh ? (isKrw ? Math.round(meta.fiftyTwoWeekHigh) : Number(meta.fiftyTwoWeekHigh.toFixed(2))) : null,
        recent_dates: recentDates,
        recent_closes: recentCloses
      };
    } catch {
      return null;
    }
  }

  await Promise.all([
    ...Object.keys(stocks).map(async (sym) => {
      const isKrw = sym.endsWith('.KS') || sym.endsWith('.KQ');
      const info = await fetchYahooRich(sym, isKrw);
      if (info && info.price) {
        stocks[sym] = info.price;
        if (info.high52w) high52w[sym] = info.high52w;
        stocksDetail[sym] = info;
      }
    }),
    (async () => {
      const info = await fetchYahooRich('TLT', false);
      if (info?.price) {
        macro.tlt_price = info.price;
        macro.tlt_change_pct = info.change_pct;
      }
    })(),
    (async () => {
      const info = await fetchYahooRich('^TNX', false);
      if (info?.price) {
        macro.us10y = info.price;
        macro.us10y_change_pct = info.change_pct;
        macro.us10y_recent = info.recent_closes;
        macro.us10y_dates = info.recent_dates;
      }
    })(),
    (async () => {
      const info = await fetchYahooRich('CL=F', false);
      if (info?.price) {
        macro.wti_oil = info.price;
        macro.wti_change_pct = info.change_pct;
      }
    })(),
    (async () => {
      const info = await fetchYahooRich('KRW=X', false);
      if (info?.price) {
        macro.usdkrw = Number(info.price.toFixed(1));
        macro.usdkrw_change_pct = info.change_pct;
      }
    })()
  ]);

  const nowKstDate = new Date(Date.now() + 9 * 3600 * 1000);
  const nowKst = nowKstDate.toISOString().replace('T', ' ').slice(0, 16) + ' KST';

  res.status(200).json({
    timestamp: nowKst,
    updated_at: nowKst,
    ddr5_price: 60.27,
    ddr4_16g_price: 79.50,
    ddr4_8g_price: 44.54,
    ddr5_mod_price: 243.33,
    macro,
    us10y: macro.us10y,
    tlt_price: macro.tlt_price,
    wti_oil: macro.wti_oil,
    usdkrw: macro.usdkrw,
    stocks,
    high52w,
    stocks_detail: stocksDetail
  });
}
