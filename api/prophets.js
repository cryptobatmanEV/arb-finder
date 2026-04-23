/**
 * ProphetX / Prophets proxy
 *
 * IMPORTANT — READ BEFORE DEPLOYING
 * ----------------------------------
 * ProphetX does not publish a fully open REST API in my knowledge base.
 * The endpoints below are best-effort based on publicly visible network
 * traffic patterns from the prophets.com web app.
 *
 * TO VERIFY: Open prophets.com in Chrome, open DevTools → Network tab,
 * filter by XHR/Fetch, browse the markets page, and capture the real
 * base URL + endpoint pattern. Then update BASE_URL and the path logic below.
 *
 * Known possibilities:
 *   https://api.prophets.com/v1/markets
 *   https://prophets.com/api/markets
 *   https://app.prophets.com/api/v1/markets
 *
 * You may also need to pass an Authorization header if a session token
 * is required — capture that from DevTools as well.
 */

const BASE_URL = 'https://api.prophets.com/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path = 'markets', ...rest } = req.query;
  const qs = new URLSearchParams(rest).toString();
  const url = `${BASE_URL}/${path}${qs ? '?' + qs : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // Uncomment and fill in if a session token is required:
        // Authorization: `Bearer ${process.env.PROPHETS_API_TOKEN}`,
      },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `ProphetX API returned HTTP ${upstream.status} — endpoint may need updating`,
        platform: 'prophets',
        url,
        note: 'Verify correct endpoint via Chrome DevTools Network tab on prophets.com',
      });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({
      error: err.name === 'AbortError' ? 'Request timed out after 8s' : err.message,
      platform: 'prophets',
      note: 'ProphetX endpoint may need verification — see proxy file comments',
    });
  }
}
