// api/parlay-debug.js

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

const BOOKMAKERS = [
  'draftkings',
  'fanduel',
  'caesars',
  'bovada',
  'betmgm',
  'fanatics',
  'pinnacle',
  'fliff',
  'bet365',
  'betrivers',
  'hardrock',
  'pointsbet',
  'novig',
  'prophetx',
  'kalshi'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  const output = {
    ok: true,
    pulledAt: new Date().toISOString(),
    base: BASE,
    sports: {},
    totalEvents: 0,
    totalBookmakersSeen: {},
    notes: [
      'This debug endpoint does not normalize or match arbs.',
      'It shows what ParlayAPI is actually returning before the scanner processes it.'
    ]
  };

  for (const sport of SPORTS) {
    const url = new URL(`${BASE}/sports/${sport}/odds`);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', 'h2h,spreads,totals');
    url.searchParams.set('bookmakers', BOOKMAKERS.join(','));
    url.searchParams.set('oddsFormat', 'american');

    try {
      const r = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'X-API-Key': API_KEY
        }
      });

      const text = await r.text();

      const sportDebug = {
        requestUrlNoKey: url.toString().replace(API_KEY, 'HIDDEN'),
        status: r.status,
        ok: r.ok,
        headers: {
          requestsUsed: r.headers.get('x-requests-used'),
          requestsRemaining: r.headers.get('x-requests-remaining'),
          requestsLast: r.headers.get('x-requests-last')
        },
        rawTextStart: text.slice(0, 1000),
        eventCount: 0,
        bookmakersSeen: {},
        sampleEvents: []
      };

      if (!r.ok) {
        sportDebug.error = text.slice(0, 1000);
        output.sports[sport] = sportDebug;
        continue;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        sportDebug.error = 'JSON parse failed';
        output.sports[sport] = sportDebug;
        continue;
      }

      const events = Array.isArray(json) ? json : (json.data || json.events || []);
      sportDebug.eventCount = events.length;
      output.totalEvents += events.length;

      for (const ev of events) {
        for (const b of ev.bookmakers || []) {
          const key = b.key || b.title || 'unknown';
          sportDebug.bookmakersSeen[key] = (sportDebug.bookmakersSeen[key] || 0) + 1;
          output.totalBookmakersSeen[key] = (output.totalBookmakersSeen[key] || 0) + 1;
        }
      }

      sportDebug.sampleEvents = events.slice(0, 5).map(ev => ({
        id: ev.id,
        sport_key: ev.sport_key,
        commence_time: ev.commence_time,
        home_team: ev.home_team,
        away_team: ev.away_team,
        bookmakers: (ev.bookmakers || []).map(b => ({
          key: b.key,
          title: b.title,
          markets: (b.markets || []).map(m => ({
            key: m.key,
            outcomes: (m.outcomes || []).slice(0, 4)
          }))
        })).slice(0, 5)
      }));

      output.sports[sport] = sportDebug;
    } catch (err) {
      output.sports[sport] = {
        ok: false,
        error: err.message
      };
    }
  }

  res.status(200).json(output);
};
