export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const stocks = {
    '005935.KS': 150300,
    '005930.KS': 188700,
    '353200.KS': 71200,
    '240810.KQ': 66700,
    'AMD': 449.04
  };
  let tltPrice = 81.92;
  let us10y = 4.86;
  let ddr5Price = 60.17;
  let ddr416gPrice = 80.82;

  async function fetchYahooQuote(symbol) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!r.ok) return null;
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      return typeof price === 'number' ? price : null;
    } catch {
      return null;
    }
  }

  await Promise.all([
    ...Object.keys(stocks).map(async (sym) => {
      const p = await fetchYahooQuote(sym);
      if (p !== null) stocks[sym] = p;
    }),
    (async () => {
      const p = await fetchYahooQuote('TLT');
      if (p !== null) tltPrice = p;
    })(),
    (async () => {
      const p = await fetchYahooQuote('^TNX');
      if (p !== null) us10y = p;
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
    stocks
  });
}
