// api/parlay-sources.js
// Manual ParlayAPI source audit. Not used by the scanner UI.

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const CORE_SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

const EXPANDED_SPORTS = [
  'basketball_wnba',
  'americanfootball_ncaaf',
  'basketball_ncaab'
];

const DEFAULT_SOCCER_SPORTS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_mexico_ligamx',
  'soccer_fifa_world_cup'
];

const SPORTS = [...CORE_SPORTS, ...EXPANDED_SPORTS, ...DEFAULT_SOCCER_SPORTS];

const FINAL_BOOK_KEYS = [
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'bovada',
  'bet365',
  'fanatics',
  'hardrock',
  'betrivers',
  'pinnacle',
  'kalshi',
  'novig',
  'polymarket',
  'fliff',
  'prophetx',
  'stake',
  'sugarhouse',
  'tipico'
];

const REMOVED_BOOK_KEYS = [
  'betclic',
  'betrivers_ca',
  'bwin',
  'maverick_games',
  'parlayplay',
  'parx',
  'pick6',
  'pmu',
  'prizepicks',
  'rushbet',
  'sleeper',
  'underdog',
  'unibet_be',
  'unibet_nl',
  'winamax'
];

const FINAL_BOOK_SET = new Set(FINAL_BOOK_KEYS);
const REMOVED_BOOK_SET = new Set(REMOVED_BOOK_KEYS);

const SUPPORTED_EXCHANGE_CALLS = [
  { exchange: 'prophetx', sport: 'baseball_mlb' }
];

const EXPANSION_CANDIDATE_SPORTS = [
  { key: 'basketball_wnba', label: 'WNBA', matcher: 'team sport; Parlay-only generic game keys are supported' },
  { key: 'americanfootball_ncaaf', label: 'NCAAF', matcher: 'team sport; Parlay-only generic game keys are supported' },
  { key: 'basketball_ncaab', label: 'NCAAB', matcher: 'team sport; Parlay-only generic game keys are supported' },
  { key: 'soccer_epl', label: 'EPL', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'soccer_spain_la_liga', label: 'La Liga', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'soccer_italy_serie_a', label: 'Serie A', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'soccer_germany_bundesliga', label: 'Bundesliga', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'soccer_france_ligue_one', label: 'Ligue 1', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'soccer_mexico_ligamx', label: 'Liga MX', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'soccer_fifa_world_cup', label: 'FIFA World Cup', matcher: 'soccer; two-sided spreads/totals only, three-way h2h must be skipped' },
  { key: 'mma_mixed_martial_arts', label: 'UFC/MMA', matcher: 'fighter-vs-fighter; needs non-team matcher verification' },
  { key: 'tennis', label: 'Tennis', matcher: 'player-vs-player; needs non-team matcher verification' },
  { key: 'tennis_atp', label: 'ATP Tennis', matcher: 'player-vs-player; needs non-team matcher verification' },
  { key: 'tennis_wta', label: 'WTA Tennis', matcher: 'player-vs-player; needs non-team matcher verification' },
  { key: 'golf_pga_championship', label: 'Golf', matcher: 'usually outrights/player markets; not safe for current two-sided game matcher' }
];

const SPORT_EXCLUSION_REASONS = {
  mma_mixed_martial_arts: 'not enabled; fighter-vs-fighter normalization needs explicit matcher support',
  tennis_atp: 'not enabled; player-vs-player normalization needs explicit matcher support',
  tennis_wta: 'not enabled; player-vs-player normalization needs explicit matcher support'
};

function getLookaheadDays(req) {
  const fallback = Number(process.env.PARLAY_LOOKAHEAD_DAYS || 5);
  let queryDays = null;
  try {
    const url = new URL(req.url || '', 'https://arb-finder.local');
    queryDays = url.searchParams.get('days');
  } catch (_) {}
  const raw = queryDays != null ? Number(queryDays) : fallback;
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  return Math.min(Math.max(Math.floor(raw), 1), 30);
}

function buildTimeWindow(req) {
  const lookaheadDays = getLookaheadDays(req);
  const fromMs = Date.now();
  const toMs = fromMs + lookaheadDays * 24 * 60 * 60 * 1000;
  return {
    lookaheadDays,
    fromMs,
    toMs,
    commenceTimeFrom: new Date(fromMs).toISOString(),
    commenceTimeTo: new Date(toMs).toISOString()
  };
}

function inTimeWindow(startTime, timeWindow) {
  const startMs = new Date(startTime || '').getTime();
  return Number.isFinite(startMs) && startMs >= timeWindow.fromMs && startMs <= timeWindow.toMs;
}

function interestingHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    if (/credit|request|usage|remaining|used|cost|quota|ratelimit/i.test(key)) {
      out[key] = value;
    }
  });
  return out;
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.bookmakers)) return payload.bookmakers;
  if (Array.isArray(payload?.exchanges)) return payload.exchanges;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.markets)) return payload.markets;
  return [];
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row?.[field] == null ? 'null' : String(row[field]);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function compactRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    rawKeys: Object.keys(row),
    id: row.id || row.event_id || row.market_id || null,
    event_id: row.event_id || null,
    market_id: row.market_id || null,
    key: row.key || row.exchange_key || row.bookmaker_key || row.id || null,
    title: row.title || row.name || row.display_name || null,
    source: row.source || row.exchange || row.bookmaker || null,
    sport_key: row.sport_key || row.sport || row.key || null,
    active: row.active ?? null,
    market_type: row.market_type || row.marketType || row.type || null,
    market_key: row.market_key || null,
    line: row.line ?? row.point ?? row.strike ?? null,
    over_price: row.over_price ?? null,
    under_price: row.under_price ?? null,
    volume_usd: row.volume_usd ?? null,
    last_update: row.last_update || null,
    is_consensus: row.is_consensus ?? null,
    commence_time: row.commence_time || row.start_time || row.startTime || null,
    home_team: row.home_team || row.home || null,
    away_team: row.away_team || row.away || null,
    bookmakers: Array.isArray(row.bookmakers)
      ? row.bookmakers.slice(0, 5).map(b => ({ key: b.key, title: b.title }))
      : undefined,
    markets: Array.isArray(row.markets)
      ? row.markets.slice(0, 3).map(m => ({ key: m.key, outcomes: (m.outcomes || []).slice(0, 2) }))
      : undefined
  };
}

