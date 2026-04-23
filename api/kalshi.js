const BASE = 'https://trading-api.kalshi.com/trade-api/v2';

async function getJwt() {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      email:    process.env.KALSHI_EMAIL,
      password: process.env.KALSHI_PASSWORD,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const hasCreds = !!(process.env.KALSHI_EMAIL && process.env.KALSHI_PASSWORD);
  const { path = 'markets' } = req.query;
  const url = `${BASE}/${path}?limit=200`;

  const doFetch = async (token) =>
    fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  try {
    // Always use JWT if creds are available — avoids 404/401 guessing game
    if (hasCreds) {
      let token;
      try {
        token = await getJwt();
      } catch (loginErr) {
        return res.status(401).json({
          error: 'Kalshi login failed: ' + loginErr.message,
          hint: 'Check KALSHI_EMAIL and KALSHI_PASSWORD in Vercel env vars',
          platform: 'kalshi',
        });
      }

      const upstream = await doFetch(token);
      if (!upstream.ok) {
        const body = await upstream.text();
        return res.status(upstream.status).json({
          error: `Kalshi returned HTTP ${upstream.status}: ${body}`,
          platform: 'kalshi',
          url,
        });
      }
      return res.status(200).json(await upstream.json());
    }

    // No creds — try unauthenticated
    const upstream = await doFetch(null);
    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({
        error: `Kalshi returned HTTP ${upstream.status} (no credentials set)`,
        hint: 'Add KALSHI_EMAIL and KALSHI_PASSWORD to Vercel environment variables',
        platform: 'kalshi',
      });
    }
    return res.status(200).json(await upstream.json());

  } catch (err) {
    return res.status(500).json({
      error: err.name === 'AbortError' ? 'Timed out' : err.message,
      platform: 'kalshi',
    });
  }
}
