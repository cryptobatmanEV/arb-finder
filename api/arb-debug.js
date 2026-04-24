// Debug: Verify fee rate on prop markets (fee_type: "quadratic" vs "quadratic_with_maker_fees")
// Need actual contract counts to reverse-engineer the base rate
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA  = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get active prop markets at various prices
  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBAPTS&limit=50`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const mkts = (d.markets||[])
    .filter(m => m.status==='active' && !m.mve_collection_ticker)
    .slice(0, 10)
    .map(m => ({
      ticker: m.ticker,
      title: m.title,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
      yes_ask_size: m.yes_ask_size_fp,
      // Show what 7% fee would give vs what we'd need to verify
      at_7pct: {
        yes_true_cost: parseFloat((parseFloat(m.yes_ask_dollars) + 0.07 * parseFloat(m.yes_ask_dollars) * (1 - parseFloat(m.yes_ask_dollars))).toFixed(4)),
        no_true_cost:  parseFloat((parseFloat(m.no_ask_dollars)  + 0.07 * parseFloat(m.no_ask_dollars)  * (1 - parseFloat(m.no_ask_dollars))).toFixed(4)),
      },
      // Also check Kalshi docs endpoint for this specific market
    }));

  // Check if Kalshi has a fee schedule endpoint
  const feeRes = await fetch(`${KALSHI}/series/KXNBAPTS`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
  });
  const feeSeries = feeRes.ok ? await feeRes.json() : null;

  return res.status(200).json({
    note: 'fee_type=quadratic (no maker fees) vs quadratic_with_maker_fees - need to verify if base rate differs',
    prop_series_info: {
      fee_multiplier: feeSeries?.series?.fee_multiplier,
      fee_type: feeSeries?.series?.fee_type,
      all_fields: feeSeries?.series ? Object.entries(feeSeries.series).filter(([k,v]) => v !== null && typeof v !== 'object') : []
    },
    sample_prop_markets: mkts,
    instruction: 'Pick any of these markets, go to Kalshi, enter $10 and note how many contracts you get. Reply with: ticker, price shown, contracts received for $10'
  });
}
