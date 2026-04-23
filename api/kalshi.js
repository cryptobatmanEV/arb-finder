import crypto from 'crypto';

function normalizePem(raw) {
  // Strip everything except the base64 content, then reformat properly
  // This handles: newlines stripped, \n literals, spaces, all variations
  const stripped = raw
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, '')
    .replace(/-----END RSA PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '')
    .replace(/\n/g, '');

  // Chunk into 64-char lines as PEM requires
  const lines = stripped.match(/.{1,64}/g) || [];
  return [
    '-----BEGIN RSA PRIVATE KEY-----',
    ...lines,
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyId      = process.env.KALSHI_KEY_ID;
  const rawKey     = process.env.KALSHI_PRIVATE_KEY;

  if (!keyId || !rawKey) {
    return res.status(500).json({
      error: 'KALSHI_KEY_ID or KALSHI_PRIVATE_KEY not set in Vercel environment variables',
      platform: 'kalshi',
    });
  }

  const privateKey = normalizePem(rawKey);

  const { path = 'markets', ...rest } = req.query;
  const qs       = new URLSearchParams({ limit: '100', ...rest }).toString();
  const endpoint = `/trade-api/v2/${path}`;
  const url      = `https://trading-api.kalshi.com${endpoint}${qs ? '?' + qs : ''}`;

  const timestamp = String(Math.floor(Date.now() / 1000)); // seconds, not ms
  const message   = timestamp + 'GET' + endpoint;

  let signature;
  try {
    const signer = crypto.createSign('SHA256');
    signer.update(message);
    signer.end();
    signature = signer.sign(
      { key: privateKey, format: 'pem', type: 'pkcs1' },
      'base64'
    );
  } catch (e) {
    return res.status(500).json({
      error: 'RSA signing failed: ' + e.message,
      keyPreview: privateKey.slice(0, 80) + '...',
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
