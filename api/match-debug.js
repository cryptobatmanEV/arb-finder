export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = {};

  // Try different Polymarket endpoints
  const endpoints = [
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&order=volume&ascending=false',
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&tag=sports',
    'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=10&tag=nba',
    'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=10',
    'https://gamma-api.polymarket.com/markets?active=true&limit=10&order=end_date_iso&ascending=true',
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url + '&_t=' + Date.now(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      const mkts = Array.isArray(d) ? d : (d.markets || d.data || d.events || []);
      results[url.split('polymarket.com')[1].split('&_t')[0]] = {
        status: r.status,
        count: mkts.length,
        first3: mkts.slice(0,3).map(m => ({
          q: m.question || m.title || m.name,
          end: m.endDateIso || m.endDate || m.end_date,
          prices: m.outcomePrices,
        })),
      };
    } catch(e) {
      results[url] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}
