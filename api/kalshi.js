import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyId      = process.env.KALSHI_KEY_ID;
  const privateKey = process.env.KALSHI_PRIVATE_KEY;

  if (!keyId || !privateKey) {
    return res.status(500).json({
      error: 'KALSHI_KEY_ID or KALSHI_PRIVATE_KEY not set in Vercel environment variables',
      platform: 'kalshi',
    });
  }

  const { path = 'markets', ...rest } = req.query;
  const qs  = new URLSearchParams({ limit: '100', ...rest }).toString();
  const endpoint = `/trade-api/v2/${path}`;
  const url = `https://trading-api.kalshi.com${endpoint}${qs ? '?' + qs : ''}`;

  // Kalshi RSA-SHA256 signing
  // Message = timestamp_ms + METHOD + /trade-api/v2/path (no query string)
  const timestamp = Date.now().toString();
  const message   = timestamp + 'GET' + endpoint;

  let signature;
  try {
    const signer = crypto.createSign('SHA256');
    signer.update(message);
    signer.end();
    signature = signer.sign(privateKey, 'base64');
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to sign Kalshi request: ' + e.message,
      platform: 'kalshi',
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'KALSHI-ACCESS-KEY':       keyId,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
        'KALSHI-ACCESS-SIGNATURE': signature,
      },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const body = await upstream.text();
      return res.status(upstream.status).json({
        error: `Kalshi API returned HTTP ${upstream.status}: ${body}`,
        platform: 'kalshi',
        url,
      });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({
      error: err.name === 'AbortError' ? 'Request timed out after 8s' : err.message,
      platform: 'kalshi',
    });
  }
}
