// Debug: Try different auth approaches for Onyx
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.ONYX_SESSION_TOKEN || '';
  const BASE  = 'https://api.onyxodds.com/api';
  const APP   = 'https://app.onyxodds.com/api';

  const results = {};

  // Try 1: Cookie on api.onyxodds.com
  try {
    const r = await fetch(`${BASE}/odds/gameMainLines/25236-30354-2026-04-25`, {
      headers: {
        'Accept': 'application/json',
        'Cookie': `__Secure-authjs.session-token=${TOKEN}`,
        'Origin': 'https://app.onyxodds.com',
        'Referer': 'https://app.onyxodds.com/game/25236-30354-2026-04-25',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    results['api_subdomain_cookie'] = { status: r.status, data: await r.json() };
  } catch(e) { results['api_subdomain_cookie'] = { error: e.message }; }

  // Try 2: Via app subdomain proxy path
  try {
    const r = await fetch(`${APP}/odds/gameMainLines/25236-30354-2026-04-25`, {
      headers: {
        'Accept': 'application/json',
        'Cookie': `__Secure-authjs.session-token=${TOKEN}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    const text = await r.text();
    results['app_subdomain'] = { status: r.status, text: text.slice(0,300) };
  } catch(e) { results['app_subdomain'] = { error: e.message }; }

  // Try 3: Bearer token in Authorization header
  try {
    const r = await fetch(`${BASE}/odds/gameMainLines/25236-30354-2026-04-25`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${TOKEN}`,
        'Origin': 'https://app.onyxodds.com',
        'Referer': 'https://app.onyxodds.com/game/25236-30354-2026-04-25',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    results['bearer_auth'] = { status: r.status, data: await r.json().catch(() => 'not json') };
  } catch(e) { results['bearer_auth'] = { error: e.message }; }

  // Try 4: Get a fresh session first from app.onyxodds.com/api/auth/session
  // then use that session for the API call
  try {
    const sessionR = await fetch('https://app.onyxodds.com/api/auth/session', {
      headers: {
        'Accept': '*/*',
        'Cookie': `__Secure-authjs.session-token=${TOKEN}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(6000),
    });
    const sessionCookies = sessionR.headers.get('set-cookie') || '';
    const sessionData = await sessionR.json().catch(() => null);
    results['session_refresh'] = {
      status: sessionR.status,
      has_user: !!sessionData?.user,
      new_cookies: sessionCookies.slice(0,200),
      user: sessionData?.user,
    };
  } catch(e) { results['session_refresh'] = { error: e.message }; }

  return res.status(200).json(results);
}
