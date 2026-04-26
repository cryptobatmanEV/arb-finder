// Debug V2: Find Novig markets listing endpoint
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

  // Try GraphQL introspection to find correct field names
  const introspectQuery = `{ __schema { queryType { fields { name description } } } }`;
  try {
    const r = await fetch('https://api.novig.us/v1/graphql', {
      method: 'POST', headers,
      body: JSON.stringify({ query: introspectQuery }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    results['graphql_schema'] = {
      status: r.status,
      fields: d?.data?.__schema?.queryType?.fields?.map(f => f.name),
    };
  } catch(e) { results['graphql_schema'] = { error: e.message }; }

  // Try REST endpoints based on app URL patterns
  const endpoints = [
    '/nbx/v1/fixtures?status=ACTIVE&limit=10',
    '/nbx/v1/competitions?limit=10',
    '/nbx/v1/events',
    '/nbx/v1/events?limit=10',
    '/nbx/v2/markets/open',
    '/nbx/v2/events/open',
    '/nbx/v2/fixtures/open',
    '/v1/events',
    '/v1/fixtures',
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(`https://api.novig.us${ep}`, {
        headers, signal: AbortSignal.timeout(6000)
      });
      const text = await r.text();
      let d; try { d = JSON.parse(text); } catch { d = text.slice(0,200); }
      const arr = Array.isArray(d) ? d : (d?.data || d?.events || d?.markets || d?.fixtures || []);
      results[ep] = {
        status: r.status,
        type: Array.isArray(d) ? `array(${d.length})` : typeof d,
        keys: typeof d === 'object' && !Array.isArray(d) ? Object.keys(d).slice(0,10) : null,
        count: Array.isArray(arr) ? arr.length : null,
        sample: Array.isArray(arr) ? arr[0] : (typeof d === 'object' ? d : null),
      };
    } catch(e) { results[ep] = { error: e.message }; }
  }

  return res.status(200).json({ token_set: TOKEN.length > 0, results });
}
