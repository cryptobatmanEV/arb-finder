export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`https://${req.headers.host}/api/novig`, {
    signal: AbortSignal.timeout(25000),
  });
  const d = await r.json();
  const events = d.events || [];

  // Show team abbreviations for all NBA events
  const teamInfo = events
    .filter(e => e.league === 'NBA')
    .map(e => ({
      description: e.description,
      away: { name: e.game?.awayTeam?.name, short_name: e.game?.awayTeam?.short_name },
      home: { name: e.game?.homeTeam?.name, short_name: e.game?.homeTeam?.short_name },
      scheduled_start: e.game?.scheduled_start,
    }));

  return res.status(200).json({
    nba_games: teamInfo,
    note: 'short_name must match Polymarket slug abbrevations (cle, tor, okc, phx etc)',
  });
}
