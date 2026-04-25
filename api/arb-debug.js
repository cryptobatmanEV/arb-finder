// Debug: Test Onyx session token + find games listing endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.ONYX_SESSION_TOKEN || '';
  const BASE  = 'https://api.onyxodds.com/api';

  const cookieStr = `__Secure-authjs.session-token=${TOKEN}`;

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Cookie': cookieStr,
    'Origin': 'https://app.onyxodds.com',
    'Referer': 'https://app.onyxodds.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  const results = {};

  // 1. Test confirmed endpoint with token
  const endpoints = [
    '/odds/gameMainLines/25236-30354-2026-04-25',
    '/odds/games',
    '/odds/games?league=nba',
    '/odds/schedule',
    '/odds/schedule?date=2026-04-25',
    '/odds/events?league=nba',
    '/odds/leagues',
    '/games/schedule',
    '/games/today',
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(`${BASE}${ep}`, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text.slice(0,300); }
      const arr = Array.isArray(data) ? data : null;
      results[ep] = {
        status: r.status,
        type: Array.isArray(data) ? `array(${data.length})` : typeof data,
        keys: typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0,15) : null,
        first: arr ? arr[0] : (typeof data === 'object' ? data : null),
      };
    } catch(e) {
      results[ep] = { error: e.message };
    }
  }

  return res.status(200).json({
    token_set: TOKEN.length > 0,
    token_length: TOKEN.length,
    results,
  });
}
