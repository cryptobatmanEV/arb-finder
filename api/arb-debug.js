// Debug: Quick Novig token check
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  if (!TOKEN) return res.status(200).json({ error: 'No token set' });

  // Decode expiry from JWT without library
  try {
    const parts = TOKEN.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const exp = new Date(payload.exp * 1000);
    const now = new Date();
    const expired = now > exp;

    // Test a quick API call
    const r = await fetch('https://api.novig.us/v1/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '{ market(limit: 1, where: { status: { _eq: "OPEN" } }) { id type status } }' }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();

    return res.status(200).json({
      token_length: TOKEN.length,
      expires_at: exp.toISOString(),
      expired,
      time_remaining: expired ? 'EXPIRED' : `${Math.round((exp - now) / 86400000)} days`,
      api_status: r.status,
      markets_found: d?.data?.market?.length || 0,
      error: d?.errors?.[0]?.message || null,
    });
  } catch(e) {
    return res.status(200).json({ error: e.message });
  }
}
