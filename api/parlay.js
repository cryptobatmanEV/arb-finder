// api/parlay.js

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
const SPORTSBOOK_BOOK_SET = new Set([
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
  'stake',
  'sugarhouse',
  'tipico'
]);
const CALL_TIMEOUT_MS = Number(process.env.PARLAY_CALL_TIMEOUT_MS || 9000);

const EXCHANGE_TITLES = {
  novig: 'Novig',
  prophetx: 'ProphetX'
};

const SUPPORTED_EXCHANGE_CALLS = [
  // Verified useful on 2026-06-23:
  // /v1/exchange/baseball_mlb/markets?exchange=prophetx returns MLB game totals.
  { exchange: 'prophetx', sport: 'baseball_mlb' }
];

const SUPPLEMENTAL_MLB_BOOK_CALLS = [
  // Verified via /api/parlay-sources?auditProductionIssues=1 on 2026-06-23.
  // Individual bookmaker calls return active MLB rows that the all-books call
  // currently misses. Use all main-line markets only when the book returns them.
  { bookmaker: 'fanduel', markets: 'h2h,spreads,totals' },
  { bookmaker: 'betmgm', markets: 'h2h,spreads,totals' },
  { bookmaker: 'caesars', markets: 'h2h,spreads,totals' },
  { bookmaker: 'bovada', markets: 'h2h,spreads,totals' },
  { bookmaker: 'pinnacle', markets: 'h2h' },
  { bookmaker: 'fanatics', markets: 'h2h,spreads,totals' },
  { bookmaker: 'betrivers', markets: 'h2h,spreads,totals' }
];

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

function implied(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function americanFromProbability(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null;
  return p >= 0.5
    ? -Math.round((p / (1 - p)) * 100)
    : Math.round(((1 - p) / p) * 100);
}

function sportShort(sport) {
  if (sport === 'baseball_mlb') return 'mlb';
  if (sport === 'basketball_nba') return 'nba';
  if (sport === 'americanfootball_nfl') return 'nfl';
  if (sport === 'icehockey_nhl') return 'nhl';
  return sport;
}

function googleUrl(book, away, home) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(`${book} ${away} ${home} odds`);
}

function marketDedupeKey(market) {
  const eventDate = String(market.startTime || '').slice(0, 10);
  return [
    market.platform,
    market.sport,
    market.marketType,
    market.away,
    market.home,
    eventDate,
    market.line ?? '',
    market.favoredTeamName || ''
  ].map(value => String(value || '').toLowerCase()).join('|');
}

function pushUniqueMarkets(target, candidates, seenKeys) {
  let added = 0;
  for (const market of candidates) {
    const key = marketDedupeKey(market);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    target.push(market);
    added += 1;
  }
  return added;
}

