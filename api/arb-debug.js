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

  // Find all distinct market types that are currently open
  const openTypes = await gql(`{
    market(
      where: { status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] } }
      distinct_on: type
    ) {
      type
      status
      description
      event {
        description
        league
      }
    }
  }`);

  // Also get NBA events without market filter to see their market types
  const nbaEvents = await gql(`{
    event(
      where: {
        status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] }
        league: { _in: ["NBA", "MLB", "NHL", "NFL"] }
      }
      limit: 5
    ) {
      id
      description
      league
      markets {
        id
        type
        status
        strike
        description
        outcomes {
          id
          index
          description
          last
          available
        }
      }
    }
  }`);

  return res.status(200).json({
    open_market_types: openTypes?.data?.market?.map(m => ({
      type: m.type,
      event: m.event?.description,
      league: m.event?.league,
    })),
    nba_events: nbaEvents?.data?.event?.map(e => ({
      description: e.description,
      league: e.league,
      markets: e.markets?.slice(0,3),
    })),
    errors: [...(openTypes?.errors||[]), ...(nbaEvents?.errors||[])],
  });
}
