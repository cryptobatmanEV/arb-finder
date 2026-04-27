// Debug: Show ALL open Novig markets regardless of sport/league
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const r = await fetch('https://api.novig.us/v1/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: `{
      market(
        limit: 20
        where: { status: { _eq: "OPEN" } }
        order_by: { updated_at: desc }
      ) {
        id type status description
        event { description league status type scheduled_start }
      }
    }` }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  const markets = d?.data?.market || [];

  return res.status(200).json({
    total: markets.length,
    markets: markets.map(m => ({
      type: m.type,
      market_desc: m.description,
      event: m.event?.description,
      league: m.event?.league,
      event_status: m.event?.status,
      scheduled: m.event?.scheduled_start,
    })),
    errors: d?.errors,
  });
}
