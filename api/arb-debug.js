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

  // First get competitor fields
  const compFields = await gql(`{ __type(name: "competitor") { fields { name } } }`);
  const competitorFields = compFields?.data?.__type?.fields?.map(f => f.name);

  // Get player fields too
  const playerFields_r = await gql(`{ __type(name: "player") { fields { name } } }`);
  const playerFields = playerFields_r?.data?.__type?.fields?.map(f => f.name);

  // Now query events with correct competitor fields
  const eventsResult = await gql(`{
    event(
      where: {
        status: { _eq: "ACTIVE" }
        league: { _in: ["NBA", "MLB", "NFL", "NHL"] }
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
        awayTeam { id name }
        homeTeam { id name }
        scheduled_start
        spreadStrike
        totalStrike
        moneyAway
        moneyHome
      }
      markets(where: { status: { _eq: "ACTIVE" } }) {
        id
        type
        status
        strike
        description
        competitor { id name }
        player { id name }
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

  const events = eventsResult?.data?.event || [];
  const sampleMarketId = events?.[0]?.markets?.[0]?.id;

  let bookResult = null;
  if (sampleMarketId) {
    const r = await fetch(
      `https://api.novig.us/nbx/v1/markets/book/batch?marketIds=${sampleMarketId}&currency=CASH`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    bookResult = await r.json();
  }

  return res.status(200).json({
    competitor_fields: competitorFields,
    player_fields: playerFields,
    events_count: events.length,
    sample_event: events[0],
    all_events_summary: events.map(e => ({
      id: e.id,
      description: e.description,
      league: e.league,
      game: e.game ? `${e.game.awayTeam?.name} @ ${e.game.homeTeam?.name}` : null,
      market_types: [...new Set(e.markets?.map(m => m.type))],
      market_count: e.markets?.length,
    })),
    sample_book: bookResult?.[0],
    errors: eventsResult?.errors,
  });
}
