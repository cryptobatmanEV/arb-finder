// Debug: Confirm floor_strike field for CHC-SD MLB totals
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${KALSHI}/markets?series_ticker=KXMLBTOTAL&limit=20`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const chcsd = (d.markets||[]).filter(m => /CHCSD|SDCHC/i.test(m.ticker||''));

  return res.status(200).json({
    count: chcsd.length,
    markets: chcsd.map(m => ({
      ticker: m.ticker,
      title: m.title,
      floor_strike: m.floor_strike,
      custom_strike: m.custom_strike,
      notional_value: m.notional_value_dollars,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
    }))
  });
}
