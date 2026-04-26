export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const gql = async (q) => {
    const r = await fetch('https://api.novig.us/v1/graphql', {
      method: 'POST', headers,
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(10000),
    });
    return r.json();
  };

  // Get open pregame events with markets
  const result = await gql(`{
    event(
      where: {
        status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] }
      }
      limit: 10
    ) {
      id
      description
      league
      status
      scheduled_start
      type
      game {
        id
        sport
        awayTeam { id name short_name }
        homeTeam { id name short_name }
        scheduled_start
        spreadStrike
        totalStrike
        moneyAway
        moneyHome
      }
      markets(
        where: {
          status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] }
          type: { _in: ["MONEY", "SPREAD", "TOTAL", "MONEYLINE"] }
        }
      ) {
        id
        type
        status
        strike
        description
        outcomes {
          id
          index
          description
          available
          last
          type
        }
      }
    }
  }`);

  const events = result?.data?.event || [];

  // Get batch orderbook for first market found
  const firstMarket = events?.[0]?.markets?.[0];
  let book = null;
  if (firstMarket?.id) {
    const r = await fetch(
      `https://api.novig.us/nbx/v1/markets/book/batch?marketIds=${firstMarket.id}&currency=CASH`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    book = await r.json();
  }

  return res.status(200).json({
    events_count: events.length,
    events_summary: events.map(e => ({
      description: e.description,
      league: e.league,
      game: e.game ? `${e.game.awayTeam?.name} @ ${e.game.homeTeam?.name}` : null,
      sport: e.game?.sport,
      market_count: e.markets?.length,
      market_types: [...new Set(e.markets?.map(m => m.type))],
    })),
    sample_event_full: events[0],
    sample_book: book?.[0],
    errors: result?.errors,
  });
}
