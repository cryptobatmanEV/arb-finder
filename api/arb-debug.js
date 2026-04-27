// Debug: Find which Novig endpoint is returning 404
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const results = {};

  // Test GraphQL endpoint
  const r1 = await fetch('https://api.novig.us/v1/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: '{ market(limit: 1) { id type status } }' }),
    signal: AbortSignal.timeout(8000),
  });
  results['v1/graphql'] = { status: r1.status, ok: r1.ok };

  // Test book endpoint
  const r2 = await fetch('https://api.novig.us/nbx/v1/markets/book/batch?marketIds=test&currency=CASH', {
    headers, signal: AbortSignal.timeout(8000),
  });
  results['nbx/v1/book'] = { status: r2.status, ok: r2.ok };

  // Check what the novig proxy actually returns
  const r3 = await fetch(`https://${req.headers.host}/api/novig`, {
    signal: AbortSignal.timeout(25000),
  });
  const d3 = await r3.json();
  results['proxy_response'] = { status: r3.status, error: d3.error, total: d3.total };

  return res.status(200).json(results);
}
