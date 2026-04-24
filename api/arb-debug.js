// Debug: Check no_ask_size_fp for KD assist market on Kalshi
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBAAST&limit=100`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const durant = (d.markets||[]).filter(m => /durant/i.test(m.title||''));

  return res.status(200).json({
    durant_markets: durant.map(m => ({
      title: m.title,
      yes_ask: m.yes_ask_dollars,
      yes_ask_size: m.yes_ask_size_fp,
      no_ask: m.no_ask_dollars,
      no_ask_size: m.no_ask_size_fp,
      no_bid: m.no_bid_dollars,
      no_bid_size: m.no_bid_size_fp,
      can_actually_buy_no: parseFloat(m.no_ask_size_fp||0) > 0,
    }))
  });
}
