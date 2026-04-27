// Debug: Get ALL markets for a Novig event with no status filter
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Get event with ALL markets - no status filter
  const r = await fetch('https://api.novig.us/v1/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: `{
      event(
        limit: 1
        where: {
          type: { _eq: "Game" }
          status: { _in: ["OPEN_PREGAME"] }
          league: { _in: ["NBA", "MLB"] }
        }
      ) {
        id description league status
        markets(limit: 10) {
          id type status strike description
        }
      }
    }` }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();

  return res.status(200).json({
    event: d?.data?.event?.[0],
    errors: d?.errors,
  });
}
