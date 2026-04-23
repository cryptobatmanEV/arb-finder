// Kalshi — fetch daily game markets using correct series tickers
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

// Daily game series — NOT season futures (KXNBA, KXMLB etc.)
const SERIES = [
  // NBA daily
  'KXNBAGAME','KXNBASPREAD','KXNBATOTAL','KXNBAPTS','KXNBAREB','KXNBAAST','KXNBA3PT','KXNBASTL','KXNBABLK',
  // MLB daily
  'KXMLBGAME','KXMLBSPREAD','KXMLBTOTAL','KXMLBHITS','KXMLBPITCH','KXMLBHR','KXMLBRBI','KXNRFI',
  // NFL daily
  'KXNFLGAME','KXNFLSPREAD','KXNFLTOTAL','KXNFLPTS','KXNFLPASS','KXNFLRUSH','KXNFLREC',
  // NHL daily
  'KXNHLGAME','KXNHLSPREAD','KXNHLTOTAL','KXNHLGOALS',
  // Soccer daily
  'KXSOCCERGAME','KXSOCCERTOTAL',
  // Crypto daily
  'KXBTC','KXETH','KXSOL',
  // Macro daily
  'KXSPX','KXNASD','KXOIL','KXGOLD',
];

async function fetchSeries(ticker) {
  try {
    const params = new URLSearchParams({ series_ticker: ticker, limit: '200' });
    const res = await fetch(`${BASE}/markets?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.markets || []).filter(m => 
      !m.mve_collection_ticker && 
      m.market_type === 'binary' &&
      m.status === 'active'
    );
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const results = await Promise.allSettled(SERIES.map(fetchSeries));
    const allMarkets = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Deduplicate
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
