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

  // Get ALL distinct leagues that have open markets right now
  const leagues = await gql(`{
    event(
      where: { status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] } }
      distinct_on: league
    ) {
      league
    }
  }`);

  // Get open markets with NO league filter and show their events
  const openMarkets = await gql(`{
    market(
      where: { status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] } }
      limit: 20
    ) {
      id
      type
      status
      strike
      description
      event {
        id
        description
        league
        scheduled_start
      }
      outcomes {
        id
        index
        description
        last
        available
      }
    }
  }`);

  return res.status(200).json({
    open_leagues: leagues?.data?.event?.map(e => e.league),
    open_markets_count: openMarkets?.data?.market?.length,
    open_markets: openMarkets?.data?.market?.slice(0,5),
    errors: [...(leagues?.errors||[]), ...(openMarkets?.errors||[])],
  });
}
