// Debug: Get ALL price fields Polymarket returns for KD assists market
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const pmRes = await fetch(`${GAMMA}/events?slug=nba-lal-hou-2026-04-24&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const pmData = await pmRes.json();
  const event  = Array.isArray(pmData) ? pmData[0] : pmData;
  const kdMkt  = (event?.markets||[]).find(m => /kevin durant.*assists/i.test(m.question||''));

  if (!kdMkt) return res.status(200).json({ error: 'KD assists market not found' });

  // Return EVERY price-related field Polymarket provides
  const priceFields = {
    question: kdMkt.question,
    outcomePrices: kdMkt.outcomePrices,
    bestAsk: kdMkt.bestAsk,
    bestBid: kdMkt.bestBid,
    lastTradePrice: kdMkt.lastTradePrice,
    oneDayPriceChange: kdMkt.oneDayPriceChange,
    spread: kdMkt.spread,
    clobTokenIds: kdMkt.clobTokenIds,
    outcomes: kdMkt.outcomes,
    // Calculate what we're currently using vs what we should use
    current_yes_price: kdMkt.bestAsk,
    current_no_price: kdMkt.bestBid ? 1 - kdMkt.bestBid : null,
    correct_no_price_explanation: '1 - bestBid gives cost to buy NO via YES sellers. But Polymarket has separate YES and NO token order books. NO ask = cost of NO token = 1 - YES bestBid only if markets are efficient.',
    implied_sum_current: kdMkt.bestAsk && kdMkt.bestBid ? (kdMkt.bestAsk + (1 - kdMkt.bestBid)).toFixed(3) : null,
    implied_sum_correct: kdMkt.bestAsk && kdMkt.bestBid ? (kdMkt.bestAsk + kdMkt.bestBid).toFixed(3) : null,
    note: 'bestAsk + bestBid = total cost if you buy both YES and NO. Should be > 1.0 (vig). If < 1.0 = real arb.',
  };

  return res.status(200).json(priceFields);
}
