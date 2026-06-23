// api/parlay-sources.js
// Manual ParlayAPI source audit. Not used by the scanner UI.

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

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
  { key: 'basketball_wnba', label: 'WNBA', matcher: 'team sport; needs team map if ParlayAPI exposes home_team/away_team' },
  { key: 'americanfootball_ncaaf', label: 'NCAAF', matcher: 'team sport; needs college team normalization' },
  { key: 'basketball_ncaab', label: 'NCAAB', matcher: 'team sport; needs college team normalization' },
  { key: 'mma_mixed_martial_arts', label: 'UFC/MMA', matcher: 'fighter-vs-fighter; needs non-team matcher verification' },
  { key: 'tennis', label: 'Tennis', matcher: 'player-vs-player; needs non-team matcher verification' },
  { key: 'tennis_atp', label: 'ATP Tennis', matcher: 'player-vs-player; needs non-team matcher verification' },
  { key: 'tennis_wta', label: 'WTA Tennis', matcher: 'player-vs-player; needs non-team matcher verification' },
  { key: 'golf_pga_championship', label: 'Golf', matcher: 'usually outrights/player markets; not safe for current two-sided game matcher' }
];

const SPORT_EXCLUSION_REASONS = {
  basketball_wnba: 'not enabled yet; team normalization and active event coverage need scanner verification',
  americanfootball_ncaaf: 'seasonal; not enabled until current events can be verified without adding dead calls',
  basketball_ncaab: 'seasonal; not enabled until current events can be verified without adding dead calls',
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

async function callParlay(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const r = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': API_KEY
    },
    signal: AbortSignal.timeout(20000)
  });

  const text = await r.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) {}

  const rows = listFromPayload(payload);

  return {
    endpoint: path,
    query: params,
    status: r.status,
    ok: r.ok,
    creditHeaders: interestingHeaders(r.headers),
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

function setDiff(allRows, seenRows) {
  const seen = new Set(seenRows.map(row => row.key));
  return allRows.filter(row => !seen.has(row.key));
}

function excludedActiveSports(sportsRows) {
  return sportsRows
    .filter(row => row.active && !SPORTS.includes(row.key))
    .map(row => ({
      key: row.key,
      title: row.title || row.name || row.key,
      reason: SPORT_EXCLUSION_REASONS[row.key] || 'not enabled; current matcher is verified only for MLB/NBA/NFL/NHL team games'
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
