// Debug: Test Novig endpoints directly - no proxy call
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Test GraphQL
  const r1 = await fetch('https://api.novig.us/v1/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: '{ event(limit: 2, where: { type: { _eq: "Game" }, status: { _in: ["OPEN_PREGAME"] }, league: { _in: ["NBA","MLB"] } }) { id description league status markets(where: { status: { _in: ["OPEN","OPEN_PREGAME"] } }, limit: 2) { id type status } } }' }),
    signal: AbortSignal.timeout(10000),
  });
  const d1 = await r1.json();

  return res.status(200).json({
    graphql_status: r1.status,
    events: d1?.data?.event?.length,
    sample: d1?.data?.event?.[0],
    errors: d1?.errors,
  });
}