function summarizeOddsRows(rows) {
  const bookmakerKeys = {};
  let marketCount = 0;
  let outcomeCount = 0;

  for (const ev of rows || []) {
    for (const book of ev.bookmakers || []) {
      const key = sourceKey(book);
      if (key) bookmakerKeys[key] = (bookmakerKeys[key] || 0) + 1;
      for (const market of book.markets || []) {
        marketCount += 1;
        outcomeCount += (market.outcomes || []).length;
      }
    }
  }

  return {
    rawEventCount: rows.length,
    bookmakerKeysSeen: Object.keys(bookmakerKeys).sort(),
    bookmakerEventCounts: bookmakerKeys,
    rawMarketCount: marketCount,
    rawOutcomeCount: outcomeCount,
    first3Events: rows.slice(0, 3).map(compactRow)
  };
}

function firstEventDetails(rows) {
  const first = rows?.[0];
  if (!first) {
    return {
      first3EventNamesAndTimes: [],
      firstEventFirst3Bookmakers: [],
      firstBookmakerMarkets: []
    };
  }

  return {
    first3EventNamesAndTimes: rows.slice(0, 3).map(row => ({
      id: row.id || null,
      commence_time: row.commence_time || null,
      away_team: row.away_team || null,
      home_team: row.home_team || null,
      title: row.title || row.name || `${row.away_team || ''} @ ${row.home_team || ''}`.trim()
    })),
    firstEventFirst3Bookmakers: (first.bookmakers || []).slice(0, 3).map(book => ({
      key: book.key || null,
      title: book.title || book.name || null,
      marketKeys: (book.markets || []).map(market => market.key)
    })),
    firstBookmakerMarkets: (first.bookmakers?.[0]?.markets || []).map(market => ({
      key: market.key,
      outcomes: (market.outcomes || []).slice(0, 4).map(outcome => ({
        name: outcome.name,
        price: outcome.price,
        point: outcome.point ?? null
      }))
    }))
  };
}

function summarizeMlbShapeCall(label, call) {
  return {
    label,
    endpoint: call.endpoint,
    query: call.query,
    status: call.status,
    ok: call.ok,
    errorText: call.errorText,
    creditHeaders: call.creditHeaders,
    ...summarizeOddsRows(call.rows),
    ...firstEventDetails(call.rows)
  };
}

function summarizeMainLineEvents(rows) {
  const byBook = {};
  const byMarket = {};
  for (const ev of rows || []) {
    for (const book of ev.bookmakers || []) {
      const key = sourceKey(book);
      if (key) byBook[key] = (byBook[key] || 0) + 1;
      for (const market of book.markets || []) {
        const mk = market.key || 'unknown';
        byMarket[mk] = (byMarket[mk] || 0) + 1;
      }
    }
  }
  return {
    rawEventCount: rows.length,
    bookmakerKeysSeen: Object.keys(byBook).sort(),
    bookmakerEventCounts: byBook,
    marketCounts: byMarket,
    ...firstEventDetails(rows)
  };
}

function summarizePropsRows(rows) {
  const byBook = {};
  const byMarketKey = {};
  let withPlayer = 0;
  let withTeam = 0;
  let withGame = 0;
  let withLine = 0;
  let withOverUnder = 0;
  let withBookmaker = 0;
  let withCommenceTime = 0;

  for (const row of rows || []) {
    const book = sourceKey(row.bookmaker ? { key: row.bookmaker } : row) || sourceKey(row);
    const marketKey = row.market_key || row.market || row.key || row.market_type || 'unknown';
    if (book) {
      byBook[book] = (byBook[book] || 0) + 1;
      withBookmaker += 1;
    }
    byMarketKey[marketKey] = (byMarketKey[marketKey] || 0) + 1;
    if (row.player || row.player_name || row.participant) withPlayer += 1;
    if (row.team || row.team_name || row.home_team || row.away_team) withTeam += 1;
    if (row.game_id || row.event_id || row.home_team || row.away_team) withGame += 1;
    if (row.line != null || row.point != null || row.strike != null) withLine += 1;
    if ((row.over_price != null && row.under_price != null) || Array.isArray(row.outcomes)) withOverUnder += 1;
    if (row.commence_time || row.start_time || row.startTime) withCommenceTime += 1;
  }

  return {
    rowCount: rows.length,
    bookmakerKeysSeen: Object.keys(byBook).sort(),
    topMarketKeys: Object.entries(byMarketKey).sort((a, b) => b[1] - a[1]).slice(0, 20),
    fieldCoverage: {
      withPlayer,
      withTeam,
      withGame,
      withLine,
      withOverUnder,
      withBookmaker,
      withCommenceTime
    },
    sampleRows: rows.slice(0, 5).map(compactRow)
  };
}

function isoNoMilliseconds(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function callParlay(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  return callParlayUrl(url, path, params);
}

async function callParlayUrl(url, endpoint, params = {}) {
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const startedAt = Date.now();
  const r = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': API_KEY
    },
    signal: AbortSignal.timeout(20000)
  });
  const elapsedMs = Date.now() - startedAt;

  const text = await r.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) {}

  const rows = listFromPayload(payload);

  return {
    endpoint,
    query: params,
    status: r.status,
    ok: r.ok,
    elapsedMs,
    creditHeaders: interestingHeaders(r.headers),
    payloadTopLevelKeys: payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload) : [],
    rowCount: rows.length,
    countsByMarketKey: countBy(rows, 'market_key'),
    countsByMarketType: countBy(rows, 'market_type'),
    rows,
    sampleRows: rows.slice(0, 3).map(compactRow),
    errorText: r.ok ? undefined : text.slice(0, 800)
  };
}

function normalizeKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sourceKey(row) {
  return normalizeKey(row?.key || row?.exchange_key || row?.bookmaker_key || row?.id || row?.exchange || '');
}

function sourceTitle(row) {
  return row?.title || row?.name || row?.display_name || row?.exchange || sourceKey(row);
}

function sourceList(rows) {
  return rows
    .map(row => ({ key: sourceKey(row), title: sourceTitle(row) }))
    .filter(row => row.key)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function queryList(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (!raw) return fallback;
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function setDiff(allRows, seenRows) {
  const seen = new Set(seenRows.map(row => row.key));
  return allRows.filter(row => !seen.has(row.key));
}

function findBovadaAtlSdRows(rows) {
  const matches = [];
  for (const ev of rows || []) {
    const home = String(ev.home_team || '').toLowerCase();
    const away = String(ev.away_team || '').toLowerCase();
    const isAtlSd = (home.includes('atlanta') && away.includes('san diego')) ||
      (home.includes('san diego') && away.includes('atlanta'));
    if (!isAtlSd) continue;
    for (const book of ev.bookmakers || []) {
      if (sourceKey(book) !== 'bovada') continue;
      for (const market of book.markets || []) {
        for (const outcome of market.outcomes || []) {
          const outcomeName = String(outcome.name || '').toLowerCase();
          if (!outcomeName.includes('atlanta')) continue;
          matches.push({
            event: ev,
            bookmaker: book,
            market,
            outcome
          });
        }
      }
    }
  }
  return matches;
}

const ACCURACY_TARGETS = [
  { id: 'bovada_tex_mia', book: 'bovada', teams: ['texas', 'miami'], expected: {
    h2h: { 'Texas Rangers': -125, 'Miami Marlins': 105 },
    spreads: { 'Texas Rangers_-1.5': 135, 'Miami Marlins_1.5': -160 },
    totals: { 'Over_7.5': -105, 'Under_7.5': -115 }
  }},
  { id: 'bovada_atl_sd', book: 'bovada', teams: ['atlanta', 'san diego'] },
  { id: 'bovada_oak_sf', book: 'bovada', teams: ['athletics', 'san francisco'] },
  { id: 'draftkings_atl_sd', book: 'draftkings', teams: ['atlanta', 'san diego'], expected: {
    h2h: { 'San Diego Padres': 113 }
  }}
];

function eventMatchesTeams(ev, terms) {
  const haystack = `${ev?.home_team || ''} ${ev?.away_team || ''}`.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function expectedKey(market, outcome) {
  if (market?.key === 'h2h') return outcome?.name || '';
  return `${outcome?.name || ''}_${outcome?.point ?? ''}`;
}

function auditTargetMatches(rows, target) {
  const matches = [];
  for (const ev of rows || []) {
    if (!eventMatchesTeams(ev, target.teams)) continue;
    for (const book of ev.bookmakers || []) {
      if (sourceKey(book) !== target.book) continue;
      for (const market of book.markets || []) {
        for (const outcome of market.outcomes || []) {
          const expected = target.expected?.[market.key]?.[expectedKey(market, outcome)] ?? null;
          matches.push({
            targetId: target.id,
            event_id: ev.id || null,
            canonical_event_id: ev.canonical_event_id || null,
            commence_time: ev.commence_time || null,
            home_team: ev.home_team || null,
            away_team: ev.away_team || null,
            book_key: book.key || null,
            book_title: book.title || null,
            book_last_update: book.last_update || null,
            market_key: market.key || null,
            market_last_update: market.last_update || null,
            outcome_name: outcome.name || null,
            outcome_price: outcome.price ?? null,
            outcome_point: outcome.point ?? null,
            expected_manual_price: expected,
            delta_vs_manual: expected == null || outcome.price == null ? null : Number(outcome.price) - Number(expected),
            normalizedDisplayed: {
              marketType: market.key === 'h2h' ? 'moneyline' : market.key === 'spreads' ? 'spread' : market.key === 'totals' ? 'total' : market.key,
              side: market.key === 'spreads'
                ? `${outcome.name} ${Number(outcome.point) > 0 ? '+' : ''}${outcome.point}`
                : market.key === 'totals'
                  ? `${outcome.name} ${outcome.point}`
                  : outcome.name,
              displayedOdds: outcome.price ?? null,
              sourcePriceType: 'american'
            },
            rawEvent: ev,
            rawBookmaker: book,
            rawMarket: market,
            rawOutcome: outcome
          });
        }
      }
    }
  }
  return matches;
}

function excludedActiveSports(sportsRows) {
  return sportsRows
    .filter(row => row.active && !SPORTS.includes(row.key))
    .map(row => ({
      key: row.key,
      title: row.title || row.name || row.key,
      reason: SPORT_EXCLUSION_REASONS[row.key] || 'not enabled; not in the current credit-budgeted two-sided main-line sport set'
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  try {
    const url = new URL(req.url || '', 'https://arb-finder.local');
    const auditExpansion = url.searchParams.get('auditExpansion') === '1';
    const auditInventory = url.searchParams.get('auditInventory') === '1';
    const auditMlbShapes = url.searchParams.get('auditMlbShapes') === '1';
    const auditProductionIssues = url.searchParams.get('auditProductionIssues') === '1';
    const auditBovadaAtlSd = url.searchParams.get('auditBovadaAtlSd') === '1';
    const auditAccuracy = url.searchParams.get('auditAccuracy') === '1';
    const auditCoverage = url.searchParams.get('auditCoverage') === '1';
    const auditDirect = url.searchParams.get('auditDirect') === '1';
    const checks = [];
    const bookmakerSeen = {};
    const exchangeSeen = {};
    const exchangeMarketCounts = {};
    const exchangeRowsInLookaheadWindow = {};
    const removedBooksSeen = {};
    const unsupportedBooksSeen = {};
    const timeWindow = buildTimeWindow(req);

    const bookmakers = await callParlay('/bookmakers');
    checks.push(bookmakers);
    const bookmakersAvailable = sourceList(bookmakers.rows);

    const exchanges = await callParlay('/exchanges');
    checks.push(exchanges);
    const exchangesAvailable = sourceList(exchanges.rows);

    const sports = await callParlay('/sports');
    checks.push(sports);
    const activeSportKeys = sports.rows
      .filter(row => row.active)
      .map(row => row.key)
      .filter(Boolean)
      .sort();
    const sportsByKey = new Map(sports.rows.map(row => [row.key, row]));

    if (auditCoverage || auditDirect) {
      const requestedSports = queryList(url, 'sports', SPORTS);
      const requestedBooks = queryList(url, 'books', FINAL_BOOK_KEYS)
        .map(normalizeKey)
        .filter(book => FINAL_BOOK_SET.has(book) && !REMOVED_BOOK_SET.has(book));
      const eventAudits = [];
      const allBooksOddsAudits = [];
      const directBookAudits = [];
      const freshnessAudits = [];
      const parserCoverageAudits = [];

      const metadataCalls = await Promise.allSettled([
        callParlay('/meta/book-coverage', { window_minutes: 15 }),
        callParlay('/meta/source-quality', { minutes: 10, limit: 200 })
      ]);
      metadataCalls.forEach(settled => {
        if (settled.status === 'fulfilled') checks.push(settled.value);
      });

      const freshnessResults = await Promise.allSettled(requestedBooks.map(async book => {
        const result = await callParlay(`/bookmakers/${book}/freshness`);
        return { book, result };
      }));
      for (const settled of freshnessResults) {
        if (settled.status !== 'fulfilled') {
          freshnessAudits.push({ ok: false, error: settled.reason?.message || String(settled.reason) });
          continue;
        }
        checks.push(settled.value.result);
        freshnessAudits.push({
          book: settled.value.book,
          status: settled.value.result.status,
          ok: settled.value.result.ok,
          creditHeaders: settled.value.result.creditHeaders,
          payloadTopLevelKeys: settled.value.result.payloadTopLevelKeys,
          sampleRows: settled.value.result.sampleRows,
          errorText: settled.value.result.errorText
        });
      }

      for (const sport of requestedSports) {
        const events = await callParlay(`/sports/${sport}/events`, {
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        });
        checks.push(events);
        eventAudits.push({
          sport,
          status: events.status,
          ok: events.ok,
          rowCount: events.rows.length,
          creditHeaders: events.creditHeaders,
          first3Events: events.rows.slice(0, 3).map(compactRow)
        });

        const parserCoverage = await callParlay('/meta/parser-coverage', {
          sport_key: sport,
          window_hours: 24
        });
        checks.push(parserCoverage);
        parserCoverageAudits.push({
          sport,
          status: parserCoverage.status,
          ok: parserCoverage.ok,
          rowCount: parserCoverage.rows.length,
          creditHeaders: parserCoverage.creditHeaders,
          sampleRows: parserCoverage.rows.slice(0, 5).map(compactRow),
          errorText: parserCoverage.errorText
        });

        const allBooksOdds = await callParlay(`/sports/${sport}/odds`, {
          regions: 'us',
          markets: 'h2h,spreads,totals',
          oddsFormat: 'american',
          include: 'verification',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        });
        checks.push(allBooksOdds);
        allBooksOddsAudits.push({
          sport,
          status: allBooksOdds.status,
          ok: allBooksOdds.ok,
          creditHeaders: allBooksOdds.creditHeaders,
          responseMs: allBooksOdds.elapsedMs,
          ...summarizeOddsRows(allBooksOdds.rows)
        });
      }

      if (auditDirect) {
        for (const sport of requestedSports) {
          for (const book of requestedBooks) {
            if (book === 'kalshi' || book === 'polymarket') continue;
            const direct = await callParlay(`/sports/${sport}/odds`, {
              bookmakers: book,
              markets: 'h2h,spreads,totals',
              oddsFormat: 'american',
              include: 'verification',
              commenceTimeFrom: timeWindow.commenceTimeFrom,
              commenceTimeTo: timeWindow.commenceTimeTo
            });
            checks.push(direct);
            directBookAudits.push({
              sport,
              book,
              status: direct.status,
              ok: direct.ok,
              creditHeaders: direct.creditHeaders,
              responseMs: direct.elapsedMs,
              errorText: direct.errorText,
              ...summarizeOddsRows(direct.rows)
            });
          }
        }
      }

      const metadataSummary = {};
      const [bookCoverageSettled, sourceQualitySettled] = metadataCalls;
      if (bookCoverageSettled?.status === 'fulfilled') {
        metadataSummary.bookCoverage = {
          status: bookCoverageSettled.value.status,
          ok: bookCoverageSettled.value.ok,
          rowCount: bookCoverageSettled.value.rows.length,
          creditHeaders: bookCoverageSettled.value.creditHeaders,
          sampleRows: bookCoverageSettled.value.rows.slice(0, 5).map(compactRow)
        };
      }
      if (sourceQualitySettled?.status === 'fulfilled') {
        metadataSummary.sourceQuality = {
          status: sourceQualitySettled.value.status,
          ok: sourceQualitySettled.value.ok,
          rowCount: sourceQualitySettled.value.rows.length,
          creditHeaders: sourceQualitySettled.value.creditHeaders,
          sampleRows: sourceQualitySettled.value.rows.slice(0, 5).map(compactRow)
        };
      }

      return res.status(200).json({
        ok: true,
        audit: auditDirect ? 'approved_book_direct_coverage' : 'approved_book_coverage',
        pulledAt: new Date().toISOString(),
        timeWindow,
        requestedSports,
        requestedBooks,
        approvedBooks: FINAL_BOOK_KEYS,
        removedBooks: REMOVED_BOOK_KEYS,
        metadataSummary,
        freshnessAudits,
        eventAudits,
        parserCoverageAudits,
        allBooksOddsAudits,
        directBookAudits,
        directAuditNote: auditDirect
          ? 'Direct bookmaker checks spend paid odds credits: 3 credits per sport/book for h2h,spreads,totals.'
          : 'Direct bookmaker checks were not run. Add auditDirect=1&books=book1,book2&sports=sport_key to spend credits on targeted proof.',
        checks: checks.map(({ rows, ...check }) => check)
      });
    }

    if (auditAccuracy) {
      const bookSet = [...new Set(ACCURACY_TARGETS.map(target => target.book))];
      const cases = [
        ['all-books h2h/spreads/totals', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }]
      ];
      for (const book of bookSet) {
        cases.push(
          [`${book} h2h/spreads/totals`, { bookmakers: book, markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }],
          [`${book} h2h only`, { bookmakers: book, markets: 'h2h', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }],
          [`${book} spreads only`, { bookmakers: book, markets: 'spreads', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }],
          [`${book} totals only`, { bookmakers: book, markets: 'totals', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }]
        );
      }

      const results = [];
      for (const [label, params] of cases) {
        const result = await callParlay('/sports/baseball_mlb/odds', params);
        checks.push(result);
        const targetMatches = {};
        for (const target of ACCURACY_TARGETS) {
          targetMatches[target.id] = auditTargetMatches(result.rows, target);
        }
        results.push({
          label,
          endpoint: result.endpoint,
          query: result.query,
          status: result.status,
          ok: result.ok,
          responseMs: result.elapsedMs,
          creditHeaders: result.creditHeaders,
          rawEventCount: result.rows.length,
          ...summarizeOddsRows(result.rows),
          targetMatches
        });
      }
      return res.status(200).json({
        pulledAt: new Date().toISOString(),
        audit: 'accuracy_examples',
        sourcePriceType: 'american',
        timeWindow,
        targets: ACCURACY_TARGETS,
        results
      });
    }

    if (auditBovadaAtlSd) {
      const cases = [
        {
          label: 'production all-books with date filter',
          params: {
            regions: 'us',
            markets: 'h2h,spreads,totals',
            oddsFormat: 'american',
            commenceTimeFrom: timeWindow.commenceTimeFrom,
            commenceTimeTo: timeWindow.commenceTimeTo
          }
        },
        {
          label: 'bovada supplement with date filter',
          params: {
            bookmakers: 'bovada',
            markets: 'h2h,spreads,totals',
            oddsFormat: 'american',
            commenceTimeFrom: timeWindow.commenceTimeFrom,
            commenceTimeTo: timeWindow.commenceTimeTo
          }
        },
        {
          label: 'bovada supplement without date filter',
          params: {
            bookmakers: 'bovada',
            markets: 'h2h,spreads,totals',
            oddsFormat: 'american'
          }
        }
      ];
      const results = [];
      for (const item of cases) {
        const result = await callParlay('/sports/baseball_mlb/odds', item.params);
        checks.push(result);
        const matches = findBovadaAtlSdRows(result.rows);
        results.push({
          label: item.label,
          endpoint: result.endpoint,
          query: result.query,
          status: result.status,
          ok: result.ok,
          creditHeaders: result.creditHeaders,
          rawEventCount: result.rows.length,
          matchesFound: matches.length,
          exactRows: matches.map(match => ({
            event_id: match.event.id || null,
            commence_time: match.event.commence_time || null,
            home_team: match.event.home_team || null,
            away_team: match.event.away_team || null,
            bookmaker_key: match.bookmaker.key || null,
            bookmaker_title: match.bookmaker.title || null,
            bookmaker_last_update: match.bookmaker.last_update || null,
            market_key: match.market.key || null,
            market_last_update: match.market.last_update || null,
            outcome_name: match.outcome.name || null,
            outcome_price: match.outcome.price ?? null,
            outcome_point: match.outcome.point ?? null,
            rawEvent: match.event,
            rawBookmaker: match.bookmaker,
            rawMarket: match.market,
            rawOutcome: match.outcome
          }))
        });
      }
      return res.status(200).json({
        pulledAt: new Date().toISOString(),
        audit: 'bovada_atl_sd',
        target: {
          sport: 'baseball_mlb',
          game: 'ATL vs SD',
          bookmaker: 'bovada',
          outcome: 'Atlanta Braves',
          displayedPriceToInvestigate: -109
        },
        timeWindow,
        results
      });
    }

    if (auditProductionIssues) {
      const startedAt = Date.now();
      const majorBooks = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'bovada', 'pinnacle', 'bet365', 'fanatics', 'hardrock', 'betrivers'];
      const mlbBookAudits = [];
      const mlbBookCases = [];
      for (const bookmaker of majorBooks) {
        mlbBookCases.push(
          [`${bookmaker} all markets one call`, bookmaker, { bookmakers: bookmaker, markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }],
          [`${bookmaker} h2h only`, bookmaker, { bookmakers: bookmaker, markets: 'h2h', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }],
          [`${bookmaker} spreads only`, bookmaker, { bookmakers: bookmaker, markets: 'spreads', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }],
          [`${bookmaker} totals only`, bookmaker, { bookmakers: bookmaker, markets: 'totals', oddsFormat: 'american', commenceTimeFrom: timeWindow.commenceTimeFrom, commenceTimeTo: timeWindow.commenceTimeTo }]
        );
      }
      const bookResults = await Promise.allSettled(mlbBookCases.map(([label, bookmaker, params]) =>
        callParlay('/sports/baseball_mlb/odds', params).then(result => ({ label, bookmaker, result, elapsedMs: result.elapsedMs }))
      ));
      for (const settled of bookResults) {
        if (settled.status === 'rejected') {
          mlbBookAudits.push({ ok: false, error: settled.reason?.message || String(settled.reason) });
          continue;
        }
        checks.push(settled.value.result);
        mlbBookAudits.push({
          label: settled.value.label,
          bookmaker: settled.value.bookmaker,
          status: settled.value.result.status,
          ok: settled.value.result.ok,
          creditHeaders: settled.value.result.creditHeaders,
          responseMs: settled.value.result.elapsedMs,
          ...summarizeMainLineEvents(settled.value.result.rows)
        });
      }

      const propsStarted = Date.now();
      const props = await callParlay('/sports/baseball_mlb/props', {
        oddsFormat: 'american',
        commenceTimeFrom: timeWindow.commenceTimeFrom,
        commenceTimeTo: timeWindow.commenceTimeTo
      });
      props.elapsedMs = Date.now() - propsStarted;
      checks.push(props);

      const multisport = [];
      const sportCandidates = [
        'baseball_mlb',
        'basketball_wnba',
        'americanfootball_nfl',
        'americanfootball_ncaaf',
        'basketball_ncaab',
        'basketball_nba',
        'icehockey_nhl',
        'mma_mixed_martial_arts',
        'tennis',
        'tennis_atp',
        'tennis_wta'
      ];
      const sportCalls = await Promise.allSettled(sportCandidates.map(async sportKey => {
        const sportRow = sportsByKey.get(sportKey);
        const odds = sportRow?.active
          ? await callParlay(`/sports/${sportKey}/odds`, {
              regions: 'us',
              markets: 'h2h,spreads,totals',
              oddsFormat: 'american',
              commenceTimeFrom: timeWindow.commenceTimeFrom,
              commenceTimeTo: timeWindow.commenceTimeTo
            })
          : null;
        let propsResult = null;
        if (sportRow?.active) {
          try {
            propsResult = await callParlay(`/sports/${sportKey}/props`, {
              oddsFormat: 'american',
              commenceTimeFrom: timeWindow.commenceTimeFrom,
              commenceTimeTo: timeWindow.commenceTimeTo
            });
          } catch (_) {}
        }
        return { sportKey, sportRow, odds, propsResult };
      }));
      for (const settled of sportCalls) {
        if (settled.status === 'rejected') {
          multisport.push({ ok: false, error: settled.reason?.message || String(settled.reason) });
          continue;
        }
        const { sportKey, sportRow, odds, propsResult } = settled.value;
        if (odds) checks.push(odds);
        if (propsResult) checks.push(propsResult);
        multisport.push({
          sportKey,
          title: sportRow?.title || null,
          active: !!sportRow?.active,
          matcherType: /tennis/i.test(sportKey) ? 'player-vs-player'
            : /mma/i.test(sportKey) ? 'fighter-vs-fighter'
            : /football|basketball|baseball|hockey/i.test(sportKey) ? 'team-vs-team'
            : 'unknown',
          currentMatcherSupports: SPORTS.includes(sportKey),
          odds: odds ? {
            status: odds.status,
            creditHeaders: odds.creditHeaders,
            responseMs: odds.elapsedMs,
            ...summarizeMainLineEvents(odds.rows)
          } : null,
          props: propsResult ? {
            status: propsResult.status,
            creditHeaders: propsResult.creditHeaders,
            responseMs: propsResult.elapsedMs,
            ...summarizePropsRows(propsResult.rows)
          } : null
        });
      }

      return res.status(200).json({
        ok: true,
        pulledAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedAt,
        currentLookaheadDays: timeWindow.lookaheadDays,
        timeWindow,
        mlbMainLineBookAudit: mlbBookAudits,
        mlbPropsAudit: {
          status: props.status,
          ok: props.ok,
          creditHeaders: props.creditHeaders,
          responseMs: props.elapsedMs,
          ...summarizePropsRows(props.rows),
          canNormalizeIntoSeparatePropMatcher: props.rows.some(row =>
            (row.player || row.player_name || row.participant) &&
            (row.line != null || row.point != null || row.strike != null) &&
            (row.over_price != null || Array.isArray(row.outcomes)) &&
            (row.under_price != null || Array.isArray(row.outcomes))
          )
        },
        multisportAudit: multisport,
        checks: checks.map(({ rows, ...check }) => check)
      });
    }

    const mlbShapeAudit = [];
    if (auditMlbShapes) {
      const mlbSportRows = sports.rows
        .filter(row => /baseball|mlb|major league/i.test(`${row.key || ''} ${row.title || ''} ${row.group || ''} ${row.description || ''}`))
        .map(compactRow);
      const alternateBaseballKeys = mlbSportRows
        .map(row => row.key)
        .filter(key => key && key !== 'baseball_mlb');

      const fromIsoMs = timeWindow.commenceTimeFrom;
      const toIsoMs = timeWindow.commenceTimeTo;
      const fromIsoNoMs = isoNoMilliseconds(timeWindow.fromMs);
      const toIsoNoMs = isoNoMilliseconds(timeWindow.toMs);
      const fromDate = dateOnly(timeWindow.fromMs);
      const toDate = dateOnly(timeWindow.toMs);

      const shapeCases = [
        ['A no params except oddsFormat', { oddsFormat: 'american' }],
        ['B region only', { regions: 'us', oddsFormat: 'american' }],
        ['C market h2h only', { markets: 'h2h', oddsFormat: 'american' }],
        ['C market spreads only', { markets: 'spreads', oddsFormat: 'american' }],
        ['C market totals only', { markets: 'totals', oddsFormat: 'american' }],
        ['D all markets no region', { markets: 'h2h,spreads,totals', oddsFormat: 'american' }],
        ['E region h2h', { regions: 'us', markets: 'h2h', oddsFormat: 'american' }],
        ['E region spreads', { regions: 'us', markets: 'spreads', oddsFormat: 'american' }],
        ['E region totals', { regions: 'us', markets: 'totals', oddsFormat: 'american' }],
        ['F region all markets', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american' }],
        ['F region all markets include live', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', include_live: 'true' }],
        ['F region all markets live only', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', live: 'true' }],
        ['G date only ISO milliseconds', { oddsFormat: 'american', commenceTimeFrom: fromIsoMs, commenceTimeTo: toIsoMs }],
        ['H region all markets date ISO milliseconds', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: fromIsoMs, commenceTimeTo: toIsoMs }],
        ['H region all markets date ISO milliseconds include live', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', include_live: 'true', commenceTimeFrom: fromIsoMs, commenceTimeTo: toIsoMs }],
        ['H region all markets date ISO milliseconds live only', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', live: 'true', commenceTimeFrom: fromIsoMs, commenceTimeTo: toIsoMs }],
        ['H region all markets date ISO no milliseconds', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: fromIsoNoMs, commenceTimeTo: toIsoNoMs }],
        ['H region all markets date only', { regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: fromDate, commenceTimeTo: toDate }]
      ];

      const bookmakerKeysToTest = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'bovada', 'pinnacle'];
      const bookmakerCsvToTest = bookmakerKeysToTest.join(',');
      shapeCases.push(
        ['bookmaker CSV h2h no region', { bookmakers: bookmakerCsvToTest, markets: 'h2h', oddsFormat: 'american' }],
        ['bookmaker CSV all markets no region', { bookmakers: bookmakerCsvToTest, markets: 'h2h,spreads,totals', oddsFormat: 'american' }],
        ['bookmaker CSV all markets include live', { bookmakers: bookmakerCsvToTest, markets: 'h2h,spreads,totals', oddsFormat: 'american', include_live: 'true' }],
        ['bookmaker CSV all markets date ISO milliseconds', { bookmakers: bookmakerCsvToTest, markets: 'h2h,spreads,totals', oddsFormat: 'american', commenceTimeFrom: fromIsoMs, commenceTimeTo: toIsoMs }],
        ['bookmaker CSV all markets date ISO milliseconds include live', { bookmakers: bookmakerCsvToTest, markets: 'h2h,spreads,totals', oddsFormat: 'american', include_live: 'true', commenceTimeFrom: fromIsoMs, commenceTimeTo: toIsoMs }]
      );
      for (const bookmaker of bookmakerKeysToTest) {
        shapeCases.push(
          [`bookmaker ${bookmaker} h2h no region`, { bookmakers: bookmaker, markets: 'h2h', oddsFormat: 'american' }],
          [`bookmaker ${bookmaker} h2h include live`, { bookmakers: bookmaker, markets: 'h2h', oddsFormat: 'american', include_live: 'true' }],
          [`bookmaker ${bookmaker} h2h live only`, { bookmakers: bookmaker, markets: 'h2h', oddsFormat: 'american', live: 'true' }],
          [`bookmaker ${bookmaker} h2h with region`, { regions: 'us', bookmakers: bookmaker, markets: 'h2h', oddsFormat: 'american' }],
          [`bookmaker ${bookmaker} no market no region`, { bookmakers: bookmaker, oddsFormat: 'american' }],
          [`bookmaker ${bookmaker} no market with region`, { regions: 'us', bookmakers: bookmaker, oddsFormat: 'american' }]
        );
      }

      for (const [label, params] of shapeCases) {
        const result = await callParlay('/sports/baseball_mlb/odds', params);
        checks.push(result);
        mlbShapeAudit.push(summarizeMlbShapeCall(label, result));
      }

      for (const sportKey of alternateBaseballKeys) {
        const result = await callParlay(`/sports/${sportKey}/odds`, { oddsFormat: 'american' });
        checks.push(result);
        mlbShapeAudit.push(summarizeMlbShapeCall(`alternate baseball key ${sportKey} oddsFormat only`, result));
      }

      const openApi = await callParlayUrl(new URL('https://parlay-api.com/openapi.json'), '/openapi.json');
      checks.push(openApi);

      return res.status(200).json({
        ok: true,
        pulledAt: new Date().toISOString(),
        currentLookaheadDays: timeWindow.lookaheadDays,
        timeWindow: {
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo,
          commenceTimeFromNoMilliseconds: fromIsoNoMs,
          commenceTimeToNoMilliseconds: toIsoNoMs,
          commenceDateFrom: fromDate,
          commenceDateTo: toDate
        },
        mlbSportRows,
        openApiStatus: openApi.status,
        openApiCreditHeaders: openApi.creditHeaders,
        openApiTopLevelKeys: openApi.payloadTopLevelKeys,
        audit: mlbShapeAudit,
        checks: checks.map(({ rows, ...check }) => check)
      });
    }

    const inventoryAudit = [];
    if (auditInventory) {
      for (const sport of SPORTS) {
        const withDate = await callParlay(`/sports/${sport}/odds`, {
          regions: 'us',
          markets: 'h2h,spreads,totals',
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        });
        checks.push(withDate);

        const withoutDate = await callParlay(`/sports/${sport}/odds`, {
          regions: 'us',
          markets: 'h2h,spreads,totals',
          oddsFormat: 'american'
        });
        checks.push(withoutDate);

        inventoryAudit.push({
          sport,
          withDateFilter: {
            endpoint: withDate.endpoint,
            query: withDate.query,
            status: withDate.status,
            ok: withDate.ok,
            creditHeaders: withDate.creditHeaders,
            ...summarizeOddsRows(withDate.rows)
          },
          withoutDateFilter: {
            endpoint: withoutDate.endpoint,
            query: withoutDate.query,
            status: withoutDate.status,
            ok: withoutDate.ok,
            creditHeaders: withoutDate.creditHeaders,
            ...summarizeOddsRows(withoutDate.rows)
          }
        });
      }
    }

    for (const sport of SPORTS) {
      const odds = await callParlay(`/sports/${sport}/odds`, {
        regions: 'us',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'american',
        commenceTimeFrom: timeWindow.commenceTimeFrom,
        commenceTimeTo: timeWindow.commenceTimeTo
      });
      checks.push(odds);

      for (const ev of odds.rows.filter(row => inTimeWindow(row.commence_time, timeWindow))) {
        for (const book of ev.bookmakers || []) {
          const key = sourceKey(book);
          if (!key) continue;
          if (REMOVED_BOOK_SET.has(key)) {
            removedBooksSeen[key] = book.title || book.name || key;
          } else if (FINAL_BOOK_SET.has(key)) {
            bookmakerSeen[key] = book.title || book.name || key;
          } else {
            unsupportedBooksSeen[key] = book.title || book.name || key;
          }
        }
      }

      const exchangeCalls = SUPPORTED_EXCHANGE_CALLS.filter(call => call.sport === sport);
      for (const { exchange: exchangeKey } of exchangeCalls) {
        const exchangeMarkets = await callParlay(`/exchange/${sport}/markets`, {
          exchange: exchangeKey
        });
        checks.push(exchangeMarkets);

        const exchangeRowsInWindow = exchangeMarkets.rows.filter(row => inTimeWindow(row.commence_time, timeWindow));
        if (!exchangeMarketCounts[exchangeKey]) exchangeMarketCounts[exchangeKey] = {};
        exchangeMarketCounts[exchangeKey][sport] = {
          raw: exchangeMarkets.rowCount,
          inLookaheadWindow: exchangeRowsInWindow.length
        };
        if (!exchangeRowsInLookaheadWindow[exchangeKey]) exchangeRowsInLookaheadWindow[exchangeKey] = {};
        exchangeRowsInLookaheadWindow[exchangeKey][sport] = exchangeRowsInWindow.map(compactRow);

        if (exchangeRowsInWindow.length > 0) {
          const exchangeMeta = exchangesAvailable.find(e => e.key === exchangeKey);
          exchangeSeen[exchangeKey] = exchangeMeta?.title || exchangeKey;
        }
      }
    }

    const bookmakersCurrentlySeen = Object.entries(bookmakerSeen)
      .map(([key, title]) => ({ key, title }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const exchangesCurrentlySeen = Object.entries(exchangeSeen)
      .map(([key, title]) => ({ key, title }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const booksReturnedByParlay = [...bookmakersCurrentlySeen, ...exchangesCurrentlySeen]
      .filter((row, idx, arr) => arr.findIndex(other => other.key === row.key) === idx)
      .sort((a, b) => a.key.localeCompare(b.key));

    const expansionAudit = [];
    const propsAudit = [];
    const eventsAudit = [];
    if (auditExpansion) {
      for (const sport of SPORTS) {
        const events = await callParlay(`/sports/${sport}/events`, {
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        });
        checks.push(events);
        eventsAudit.push({
          sport,
          rowCount: events.rows.length,
          creditHeaders: events.creditHeaders,
          sampleRows: events.rows.slice(0, 2).map(compactRow),
          supportAssessment: 'event precheck candidate; only useful if cheaper than the matching odds call'
        });
      }

      for (const candidate of EXPANSION_CANDIDATE_SPORTS) {
        const sportRow = sportsByKey.get(candidate.key);
        if (!sportRow?.active) {
          expansionAudit.push({
            ...candidate,
            active: !!sportRow?.active,
            oddsChecked: false,
            rowCount: 0,
            creditHeaders: {},
            supportAssessment: sportRow ? 'not active' : 'not returned by /v1/sports'
          });
          continue;
        }

        const odds = await callParlay(`/sports/${candidate.key}/odds`, {
          regions: 'us',
          markets: 'h2h,spreads,totals',
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        });
        checks.push(odds);
        const rows = odds.rows.filter(row => inTimeWindow(row.commence_time, timeWindow));
        const hasHomeAway = rows.some(row => row.home_team && row.away_team);
        expansionAudit.push({
          ...candidate,
          active: true,
          oddsChecked: true,
          rowCount: rows.length,
          rawRowCount: odds.rowCount,
          creditHeaders: odds.creditHeaders,
          sampleRows: rows.slice(0, 2).map(compactRow),
          supportAssessment: hasHomeAway
            ? `${candidate.matcher}; live rows expose home_team/away_team`
            : `${candidate.matcher}; no verified home_team/away_team rows in the 5-day odds response`
        });
      }

      for (const sport of SPORTS) {
        const props = await callParlay(`/sports/${sport}/props`, {
          regions: 'us',
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        });
        checks.push(props);
        propsAudit.push({
          sport,
          rowCount: props.rows.length,
          creditHeaders: props.creditHeaders,
          sampleRows: props.rows.slice(0, 2).map(compactRow),
          supportAssessment: 'not used by production scanner; player matching/stat normalization must be proven before enabling'
        });
      }
    }
    const cleanChecks = checks.map(({ rows, ...check }) => check);

    return res.status(200).json({
      ok: true,
      pulledAt: new Date().toISOString(),
      activeSportKeys,
      supportedSportKeysCurrentlyIncluded: SPORTS,
      excludedActiveSportKeys: excludedActiveSports(sports.rows),
      bookmakersAvailable,
      exchangesAvailable,
      finalDisplayedAllowedBookKeys: FINAL_BOOK_KEYS,
      booksReturnedByParlay,
      booksRemovedByExclusionList: REMOVED_BOOK_KEYS,
      removedBooksSeenInProductionOdds: Object.entries(removedBooksSeen)
        .map(([key, title]) => ({ key, title }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      unsupportedBooksSeenInProductionOdds: Object.entries(unsupportedBooksSeen)
        .map(([key, title]) => ({ key, title }))
        .sort((a, b) => a.key.localeCompare(b.key)),
      currentLookaheadDays: timeWindow.lookaheadDays,
      commenceTimeFiltering: {
        oddsSupportedByOpenApi: true,
        oddsAppliedUpstream: true,
        oddsAlsoFilteredServerSide: true,
        exchangeSupportedByOpenApi: false,
        exchangeAppliedUpstream: false,
        exchangeFilteredServerSide: true,
        commenceTimeFrom: timeWindow.commenceTimeFrom,
        commenceTimeTo: timeWindow.commenceTimeTo
      },
      bookmakersCurrentlySeen,
      exchangesCurrentlySeen,
      bookmakersMissing: setDiff(bookmakersAvailable, bookmakersCurrentlySeen),
      exchangesMissing: setDiff(exchangesAvailable, exchangesCurrentlySeen),
      exchangeMarketCounts,
      exchangeRowsInLookaheadWindow,
      expansionAuditEnabled: auditExpansion,
      expansionAudit,
      propsAudit,
      eventsAudit,
      inventoryAuditEnabled: auditInventory,
      inventoryAudit,
      checks: cleanChecks
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
