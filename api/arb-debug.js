// Debug: Check exact Gamma prices for SEA-MIN moneyline right now
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const slugs = ['mlb-sea-min-2026-04-27', 'mlb-min-sea-2026-04-27'];
  const results = {};

  for (const slug of slugs) {
    const r = await fetch(`${GAMMA}/events?slug=${slug}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const data = await r.json();
    const event = Array.isArray(data) ? data[0] : data;
    if (!event?.id) { results[slug] = 'not found'; continue; }

    results[slug] = {
      title: event.title,
      markets: event.markets?.map(m => ({
        question: m.question,
        bestAsk: m.bestAsk,
        bestBid: m.bestBid,
        outcomePrices: m.outcomePrices,
        clobTokenIds: m.clobTokenIds,
        // What our proxy would compute
        yesPrice_raw: parseFloat(m.bestAsk || 0),
        noPrice_raw: parseFloat(m.bestBid || 0) > 0.01 ? (1 - parseFloat(m.bestBid)).toFixed(3) : 'NO BID',
      }))
    };
  }

  return res.status(200).json(results);
}
