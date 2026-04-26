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

  // Get distinct market statuses
  const statuses = await gql(`{
    market(distinct_on: status, limit: 20) {
      status
    }
  }`);

  // Get NBA event and ALL its markets regardless of status
  const nbaEvent = await gql(`{
    event(
      where: {
        league: { _eq: "NBA" }
        status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] }
      }
      limit: 1
    ) {
      id
      description
      league
      status
      markets(limit: 5) {
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
    all_market_statuses: statuses?.data?.market?.map(m => m.status),
    nba_event: nbaEvent?.data?.event?.[0],
    errors: [...(statuses?.errors||[]), ...(nbaEvent?.errors||[])],
  });
}
