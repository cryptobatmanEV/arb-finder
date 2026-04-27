// Debug: Check exact Kalshi API values for Jaylen Brown assists markets
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBAAST&limit=100`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json();
  const brown = (d.markets || []).filter(m => /brown/i.test(m.title || ''));

  return res.status(200).json({
    brown_markets: brown.map(m => ({
      ticker: m.ticker,
      title: m.title,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
      sum: (parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0)).toFixed(3),
      passes_101: (parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0)) <= 1.01,
      status: m.status,
    })),
  });
}
