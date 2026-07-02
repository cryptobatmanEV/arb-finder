// api/parlay-debug.js

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const DEFAULT_SPORTS = [
  'baseball_mlb',
  'basketball_wnba',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

function listFromPayload(json) {
  return Array.isArray(json) ? json : (json?.data || json?.events || []);
}

function parseDays(req) {
  try {
    const url = new URL(req.url || '', 'https://arb-finder.local');
    const n = Number(url.searchParams.get('days') || 5);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 5;
  } catch (_) {
    return 5;
  }
}

function parseSports(req) {
  try {
    const url = new URL(req.url || '', 'https://arb-finder.local');
    const raw = url.searchParams.get('sports') || '';
    const sports = raw.split(',').map(s => s.trim()).filter(Boolean);
    return sports.length ? sports : DEFAULT_SPORTS;
  } catch (_) {
    return DEFAULT_SPORTS;
  }
}

function headersSummary(headers) {
  return {
    requestsUsed: headers.get('x-requests-used'),
    requestsRemaining: headers.get('x-requests-remaining'),
    requestsLast: headers.get('x-requests-last')
  };
}

function summarizeEvents(events) {
  const bookmakersSeen = {};
  let marketCount = 0;
  let outcomeCount = 0;

  for (const ev of events || []) {
    for (const b of ev.bookmakers || []) {
      const key = b.key || b.title || 'unknown';
      bookmakersSeen[key] = (bookmakersSeen[key] || 0) + 1;
      for (const market of b.markets || []) {
        marketCount += 1;
        outcomeCount += (market.outcomes || []).length;
      }
    }
  }

  return {
    eventCount: events.length,
    bookmakerKeysSeen: Object.keys(bookmakersSeen).sort(),
    bookmakerEventCounts: bookmakersSeen,
    marketCount,
    outcomeCount,
    first3Events: events.slice(0, 3).map(ev => ({
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
      })).slice(0, 8)
    }))
  };
}

async function fetchParlay(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const started = Date.now();
  const r = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': API_KEY
    }
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}

  return {
    requestPath: url.pathname + url.search,
    status: r.status,
    ok: r.ok,
    responseMs: Date.now() - started,
    headers: headersSummary(r.headers),
    textStart: text.slice(0, 800),
    json
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  const days = parseDays(req);
  const sports = parseSports(req);
  const now = new Date();
  const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const commenceTimeFrom = now.toISOString();
  const commenceTimeTo = to.toISOString();

  const output = {
    ok: true,
    pulledAt: now.toISOString(),
    base: BASE,
    days,
    commenceTimeFrom,
    commenceTimeTo,
    sports: {},
    notes: [
      'Raw upstream audit only. This endpoint does not normalize, filter, match, or calculate arbs.',
      'Odds are called once with the production date window and once without commenceTimeFrom/commenceTimeTo.',
      'No bookmaker allow-list is sent; this uses regions=us with h2h,spreads,totals.'
    ]
  };

  const sportsResult = await fetchParlay('/sports');
  const sportsRows = sportsResult.ok ? listFromPayload(sportsResult.json) : [];
  output.sportsEndpoint = {
    requestPath: sportsResult.requestPath,
    status: sportsResult.status,
    ok: sportsResult.ok,
    headers: sportsResult.headers,
    activeSportKeys: sportsRows.filter(row => row.active).map(row => row.key).filter(Boolean).sort(),
    requestedSportsActiveState: Object.fromEntries(sports.map(sport => [
      sport,
      !!sportsRows.find(row => row.key === sport && row.active)
    ]))
  };

  for (const sport of sports) {
    const events = await fetchParlay(`/sports/${sport}/events`, {
      commenceTimeFrom,
      commenceTimeTo
    });
    const oddsParams = {
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american'
    };
    const oddsWithDate = await fetchParlay(`/sports/${sport}/odds`, {
      ...oddsParams,
      commenceTimeFrom,
      commenceTimeTo
    });
    const oddsWithoutDate = await fetchParlay(`/sports/${sport}/odds`, oddsParams);

    const eventRows = events.ok ? listFromPayload(events.json) : [];
    const withDateRows = oddsWithDate.ok ? listFromPayload(oddsWithDate.json) : [];
    const withoutDateRows = oddsWithoutDate.ok ? listFromPayload(oddsWithoutDate.json) : [];

    output.sports[sport] = {
      eventsWithDate: {
        requestPath: events.requestPath,
        status: events.status,
        ok: events.ok,
        responseMs: events.responseMs,
        headers: events.headers,
        rowCount: eventRows.length,
        first3Events: eventRows.slice(0, 3).map(ev => ({
          id: ev.id,
          sport_key: ev.sport_key,
          commence_time: ev.commence_time,
          home_team: ev.home_team,
          away_team: ev.away_team
        })),
        error: events.ok ? undefined : events.textStart
      },
      oddsWithDate: {
        requestPath: oddsWithDate.requestPath,
        status: oddsWithDate.status,
        ok: oddsWithDate.ok,
        responseMs: oddsWithDate.responseMs,
        headers: oddsWithDate.headers,
        ...(oddsWithDate.ok ? summarizeEvents(withDateRows) : { error: oddsWithDate.textStart })
      },
      oddsWithoutDate: {
        requestPath: oddsWithoutDate.requestPath,
        status: oddsWithoutDate.status,
        ok: oddsWithoutDate.ok,
        responseMs: oddsWithoutDate.responseMs,
        headers: oddsWithoutDate.headers,
        ...(oddsWithoutDate.ok ? summarizeEvents(withoutDateRows) : { error: oddsWithoutDate.textStart })
      }
    };
  }

  return res.status(200).json(output);
};