function eventDateForMatch(startTime) {
  const ms = new Date(startTime || '').getTime();
  if (!Number.isFinite(ms)) return '';
  return new Date(ms - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function comparisonGameKey(m) {
  return [
    m.sport,
    m.away,
    m.home,
    eventDateForMatch(m.startTime)
  ].map(value => String(value || '').toLowerCase()).join('|');
}

function comparisonMarketKey(m) {
  return [
    comparisonGameKey(m),
    m.marketType,
    m.marketType === 'spread' ? String(m.favoredTeamName || '').toLowerCase() : '',
    m.line == null ? '' : String(m.line)
  ].join('|');
}

function bestPairPricing(mA, mB) {
  const combos = [
    { sideA: 'YES', sideB: 'NO', priceA: mA.yesPrice, priceB: mB.noPrice },
    { sideA: 'NO', sideB: 'YES', priceA: mA.noPrice, priceB: mB.yesPrice }
  ].filter(c => c.priceA && c.priceB);
  if (!combos.length) return null;
  combos.sort((a, b) => (a.priceA + a.priceB) - (b.priceA + b.priceB));
  const best = combos[0];
  const impliedSum = best.priceA + best.priceB;
  return {
    ...best,
    impliedSum,
    holdPercent: (impliedSum - 1) * 100,
    marginPercent: (1 - impliedSum) * 100,
    isArb: impliedSum < 1,
    isNear: impliedSum >= 1 && impliedSum < 1.02
  };
}

function sportsbookDiagnostics(markets) {
  const sportsbook = (markets || []).filter(m => SPORTSBOOK_BOOK_SET.has(m.platform));
  const bySport = {};
  const byBook = {};
  const normalizedByMarketType = {};
  for (const market of sportsbook) {
    bySport[market.sport] = (bySport[market.sport] || 0) + 1;
    byBook[market.platform] = (byBook[market.platform] || 0) + 1;
    normalizedByMarketType[market.marketType] = (normalizedByMarketType[market.marketType] || 0) + 1;
  }

  const groups = new Map();
  for (const market of sportsbook) {
    const key = comparisonMarketKey(market);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(market);
  }

  const matchedPairsByMarketType = { moneyline: 0, spread: 0, total: 0 };
  const bestByMarketType = {};
  const comparisons = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const mA = group[i];
        const mB = group[j];
        if (mA.platform === mB.platform) continue;
        const pricing = bestPairPricing(mA, mB);
        if (!pricing) continue;
        matchedPairsByMarketType[mA.marketType] = (matchedPairsByMarketType[mA.marketType] || 0) + 1;
        const row = {
          sport: mA.sport,
          game: `${mA.away} @ ${mA.home}`,
          startTime: mA.startTime,
          marketType: mA.marketType,
          line: mA.line ?? null,
          sideTeam: mA.favoredTeamName || null,
          bookA: mA.platform,
          bookB: mB.platform,
          sideA: pricing.sideA,
          sideB: pricing.sideB,
          priceA: pricing.priceA,
          priceB: pricing.priceB,
          holdPercent: pricing.holdPercent,
          marginPercent: pricing.marginPercent,
          isArb: pricing.isArb,
          isNear: pricing.isNear
        };
        comparisons.push(row);
        const current = bestByMarketType[mA.marketType];
        if (!current || row.marginPercent > current.marginPercent) bestByMarketType[mA.marketType] = row;
      }
    }
  }

  comparisons.sort((a, b) => b.marginPercent - a.marginPercent);
  const liveArbCount = comparisons.filter(row => row.isArb).length;
  const nearArbCount = comparisons.filter(row => row.isNear).length;

  return {
    rawMarketsBySport: bySport,
    rawMarketsByBook: byBook,
    normalizedMarketsBySport: bySport,
    normalizedMarketsByBook: byBook,
    normalizedMarketsByMarketType: normalizedByMarketType,
    matchedPairsByMarketType,
    matchedPairCount: comparisons.length,
    liveArbCount,
    nearArbCount,
    renderedCardCountEstimate: liveArbCount + nearArbCount,
    bestByMarketType,
    closestArbPair: comparisons[0] || null,
    best20Comparisons: comparisons.slice(0, 20)
  };
}

function noteSkip(debug, reason) {
  if (!debug) return;
  debug.skipped[reason] = (debug.skipped[reason] || 0) + 1;
}

function normalizeBookKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function summarizeEvents(events, predicate = () => true) {
  const books = {};
  let eventCount = 0;
  let bookmakerEntryCount = 0;
  let marketCount = 0;
  let outcomeCount = 0;

  for (const ev of events || []) {
    let eventIncluded = false;
    for (const book of ev.bookmakers || []) {
      const key = normalizeBookKey(book.key);
      if (!key || !predicate(key)) continue;
      eventIncluded = true;
      bookmakerEntryCount += 1;
      books[key] = (books[key] || 0) + 1;
      for (const market of book.markets || []) {
        marketCount += 1;
        outcomeCount += (market.outcomes || []).length;
      }
    }
    if (eventIncluded) eventCount += 1;
  }

  return {
    eventCount,
    bookmakerEntryCount,
    bookmakerKeysSeen: Object.keys(books).sort(),
    bookmakerEventCounts: books,
    marketCount,
    outcomeCount
  };
}

