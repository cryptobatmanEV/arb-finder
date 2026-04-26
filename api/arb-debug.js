// Debug: Test Novig Bearer token + find markets listing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const results = {};

  // 1. Test the batch orderbook endpoint with a known market ID from the URL
  try {
    const r = await fetch(
      'https://api.novig.us/nbx/v1/markets/book/batch?marketIds=315ef4fb-7281-45a6-850c-276c3674c25c&currency=CASH',
      { headers, signal: AbortSignal.timeout(8000) }
    );
    const d = await r.json();
    results['batch_orderbook'] = {
      status: r.status,
      type: Array.isArray(d) ? `array(${d.length})` : typeof d,
      keys: typeof d === 'object' && !Array.isArray(d) ? Object.keys(d).slice(0,15) : null,
      sample: Array.isArray(d) ? d[0] : d,
    };
  } catch(e) { results['batch_orderbook'] = { error: e.message }; }

  // 2. Test GraphQL to get all active markets
  const eventsQuery = `{
    events(where: {status: {_eq: "ACTIVE"}}, limit: 5) {
      id title sport status
      markets {
        id title market_type
        best_ask best_bid
        outcomes { id title probability }
      }
    }
  }`;

  try {
    const r = await fetch('https://api.novig.us/v1/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: eventsQuery }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    results['graphql_events'] = {
      status: r.status,
      data: d,
    };
  } catch(e) { results['graphql_events'] = { error: e.message }; }

  // 3. Try REST markets listing endpoints
  const endpoints = [
    '/nbx/v1/markets?status=ACTIVE&limit=10',
    '/nbx/v1/events?status=ACTIVE&limit=10',
    '/nbx/v1/markets/open',
    '/v1/markets',
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(`https://api.novig.us${ep}`, {
        headers, signal: AbortSignal.timeout(6000)
      });
      const text = await r.text();
      let d; try { d = JSON.parse(text); } catch { d = text.slice(0,200); }
      results[ep] = {
        status: r.status,
        type: Array.isArray(d) ? `array(${d.length})` : typeof d,
        keys: typeof d === 'object' && !Array.isArray(d) ? Object.keys(d).slice(0,10) : null,
        sample: Array.isArray(d) ? d[0] : d,
      };
    } catch(e) { results[ep] = { error: e.message }; }
  }

  return res.status(200).json({
    token_set: TOKEN.length > 0,
    token_length: TOKEN.length,
    results,
  });
}
