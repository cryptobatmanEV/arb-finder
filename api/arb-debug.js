// Debug: Find Jokic assist market and check every available field
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBAAST&limit=200`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json();
  
  const jokic = (d.markets || []).filter(m => /jok/i.test(m.title || ''));

  // Return EVERY field for each Jokic market - no filtering
  return res.status(200).json({
    count: jokic.length,
    markets: jokic.map(m => ({
      ...m, // return everything the API gives us
      _computed_sum: (parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0)).toFixed(3),
      _computed_yes_bid_size: m.yes_bid_size_fp,
      _computed_yes_ask_size: m.yes_ask_size_fp,
    }))
  });
}
