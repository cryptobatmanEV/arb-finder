// Kalshi public API — no auth, paginated to fetch ALL markets
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const allMarkets = [];
    let cursor = '';
    let pages = 0;
    const MAX_PAGES = 20; // safety cap — 200 per page = up to 4000 markets

    while (pages < MAX_PAGES) {
      const params = new URLSearchParams({ limit: '200' });
      if (cursor) params.set('cursor', cursor);

      const upstream = await fetch(`${BASE}/markets?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!upstream.ok) {
        const body = await upstream.text();
        // Return whatever we have so far + the error
        if (allMarkets.length > 0) break;
        return res.status(upstream.status).json({ error: `Kalshi HTTP ${upstream.status}: ${body}`, platform: 'kalshi' });
      }

      const data = await upstream.json();
      const markets = data.markets || [];
      allMarkets.push(...markets);

      // Kalshi returns empty cursor when no more pages
      cursor = data.cursor || '';
      pages++;
      if (!cursor || markets.length < 200) break;
    }

    return res.status(200).json({ markets: allMarkets, total: allMarkets.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'kalshi' });
  }
}
