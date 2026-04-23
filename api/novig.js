// Novig NBX API - OAuth 2.0 Client Credentials
// Auth docs: https://docs.novig.com/api-reference/authentication
// Set in Vercel env vars: NOVIG_CLIENT_ID + NOVIG_CLIENT_SECRET

const BASE = 'https://api.novig.us/nbx';

async function getToken() {
  const res = await fetch(`${BASE}/v1/auth/emm-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type:    'client_credentials',
      client_id:     process.env.NOVIG_CLIENT_ID,
      client_secret: process.env.NOVIG_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Novig auth HTTP ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.access_token || data.token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.NOVIG_CLIENT_ID || !process.env.NOVIG_CLIENT_SECRET) {
    return res.status(500).json({
      error: 'NOVIG_CLIENT_ID and NOVIG_CLIENT_SECRET not set in Vercel env vars',
      hint: 'Get credentials from Novig — contact them via docs.novig.com',
      platform: 'novig',
    });
  }

  try {
    const token = await getToken();
    const upstream = await fetch(`${BASE}/v2/emm/markets/open`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({ error: `Novig HTTP ${upstream.status}: ${body}`, platform: 'novig' });
    }

    return res.status(200).json(await upstream.json());
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'novig' });
  }
}
