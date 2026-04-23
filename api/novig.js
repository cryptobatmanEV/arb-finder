// Novig NBX API
// Public markets endpoint: https://api.novig.us/nbx/v2/emm/markets/open
// Requires Bearer token — set NOVIG_EMAIL + NOVIG_PASSWORD in Vercel env vars

const BASE = 'https://api.novig.us/nbx/v2';

async function getToken() {
  const res = await fetch(`${BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      email:    process.env.NOVIG_EMAIL,
      password: process.env.NOVIG_PASSWORD,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Novig login HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token || data.token;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Try without auth first
  const url = `${BASE}/emm/markets/open`;

  try {
    let upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    // If auth required and we have credentials, login and retry
    if ((upstream.status === 401 || upstream.status === 403) && process.env.NOVIG_EMAIL) {
      const token = await getToken();
      upstream = await fetch(url, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
    }

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({
        error: `Novig HTTP ${upstream.status}: ${body}`,
        hint: upstream.status === 401 ? 'Add NOVIG_EMAIL and NOVIG_PASSWORD to Vercel env vars' : '',
        platform: 'novig',
      });
    }

    return res.status(200).json(await upstream.json());
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'novig' });
  }
}
