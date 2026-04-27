// Debug: Test Novig proxy directly
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`https://${req.headers.host}/api/novig`, {
    signal: AbortSignal.timeout(25000),
  });
  const d = await r.json();

  return res.status(200).json({
    http_status: r.status,
    error: d.error || null,
    total_events: d.total,
    total_markets: d.markets,
    books_fetched: d.books_fetched,
    sample: d.events?.[0] ? {
      description: d.events[0].description,
      league: d.events[0].league,
      status: d.events[0].status,
      market_count: d.events[0].markets?.length,
      sample_market: d.events[0].markets?.[0],
    } : null,
  });
}
