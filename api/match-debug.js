export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const base = 'https://gamma-api.polymarket.com';
  const t = '&_t=' + Date.now();
  const results = {};

  // Try fetching the actual Nuggets vs Timberwolves event by slug
  const slugTests = [
    `${base}/events?slug=nba-den-min-2026-04-23`,
    `${base}/events/nba-den-min-2026-04-23`,
    `${base}/markets?slug=nba-den-min-2026-04-23`,
    `${base}/sports/179`,  // sports endpoint returned id=179 items, try fetching one
    `${base}/sports?limit=5&order=end_date&ascending=true`,
    `${base}/events?active=true&closed=false&limit=10&tag=NBA&order=end_date_iso&ascending=true`,
    `${base}/events?active=true&closed=false&limit=5&sport=nba`,
  ];

  for (const url of slugTests) {
    try {
      const r = await fetch(url + (url.includes('?') ? t : '?_t='+Date.now()), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      const key = url.replace(base, '');
      const arr = Array.isArray(d) ? d : (d.markets || d.events || d.data || [d]);
      results[key] = {
        status: r.status,
        count: arr.length,
        first: arr[0] ? {
          id: arr[0].id,
          slug: arr[0].slug,
          title: arr[0].title || arr[0].question || arr[0].name,
          endDate: arr[0].endDate || arr[0].endDateIso,
          markets: arr[0].markets ? arr[0].markets.slice(0,2).map(m => ({
            q: m.question, prices: m.outcomePrices, end: m.endDateIso
          })) : undefined,
        } : null,
      };
    } catch(e) {
      results[url.replace(base,'')] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
