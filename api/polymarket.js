// Polymarket Gamma API — paginated to fetch ALL active markets
const BASE = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const allMarkets = [];
    let offset = 0;
    const limit = 500;
    const MAX_PAGES = 10; // up to 5000 markets

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        active: 'true',
        closed: 'false',
        limit: String(limit),
        offset: String(offset),
      });

      const upstream = await fetch(`${BASE}/markets?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!upstream.ok) {
        if (allMarkets.length > 0) break;
        return res.status(upstream.status).json({ error: `Polymarket HTTP ${upstream.status}`, platform: 'polymarket' });
      }

      const data = await upstream.json();
      const markets = Array.isArray(data) ? data : (data.data || data.markets || []);
      allMarkets.push(...markets);

      offset += limit;
      if (markets.length < limit) break; // last page
    }

    return res.status(200).json(allMarkets);
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
