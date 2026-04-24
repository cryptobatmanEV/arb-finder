export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = {};
  const t = '&_t=' + Date.now();
  const base = 'https://gamma-api.polymarket.com';

  // Test the sports-specific endpoints we found
  const tests = [
    `${base}/teams?limit=500&offset=0&league=nba`,
    `${base}/teams?limit=500&offset=0&league=mlb`,
    `${base}/sports-markets?limit=50&league=nba`,
    `${base}/sports?limit=50`,
    `${base}/games?limit=50`,
    `${base}/markets?active=true&closed=false&limit=50&category=sports`,
    `${base}/markets?active=true&closed=false&limit=50&sport=nba`,
  ];

  for (const url of tests) {
    try {
      const r = await fetch(url + t, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      const key = url.replace(base, '').split('&_t')[0];
      results[key] = {
        status: r.status,
        type: Array.isArray(d) ? 'array' : typeof d,
        topLevelKeys: Array.isArray(d) ? 'array' : Object.keys(d).slice(0, 10),
        count: Array.isArray(d) ? d.length : (d.markets || d.data || d.games || d.teams || []).length,
        first2: (Array.isArray(d) ? d : (d.markets || d.data || d.games || d.teams || [])).slice(0, 2),
      };
    } catch(e) {
      results[url.replace(base,'')] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
