// Debug: Verify Novig gameKey matches Polymarket slug for CLE @ TOR
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Novig gives us: CLE @ TOR on 2026-04-26
  // Expected Polymarket slug: nba-cle-tor-2026-04-26
  const slug = 'nba-cle-tor-2026-04-26';

  const r = await fetch(`${GAMMA}/events?slug=${slug}&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  const event = Array.isArray(data) ? data[0] : data;

  return res.status(200).json({
    slug_tested: slug,
    found: !!event?.id,
    event_title: event?.title,
    market_count: event?.markets?.length,
    markets: event?.markets?.slice(0,3).map(m => ({
      question: m.question,
      bestAsk: m.bestAsk,
      bestBid: m.bestBid,
    })),
    note: 'If found=true, Novig gameKey matches Polymarket exactly'
  });
}
