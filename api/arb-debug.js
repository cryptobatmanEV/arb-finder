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

  // Get recent events with NO filter to see what statuses exist
  const r1 = await gql(`{
    event(limit: 10, order_by: { scheduled_start: desc }) {
      id
      description
      league
      status
      type
      scheduled_start
      game {
        awayTeam { name short_name }
        homeTeam { name short_name }
        sport
        status
      }
      markets_aggregate { aggregate { count } }
    }
  }`);

  // Also check distinct statuses
  const r2 = await gql(`{
    event(distinct_on: status) {
      status
    }
  }`);

  const r3 = await gql(`{
    market(distinct_on: type, limit: 20) {
      type
      status
    }
  }`);

  return res.status(200).json({
    recent_events: r1?.data?.event,
    distinct_statuses: r2?.data?.event?.map(e => e.status),
    market_types: r3?.data?.market,
    errors: [...(r1?.errors||[]), ...(r2?.errors||[]), ...(r3?.errors||[])],
  });
}
