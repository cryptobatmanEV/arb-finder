// Debug: Check exact Kalshi prices for CHC-SD totals
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${KALSHI}/markets?series_ticker=KXMLBTOTAL&limit=100`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const chcsd = (d.markets||[]).filter(m =>
    /chc|chi.*sd|san diego|chicago/i.test(m.title||'') ||
    /CHCSD|SDCHC/i.test(m.ticker||'')
  );

  return res.status(200).json({
    count: chcsd.length,
    markets: chcsd.map(m => ({
      ticker: m.ticker,
      title: m.title,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
      yes_bid: m.yes_bid_dollars,
      no_bid: m.no_bid_dollars,
      sum: parseFloat((parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0)).toFixed(3)),
      status: m.status,
    }))
  });
}
