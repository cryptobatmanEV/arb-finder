// Debug: Probe Onyx API endpoints to find games listing
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const BASE = 'https://api.onyxodds.com/api';
  const results = {};

  const endpoints = [
    '/odds/gameMainLines/25236-30354-2026-04-25',  // confirmed working
    '/odds/games',
    '/odds/games?date=2026-04-25',
    '/odds/events',
    '/odds/schedule',
    '/odds/schedule?league=nba',
    '/games',
    '/games?league=nba&date=2026-04-25',
    '/schedule',
    '/leagues',
    '/sports',
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(`${BASE}${ep}`, {
        headers: {
          'Accept': 'application/json',
          'Origin': 'https://app.onyxodds.com',
          'Referer': 'https://app.onyxodds.com/',
        },
        signal: AbortSignal.timeout(6000),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
      results[ep] = {
        status: r.status,
        type: Array.isArray(data) ? `array(${data.length})` : typeof data,
        keys: typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0,10) : null,
        sample: Array.isArray(data) ? data[0] : data,
      };
    } catch(e) {
      results[ep] = { error: e.message };
    }
  }

  // Also show full data from the confirmed endpoint
  try {
    const r = await fetch(`${BASE}/odds/gameMainLines/25236-30354-2026-04-25`, {
      headers: { 'Accept': 'application/json', 'Origin': 'https://app.onyxodds.com', 'Referer': 'https://app.onyxodds.com/' },
      signal: AbortSignal.timeout(6000),
    });
    results['_confirmed_full'] = await r.json();
  } catch(e) {
    results['_confirmed_full'] = { error: e.message };
  }

  return res.status(200).json(results);
}
