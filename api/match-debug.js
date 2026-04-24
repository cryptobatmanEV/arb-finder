export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const base = 'https://gamma-api.polymarket.com';
  const results = {};

  // Find how to get all upcoming sports events
  const tests = [
    `${base}/events?active=true&closed=false&limit=20&category=sports`,
    `${base}/events?active=true&closed=false&limit=20&tag=sports&order=end_date_iso&ascending=true`,
    `${base}/events?active=true&closed=false&limit=20&series=nba`,
    `${base}/events?active=true&closed=false&limit=5&slug_prefix=nba`,
    `${base}/events?active=true&closed=false&limit=200&order=end_date_iso&ascending=true`,
  ];

  for (const url of tests) {
    try {
      const r = await fetch(url + '&_t=' + Date.now(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      const arr = Array.isArray(d) ? d : (d.events || d.data || []);
      // Filter for sports slugs
      const sports = arr.filter(e => e.slug && /^(nba|mlb|nfl|nhl)-/.test(e.slug));
      results[url.replace(base,'').split('&_t')[0]] = {
        total: arr.length,
        sportsFound: sports.length,
        sportsSlugs: sports.slice(0,10).map(e => ({
          slug: e.slug,
          title: e.title,
          endDate: e.endDate,
          marketCount: e.markets?.length,
        })),
      };
    } catch(e) {
      results[url.replace(base,'').split('&_t')[0]] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
