// Debug: Find correct Polymarket MLB slug format
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Try various MLB slug formats for SF vs PHI today
  const slugTests = [
    'mlb-sf-phi-2026-04-30',
    'mlb-sfg-phi-2026-04-30',
    'mlb-sfg-phi-2026-04-30',
    'mlb-sf-phi-2026-04-30',
    'mlb-wsh-nym-2026-04-30',
    'mlb-wsh-nym-2026-04-29',
    'mlb-hou-bal-2026-04-30',
    'mlb-hou-bal-2026-04-29',
  ];

  const results = {};
  for (const slug of slugTests) {
    const r = await fetch(`${GAMMA}/events?slug=${slug}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    const d = await r.json();
    const e = Array.isArray(d) ? d[0] : d;
    results[slug] = {
      found: !!e?.id,
      title: e?.title || null,
      slug: e?.slug || null,
    };
  }

  // Also search Polymarket for MLB events broadly
  const searchRes = await fetch(`${GAMMA}/events?active=true&closed=false&limit=50&tag=MLB&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const searchData = await searchRes.json();
  const mlbEvents = (Array.isArray(searchData) ? searchData : [])
    .filter(e => e.slug?.startsWith('mlb-'))
    .map(e => ({ slug: e.slug, title: e.title }));

  // Try the teams endpoint for MLB
  const teamsRes = await fetch(`${GAMMA}/teams?limit=500&offset=0&league=mlb&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const teamsData = await teamsRes.json();
  const mlbTeams = (Array.isArray(teamsData) ? teamsData : [])
    .map(t => ({ id: t.id, name: t.name, abbreviation: t.abbreviation }))
    .slice(0, 20);

  return res.status(200).json({
    slug_tests: results,
    mlb_events_found: mlbEvents.slice(0, 10),
    mlb_teams_sample: mlbTeams,
  });
}
