// Debug: Show ALL Polymarket market questions for an MLB game
// to see exactly what types exist and how they're titled
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${GAMMA}/events?slug=mlb-sea-min-2026-05-04&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  const event = Array.isArray(data) ? data[0] : data;

  return res.status(200).json({
    event_title: event?.title,
    slug: event?.slug,
    market_count: event?.markets?.length,
    all_questions: event?.markets?.map(m => ({
      question: m.question,
      bestAsk: m.bestAsk,
      bestBid: m.bestBid,
      outcomePrices: m.outcomePrices,
    })),
  });
}