function normalizeEvent(ev, sport, debug) {
  const out = [];
  const home = ev.home_team;
  const away = ev.away_team;
  const startTime = ev.commence_time;

  if (!home || !away) {
    noteSkip(debug, 'missing_teams');
    return out;
  }

  for (const book of ev.bookmakers || []) {
    const platform = normalizeBookKey(book.key);
    const bookTitle = book.title || book.key;
    if (!platform) {
      noteSkip(debug, 'missing_book_key');
      continue;
    }
    if (REMOVED_BOOK_SET.has(platform)) {
      noteSkip(debug, `excluded_book_${platform}`);
      continue;
    }
    if (!FINAL_BOOK_SET.has(platform)) {
      noteSkip(debug, `unsupported_book_${platform}`);
      continue;
    }

    for (const market of book.markets || []) {
      const key = market.key;
      const outcomes = market.outcomes || [];

      if (key === 'h2h') {
        const awayOut = outcomes.find(o => o.name === away);
        const homeOut = outcomes.find(o => o.name === home);

        const yesPrice = implied(awayOut?.price);
        const noPrice = implied(homeOut?.price);

        if (!yesPrice || !noPrice) {
          noteSkip(debug, 'h2h_missing_prices');
          continue;
        }

        out.push({
          id: `${ev.id}-${platform}-h2h`,
          source: 'parlay',
          platform,
          bookTitle,
          sport: sportShort(sport),
          marketType: 'moneyline',
          home,
          away,
          startTime,
          yesPrice,
          noPrice,
          rawTitle: `${away} vs ${home}`,
          noTitle: `${away} vs ${home}`,
          url: googleUrl(bookTitle, away, home)
        });
      }

      if (key === 'totals') {
        const over = outcomes.find(o => /over/i.test(o.name));
        const under = outcomes.find(o => /under/i.test(o.name));

        const yesPrice = implied(over?.price);
        const noPrice = implied(under?.price);
        const point = over?.point ?? under?.point;

        if (!yesPrice || !noPrice || point == null) {
          noteSkip(debug, 'total_missing_prices_or_line');
          continue;
        }

        out.push({
          id: `${ev.id}-${platform}-total-${point}`,
          source: 'parlay',
          platform,
          bookTitle,
          sport: sportShort(sport),
          marketType: 'total',
          home,
          away,
          startTime,
          line: Number(point),
          yesPrice,
          noPrice,
          rawTitle: `${away} vs ${home}: O/U ${point}`,
          noTitle: `${away} vs ${home}: O/U ${point}`,
          url: googleUrl(bookTitle, away, home)
        });
      }

      if (key === 'spreads') {
        for (const side of outcomes) {
          const team = side.name;
          const point = side.point;
          const yesPrice = implied(side.price);

          if (!team || point == null || !yesPrice) {
            noteSkip(debug, 'spread_missing_team_price_or_line');
            continue;
          }

          const other = outcomes.find(o => o.name !== team);
          const noPrice = implied(other?.price);

          if (!noPrice) {
            noteSkip(debug, 'spread_missing_other_price');
            continue;
          }

          out.push({
            id: `${ev.id}-${platform}-spread-${team}-${point}`,
            source: 'parlay',
            platform,
            bookTitle,
            sport: sportShort(sport),
            marketType: 'spread',
            home,
            away,
            startTime,
            line: Math.abs(Number(point)),
            yesPrice,
            noPrice,
            favoredTeamName: team,
            rawTitle: `Spread: ${team} (${Number(point) > 0 ? '+' : ''}${point})`,
            noTitle: `Spread: ${team} (${Number(point) > 0 ? '+' : ''}${point})`,
            url: googleUrl(bookTitle, away, home)
          });
        }
      }
    }
  }

  return out;
}

function normalizeExchangeMarket(exchangeKey, m, sport, debug) {
  const home = m.home_team;
  const away = m.away_team;
  const startTime = m.commence_time;
  const line = m.strike;
  const marketType = String(m.market_type || '').toLowerCase();
  const marketKey = String(m.market_key || '').toLowerCase();
  const platform = normalizeBookKey(exchangeKey || m.exchange);
  const bookTitle = EXCHANGE_TITLES[platform] || platform;

  if (!platform || !home || !away || !startTime) {
    noteSkip(debug, 'exchange_missing_event_fields');
    return null;
  }

  if (marketType !== 'runs') {
    noteSkip(debug, 'exchange_unsupported_market_type');
    return null;
  }

  // ProphetX currently returns market_type "Runs" with market_key "player_runs".
  // That is not a verified game total, even though the row has home/away teams.
  if (!['totals', 'total', 'game_total', 'game_totals'].includes(marketKey)) {
    noteSkip(debug, `exchange_unsupported_market_key_${marketKey || 'missing'}`);
    return null;
  }

  const overPrice = implied(m.over_price);
  const underPrice = implied(m.under_price);

  if (line == null || !overPrice || !underPrice) {
    noteSkip(debug, 'exchange_missing_prices_or_line');
    return null;
  }

  return {
    id: `${platform}-${sport}-${away}-${home}-${startTime}-total-${line}`,
    source: 'parlay',
    platform,
    bookTitle,
    sport: sportShort(sport),
    marketType: 'total',
    home,
    away,
    startTime,
    line: Number(line),
    yesPrice: overPrice,
    noPrice: underPrice,
    rawYesPrice: overPrice,
    rawNoPrice: underPrice,
    rawOverPrice: m.over_price ?? null,
    rawUnderPrice: m.under_price ?? null,
    overAmerican: americanFromProbability(overPrice),
    underAmerican: americanFromProbability(underPrice),
    marketKey: m.market_key || null,
    exchangeMarketType: m.market_type || null,
    exchangeLastUpdate: m.last_update || null,
    exchangeVolumeUsd: m.volume_usd ?? null,
    rawTitle: `${away} vs ${home}: O/U ${line}`,
    noTitle: `${away} vs ${home}: O/U ${line}`,
    url: googleUrl(bookTitle, away, home)
  };
}

function creditHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    if (/credit|request|usage|remaining|used|cost|quota|ratelimit/i.test(key)) {
      out[key] = value;
    }
  });
  return out;
}

async function fetchJson(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const startedAt = Date.now();
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': API_KEY
    },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
  });
  const elapsedMs = Date.now() - startedAt;
  const text = await response.text();
  const json = response.ok ? JSON.parse(text) : null;
  return { response, text, json, elapsedMs };
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.exchanges)) return payload.exchanges;
  if (Array.isArray(payload?.markets)) return payload.markets;
  if (Array.isArray(payload?.events)) return payload.events;
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let forceFresh = false;
  try {
    const url = new URL(req.url || '', 'https://arb-finder.local');
    forceFresh = url.searchParams.get('fresh') === '1';
  } catch (_) {}
  res.setHeader('Cache-Control', forceFresh ? 'no-store' : 's-maxage=300, stale-while-revalidate=600');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  try {
    const startedAt = Date.now();
    const markets = [];
    const debug = [];
    const booksSeen = {};
    const rawBooksSeen = {};
    const excludedBooksSeen = {};
    const skipped = {};
    const countsByBook = {};
    const countsBySport = {};
    const exchangesSeen = {};
    const timeWindow = buildTimeWindow(req);
    const seenMarketKeys = new Set();

    const plannedCalls = [];
    for (const sport of SPORTS) {
      plannedCalls.push({
        kind: 'odds',
        sport,
        endpoint: `/sports/${sport}/odds`,
        params: {
          regions: 'us',
          markets: 'h2h,spreads,totals',
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        }
      });
    }
    for (const call of SUPPLEMENTAL_MLB_BOOK_CALLS) {
      plannedCalls.push({
        kind: 'mlb_supplement',
        sport: 'baseball_mlb',
        endpoint: '/sports/baseball_mlb/odds',
        bookmaker: call.bookmaker,
        markets: call.markets,
        params: {
          bookmakers: call.bookmaker,
          markets: call.markets,
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        }
      });
    }
    for (const call of SUPPORTED_EXCHANGE_CALLS) {
      plannedCalls.push({
        kind: 'exchange',
        sport: call.sport,
        endpoint: `/exchange/${call.sport}/markets`,
        exchange: call.exchange,
        params: { exchange: call.exchange }
      });
    }

    const settledCalls = await Promise.allSettled(plannedCalls.map(async call => {
      try {
        return { call, result: await fetchJson(call.endpoint, call.params) };
      } catch (error) {
        return { call, error };
      }
    }));

    for (const settled of settledCalls) {
      if (settled.status === 'rejected') {
        debug.push({
          ok: false,
          error: settled.reason?.message || String(settled.reason),
          failedBeforeResponse: true
        });
        continue;
      }

      const { call, result } = settled.value;
      if (settled.value.error) {
        debug.push({
          sport: call.sport,
          endpoint: call.endpoint,
          bookmaker: call.bookmaker,
          exchange: call.exchange,
          supplement: call.kind === 'mlb_supplement' ? 'mlb_individual_bookmaker_main_lines' : undefined,
          requestedMarkets: call.markets,
          ok: false,
          failedBeforeResponse: true,
          error: settled.value.error?.message || String(settled.value.error)
        });
        continue;
      }
      const r = result.response;
      const text = result.text;
      const baseDebug = {
        sport: call.sport,
        endpoint: call.endpoint,
        bookmaker: call.bookmaker,
        exchange: call.exchange,
        supplement: call.kind === 'mlb_supplement' ? 'mlb_individual_bookmaker_main_lines' : undefined,
        requestedMarkets: call.markets,
        responseMs: result.elapsedMs,
        creditHeaders: creditHeaders(r.headers)
      };

      if (!r.ok) {
        debug.push({
          ...baseDebug,
          ok: false,
          status: r.status,
          body: text.slice(0, 800)
        });
        continue;
      }

      if (call.kind === 'exchange') {
        const allExchangeRows = listFromPayload(result.json);
        const exchangeRows = allExchangeRows.filter(row => inTimeWindow(row.commence_time, timeWindow));
        const normalizedExchange = exchangeRows
          .map(m => normalizeExchangeMarket(call.exchange, m, call.sport, { skipped }))
          .filter(Boolean);

        normalizedExchange.forEach(m => {
          booksSeen[m.platform] = m.bookTitle || EXCHANGE_TITLES[m.platform] || m.platform;
          exchangesSeen[m.platform] = booksSeen[m.platform];
        });
        const added = pushUniqueMarkets(markets, normalizedExchange, seenMarketKeys);

        debug.push({
          ...baseDebug,
          ok: true,
          markets: exchangeRows.length,
          rawMarkets: allExchangeRows.length,
          normalized: normalizedExchange.length,
          added
        });
        continue;
      }

      const json = result.json;
      const allEvents = Array.isArray(json) ? json : (json.data || json.events || []);
      const events = allEvents.filter(ev => inTimeWindow(ev.commence_time, timeWindow));
      let normalizedCount = 0;
      let addedCount = 0;

      for (const ev of events) {
        for (const b of ev.bookmakers || []) {
          const key = normalizeBookKey(b.key);
          if (!key) continue;
          rawBooksSeen[key] = b.title || b.key;
          if (REMOVED_BOOK_SET.has(key)) excludedBooksSeen[key] = b.title || b.key;
        }
        const normalized = normalizeEvent(ev, call.sport, { skipped });
        normalizedCount += normalized.length;
        normalized.forEach(m => {
          booksSeen[m.platform] = m.bookTitle || m.platform;
        });
        addedCount += pushUniqueMarkets(markets, normalized, seenMarketKeys);
      }

      debug.push({
        ...baseDebug,
        ok: true,
        events: events.length,
        rawEvents: allEvents.length,
        normalized: normalizedCount,
        added: addedCount,
        stageCounts: {
          upstreamRaw: summarizeEvents(allEvents),
          afterDateFilter: summarizeEvents(events),
          afterRemovedBookFilter: summarizeEvents(events, key => !REMOVED_BOOK_SET.has(key)),
          afterAllowedBookFilter: summarizeEvents(events, key => !REMOVED_BOOK_SET.has(key) && FINAL_BOOK_SET.has(key))
        }
      });
    }

    Object.keys(countsByBook).forEach(key => delete countsByBook[key]);
    Object.keys(countsBySport).forEach(key => delete countsBySport[key]);
    for (const market of markets) {
      countsByBook[market.platform] = (countsByBook[market.platform] || 0) + 1;
      countsBySport[market.sport] = (countsBySport[market.sport] || 0) + 1;
    }
    const diagnostics = sportsbookDiagnostics(markets);
    const creditSum = debug.reduce((sum, row) => {
      const value = Number(row.creditHeaders?.['x-requests-last']);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    return res.status(200).json({
      markets,
      count: markets.length,
      booksSeen,
      rawBooksSeen,
      excludedBooksSeen,
      finalBookKeys: FINAL_BOOK_KEYS,
      removedBookKeys: REMOVED_BOOK_KEYS,
      timeWindow: {
        lookaheadDays: timeWindow.lookaheadDays,
        commenceTimeFrom: timeWindow.commenceTimeFrom,
        commenceTimeTo: timeWindow.commenceTimeTo,
        oddsCommenceTimeFiltering: 'upstream_and_server_side',
        exchangeCommenceTimeFiltering: 'server_side_only'
      },
      supportedExchangeCalls: SUPPORTED_EXCHANGE_CALLS,
      exchangesSeen,
      countsByBook,
      countsBySport,
      sportsbookDiagnostics: diagnostics,
      creditEstimate: creditSum,
      responseMs: Date.now() - startedAt,
      skipped,
      pulledAt: new Date().toISOString(),
      debug
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
