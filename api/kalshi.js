// Kalshi daily game markets — batched to avoid 429 rate limiting
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

const SERIES = [
  'KXNBAGAME','KXNBASPREAD','KXNBATOTAL','KXNBAPTS','KXNBAREB','KXNBAAST','KXNBA3PT',
  'KXMLBGAME','KXMLBSPREAD','KXMLBTOTAL','KXMLBHITS','KXMLBPITCH','KXMLBHR','KXNRFI',
  'KXNFLGAME','KXNFLSPREAD','KXNFLTOTAL',
  'KXNHLGAME','KXNHLSPREAD','KXNHLTOTAL',
  'KXBTC','KXETH','KXSPX','KXNASD',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchSeries(ticker) {
  try {
    const params = new URLSearchParams({ series_ticker: ticker, limit: '200' });
    const res = await fetch(`${BASE}/markets?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) return { markets: [], rateLimited: true };
    if (!res.ok) return { markets: [], error: res.status };
    const data = await res.json();
    const markets = (data.markets || []).filter(m =>
      !m.mve_collection_ticker &&
      m.market_type === 'binary' &&
      m.status === 'active'
    );
    return { markets };
  } catch { return { markets: [] }; }
}

async function fetchInBatches(series, batchSize = 5, delayMs = 300) {
  const all = [];
  for (let i = 0; i < series.length; i += batchSize) {
    const batch = series.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchSeries));
    results.forEach(r => all.push(...r.markets));
    if (i + batchSize < series.length) await sleep(delayMs);
  }
  return all;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const allMarkets = await fetchInBatches(SERIES, 5, 300);

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
