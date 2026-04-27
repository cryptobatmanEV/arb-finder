// Debug: Compare liquidity_dollars between prop markets and game/spread markets
// Hypothesis: liquidity_dollars=0 means no market maker, limit order only (not immediately executable)
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const series = ['KXNBAAST', 'KXNBASPREAD', 'KXNBAGAME', 'KXNBATOTAL', 'KXNBAPTS', 'KXNBAREB'];
  const results = {};

  for (const s of series) {
    const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=5`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    const mkts = (d.markets || [])
      .filter(m => m.status === 'active' && !m.mve_collection_ticker)
      .slice(0, 3);

    results[s] = mkts.map(m => ({
      title: m.title,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
      yes_ask_size: m.yes_ask_size_fp,
      yes_bid_size: m.yes_bid_size_fp,
      liquidity_dollars: m.liquidity_dollars,
      sum: (parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0)).toFixed(3),
    }));
  }

  return res.status(200).json(results);
}
