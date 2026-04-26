// Debug V5: Query Novig with correct field names - get real market data
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const gql = async (query) => {
    const r = await fetch('https://api.novig.us/v1/graphql', {
      method: 'POST', headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });
    return r.json();
  };

  // Get active NBA events with markets and outcomes
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
        awayTeam { id name abbreviation }
        homeTeam { id name abbreviation }
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

  // Also get the batch orderbook for a sample market to understand live prices
  const sampleMarketId = eventsResult?.data?.event?.[0]?.markets?.[0]?.id;
  let bookResult = null;
  if (sampleMarketId) {
    const r = await fetch(
      `https://api.novig.us/nbx/v1/markets/book/batch?marketIds=${sampleMarketId}&currency=CASH`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    bookResult = await r.json();
  }

  return res.status(200).json({
    events_count: eventsResult?.data?.event?.length,
    sample_event: eventsResult?.data?.event?.[0],
    all_events_summary: eventsResult?.data?.event?.map(e => ({
      id: e.id,
      description: e.description,
      league: e.league,
      scheduled_start: e.scheduled_start,
      market_count: e.markets?.length,
      market_types: [...new Set(e.markets?.map(m => m.type))],
    })),
    sample_book: bookResult,
    errors: eventsResult?.errors,
  });
}
