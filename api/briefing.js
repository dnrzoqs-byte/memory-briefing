export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const stocks = {
    '005935.KS': 150900,
    '005930.KS': 189900,
    '353200.KS': 75200,
    '240810.KQ': 67300,
    'AMD': 449.04,
    'CLS': 206.68
  };
  const high52w = {
    '005935.KS': 243500,
    '005930.KS': 374500,
    '353200.KS': 198000,
    '240810.KQ': 187800,
    'AMD': 658.52,
    'CLS': 474.03
  };
  let tltPrice = 81.92;
  let us10y = 4.86;
  let wtiOil = 88.47;
  let ddr5Price = 60.17;
  let ddr416gPrice = 80.24;

  async function fetchYahooMeta(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j?.chart?.result?.[0]?.meta || null;
    } catch {
      return null;
    }
  }

  await Promise.all([
    ...Object.keys(stocks).map(async (sym) => {
      const m = await fetchYahooMeta(sym);
      if (m && typeof m.regularMarketPrice === 'number') stocks[sym] = m.regularMarketPrice;
      if (m && typeof m.fiftyTwoWeekHigh === 'number') high52w[sym] = m.fiftyTwoWeekHigh;
    }),
    (async () => {
      const m = await fetchYahooMeta('TLT');
      if (m && typeof m.regularMarketPrice === 'number') tltPrice = m.regularMarketPrice;
    })(),
    (async () => {
      const m = await fetchYahooMeta('^TNX');
      if (m && typeof m.regularMarketPrice === 'number') us10y = m.regularMarketPrice;
    })(),
    (async () => {
      const m = await fetchYahooMeta('CL=F');
      if (m && typeof m.regularMarketPrice === 'number') wtiOil = m.regularMarketPrice;
    })()
  ]);

  const nowKst = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16) + ' KST';

  res.status(200).json({
    timestamp: nowKst,
    ddr5_price: ddr5Price,
    ddr4_16g_price: ddr416gPrice,
    us10y: Number(us10y.toFixed(2)),
    tlt_price: Number(tltPrice.toFixed(2)),
    wti_oil: Number(wtiOil.toFixed(1)),
    stocks,
    high52w
  });
}
