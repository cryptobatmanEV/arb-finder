// Debug: Compare outcomePrices vs bestAsk/bestBid for same market
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch the DET-ORL game we saw in the screenshot
  const r = await fetch(`${GAMMA}/events?slug=nba-det-orl-2026-04-25&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const data = await r.json();
  const event = Array.isArray(data) ? data[0] : data;
  const markets = (event?.markets || []).filter(m => /Cade|rebounds/i.test(m.question||''));

  const comparison = markets.map(m => ({
    question: m.question,
    outcomePrices: m.outcomePrices,   // what we're currently using — WRONG (last trade)
    bestBid: m.bestBid,               // current best bid
    bestAsk: m.bestAsk,               // current best ask — what you'd actually pay
    lastTradePrice: m.lastTradePrice, // last trade price
    note: 'bestAsk is what the tool should show — it is the real executable price',
  }));

  return res.status(200).json({ markets: comparison });
}
