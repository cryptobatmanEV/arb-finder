export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path = 'markets', ...rest } = req.query;
  const qs = new URLSearchParams(rest).toString();
  const url = `https://clob.polymarket.com/${path}${qs ? '?' + qs : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Polymarket API returned HTTP ${upstream.status}`,
        platform: 'polymarket',
        url,
      });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({
      error: err.name === 'AbortError' ? 'Request timed out after 8s' : err.message,
      platform: 'polymarket',
    });
  }
}
