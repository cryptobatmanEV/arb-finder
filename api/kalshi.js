import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyId = process.env.KALSHI_KEY_ID;
  let privateKey = process.env.KALSHI_PRIVATE_KEY;

  if (!keyId || !privateKey) {
    return res.status(500).json({
      error: 'KALSHI_KEY_ID or KALSHI_PRIVATE_KEY not set in Vercel environment variables',
      platform: 'kalshi',
    });
  }

  // Vercel often strips newlines from env vars — restore them
  // Handles both \n literals and space-separated base64 chunks
  privateKey = privateKey
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, '-----BEGIN RSA PRIVATE KEY-----\n')
    .replace(/-----END RSA PRIVATE KEY-----/, '\n-----END RSA PRIVATE KEY-----')
    .replace(/\s(?![-])/g, '\n')  // turn spaces between base64 chars into newlines
    .replace(/\\n/g, '\n');       // turn literal \n strings into real newlines

  const { path = 'markets', ...rest } = req.query;
  const qs       = new URLSearchParams({ limit: '100', ...rest }).toString();
  const endpoint = `/trade-api/v2/${path}`;
  const url      = `https://trading-api.kalshi.com${endpoint}${qs ? '?' + qs : ''}`;

  const timestamp = Date.now().toString();
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
      hint: 'Check that KALSHI_PRIVATE_KEY in Vercel includes the full -----BEGIN/END RSA PRIVATE KEY----- lines',
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
