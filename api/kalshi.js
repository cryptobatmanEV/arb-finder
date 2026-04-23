// Kalshi public API — no auth required
// Source: https://docs.kalshi.com/getting_started/quick_start_market_data

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=200';

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({ error: `Kalshi HTTP ${upstream.status}: ${body}`, platform: 'kalshi' });
    }

    return res.status(200).json(await upstream.json());
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'kalshi' });
  }
}
