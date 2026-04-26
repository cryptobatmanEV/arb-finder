// Debug V3: Query Novig GraphQL with correct field names
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
      signal: AbortSignal.timeout(8000),
    });
    return r.json();
  };

  const results = {};

  // 1. Get active events with their markets
  results.events = await gql(`{
    event(
      where: { status: { _eq: "ACTIVE" } }
      limit: 5
      order_by: { start_time: asc }
    ) {
      id
      title
      sport
      status
      start_time
      markets {
        id
        title
        type
        status
        outcomes {
          id
          title
          index
        }
      }
    }
  }`).catch(e => ({ error: e.message }));

  // 2. Get active markets directly
  results.markets = await gql(`{
    market(
      where: { status: { _eq: "ACTIVE" } }
      limit: 5
    ) {
      id
      title
      type
      status
      event {
        id
        title
        sport
        start_time
      }
      outcomes {
        id
        title
        index
      }
    }
  }`).catch(e => ({ error: e.message }));

  // 3. Get a game to understand structure
  results.games = await gql(`{
    game(limit: 3) {
      id
      home_team
      away_team
      sport
      start_time
      event { id title }
    }
  }`).catch(e => ({ error: e.message }));

  return res.status(200).json(results);
}
