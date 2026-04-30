// Master audit: Check scheduled_start UTC vs actual game date for today's Novig games
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
        limit: 10
        where: {
          status: { _eq: "OPEN" }
          type: { _eq: "MONEY" }
          is_consensus: { _eq: true }
          event: {
            league: { _in: ["MLB", "NBA", "NHL"] }
            status: { _in: ["OPEN_PREGAME"] }
            type: { _eq: "Game" }
          }
        }
      ) {
        id description
        event {
          description league scheduled_start
          game {
            awayTeam { short_name }
            homeTeam { short_name }
            scheduled_start
          }
        }
      }
    }` }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  const markets = d?.data?.market || [];

  return res.status(200).json({
    today_utc: new Date().toISOString().slice(0,10),
    games: markets.map(m => {
      const gameStart = m.event?.game?.scheduled_start || m.event?.scheduled_start;
      const utcDate = (gameStart||'').slice(0,10);
      // Convert UTC to ET (UTC-4 in EDT)
      const etDate = gameStart ? new Date(new Date(gameStart) - 4*60*60*1000).toISOString().slice(0,10) : null;
      return {
        description: m.event?.description,
        league: m.event?.league,
        away: m.event?.game?.awayTeam?.short_name,
        home: m.event?.game?.homeTeam?.short_name,
        scheduled_start_raw: gameStart,
        utc_date: utcDate,
        et_date: etDate,
        gameKey_current: `${m.event?.league?.toLowerCase()}-${m.event?.game?.awayTeam?.short_name?.toLowerCase()}-${m.event?.game?.homeTeam?.short_name?.toLowerCase()}-${utcDate}`,
        gameKey_fixed: `${m.event?.league?.toLowerCase()}-${m.event?.game?.awayTeam?.short_name?.toLowerCase()}-${m.event?.game?.homeTeam?.short_name?.toLowerCase()}-${etDate}`,
      };
    }),
    errors: d?.errors,
  });
}
