// Kalshi — fetch by known series tickers to avoid MVE/parlay markets
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

// Known Kalshi series that produce real binary markets
const SERIES = [
  'KXNBA','KXMLB','KXNFL','KXNHL','KXNCAAB','KXNCAAF',
  'KXMMA','KXPGA','KXSOCCER','KXWNBA',
  'KXBTC','KXETH','KXSOL',
  'KXFED','KXCPI','KXUNEMPLOYMENT','KXGDP','KXSPX','KXNASD','KXOIL','KXGOLD',
  'KXPRES','KXSENATE','KXHOUSE','KXGOV',
  'KXHIGHNY','KXHIGHLAX','KXHIGHCHI',
];

async function fetchSeries(ticker) {
  const params = new URLSearchParams({ series_ticker: ticker, limit: '200' });
  const res = await fetch(`${BASE}/markets?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.markets || []).filter(m => !m.mve_collection_ticker && m.market_type === 'binary');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch all series in parallel
    const results = await Promise.allSettled(SERIES.map(fetchSeries));
    const allMarkets = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Deduplicate by ticker
    const seen = new Set();
    const unique = allMarkets.filter(m => {
      if (seen.has(m.ticker)) return false;
      seen.add(m.ticker);
      return true;
    });

    return res.status(200).json({ markets: unique, total: unique.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'kalshi' });
  }
}
