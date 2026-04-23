// Temporary debug — visit /api/kalshi-debug to see raw Kalshi response fields
// Delete this file after diagnosing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=3';
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const data = await upstream.json();
    const markets = data.markets || data.data || (Array.isArray(data) ? data : []);
    const first = markets[0];
    return res.status(200).json({
      topLevelKeys: Object.keys(data),
      totalReturned: markets.length,
      firstMarketKeys: first ? Object.keys(first) : [],
      firstMarket: first,
    });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
