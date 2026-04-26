// Debug: Verify Novig proxy returns correct data
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`https://${req.headers.host}/api/novig`, {
    signal: AbortSignal.timeout(25000),
  });
  const d = await r.json();

  const events = d.events || [];
  return res.status(200).json({
    status: r.status,
    total_events: d.total,
    total_markets: d.markets,
    books_fetched: d.books_fetched,
    error: d.error,
    sample_event: events[0] ? {
      description: events[0].description,
      league: events[0].league,
      game: events[0].game ? `${events[0].game.awayTeam?.name} @ ${events[0].game.homeTeam?.name}` : null,
      markets: events[0].markets?.slice(0,3).map(m => ({
        type: m.type,
        description: m.description,
        strike: m.strike,
        outcomes: m.outcomes?.map(o => ({
          description: o.description,
          price: o.price,
          liveBid: o.liveBid,
          last: o.last,
        })),
      })),
    } : null,
  });
}
