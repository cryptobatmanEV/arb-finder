/**
 * Novig proxy
 *
 * IMPORTANT — READ BEFORE DEPLOYING
 * ----------------------------------
 * Novig is a sports betting exchange. Their public API is not fully
 * documented in my knowledge base. The endpoint below is a best-effort
 * guess based on typical exchange API patterns.
 *
 * TO VERIFY: Open novig.com in Chrome, open DevTools → Network tab,
 * filter by XHR/Fetch, and browse the markets/events page. Capture the
 * real base URL + endpoint. Common patterns:
 *   https://api.novig.com/v1/events
 *   https://api.novig.com/v1/markets
 *   https://api.novig.com/odds
 *
 * Novig uses American odds format. The normalizer in index.html
 * will convert American → implied probability automatically.
 *
 * Set NOVIG_API_KEY in your Vercel environment variables if an API key
 * is required (check their docs or DevTools for an Authorization header).
 */

const BASE_URL = 'https://api.novig.com/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path = 'events', ...rest } = req.query;
  const qs = new URLSearchParams(rest).toString();
  const url = `${BASE_URL}/${path}${qs ? '?' + qs : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // Uncomment if API key required:
        // Authorization: `Bearer ${process.env.NOVIG_API_KEY}`,
      },
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Novig API returned HTTP ${upstream.status} — endpoint may need updating`,
        platform: 'novig',
        url,
        note: 'Verify correct endpoint via Chrome DevTools Network tab on novig.com',
      });
    }

    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timer);
    return res.status(500).json({
      error: err.name === 'AbortError' ? 'Request timed out after 8s' : err.message,
      platform: 'novig',
      note: 'Novig endpoint may need verification — see proxy file comments',
    });
  }
}
