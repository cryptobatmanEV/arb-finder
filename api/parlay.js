// api/parlay.js

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
const AUDIT_ONLY_BOOK_KEYS = [];
const AUDIT_ONLY_BOOK_SET = new Set(AUDIT_ONLY_BOOK_KEYS);
const TRUSTED_LIVE_BOOK_KEYS = [
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
];
const TRUSTED_LIVE_BOOK_SET = new Set(TRUSTED_LIVE_BOOK_KEYS);
const MAX_LAST_UPDATE_AGE_SECONDS = Number(process.env.PARLAY_MAX_LAST_UPDATE_AGE_SECONDS || 300);
const CALL_TIMEOUT_MS = Number(process.env.PARLAY_CALL_TIMEOUT_MS || 9000);

const EXCHANGE_TITLES = {
  novig: 'Novig',
  prophetx: 'ProphetX'
};

const CORE_DUPLICATE_PARLAY_BOOK_SET = new Set(['kalshi', 'polymarket']);
const MLB_MAIN_TOTAL_ANCHOR_BOOKS = ['pinnacle', 'draftkings', 'novig', 'betmgm', 'caesars', 'bovada', 'fanduel'];

const SUPPORTED_EXCHANGE_CALLS = [
  // Verified useful on 2026-06-23:
  // /v1/exchange/baseball_mlb/markets?exchange=prophetx returns MLB game totals.
  { exchange: 'prophetx', sport: 'baseball_mlb' }
];

const DEFAULT_MLB_SUPPLEMENT_BOOKS = [
  'betmgm',
  'caesars',
  'bovada',
  'pinnacle',
  'fanatics',
  'betrivers'
];
const SUPPLEMENTAL_MLB_MARKETS = process.env.PARLAY_MLB_SUPPLEMENT_MARKETS || 'h2h,spreads,totals';

const SAFE_MLB_PROP_MARKETS = new Set([
  'player_hits',
  'player_total_bases',
  'player_rbis',
  'player_hits_runs_rbis',
  'player_runs',
  'player_doubles',
  'player_singles',
  'player_stolen_bases',
  'player_pitcher_strikeouts',
  'player_strikeouts'
]);

const PROP_MARKET_LABELS = {
  player_hits: 'Hits',
  player_total_bases: 'Total Bases',
  player_rbis: 'RBIs',
  player_hits_runs_rbis: 'Hits + Runs + RBIs',
  player_runs: 'Runs',
  player_doubles: 'Doubles',
  player_singles: 'Singles',
  player_stolen_bases: 'Stolen Bases',
  player_pitcher_strikeouts: 'Strikeouts',
  player_strikeouts: 'Strikeouts'
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

function implied(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function invalidSportsbookHold(platform, yesPrice, noPrice) {
  if (!SPORTSBOOK_BOOK_SET.has(platform)) return false;
  const sum = Number(yesPrice) + Number(noPrice);
  return !Number.isFinite(sum) || sum < 0.98 || sum > 1.25;
}

function isAuditOnlyBook(platform) {
  return AUDIT_ONLY_BOOK_SET.has(platform);
}

function isTrustedLiveBook(platform) {
  return true;
}

function lastUpdateAgeSeconds(book, market, fetchTimestamp) {
  const lastUpdate = book?.last_update || market?.last_update || null;
  const fetchMs = new Date(fetchTimestamp || '').getTime();
  const updateMs = new Date(lastUpdate || '').getTime();
  if (!Number.isFinite(fetchMs) || !Number.isFinite(updateMs)) return null;
  return Math.max(0, Math.round((fetchMs - updateMs) / 1000));
}

function staleSportsbookRow(platform, book, market, meta) {
  if (!SPORTSBOOK_BOOK_SET.has(platform)) return false;
  const age = lastUpdateAgeSeconds(book, market, meta?.fetchTimestamp);
  return age != null && age > MAX_LAST_UPDATE_AGE_SECONDS;
}

function unsupportedMainLine(sport, marketType, line) {
  const shortSport = sportShort(sport);
  const n = Number(line);
  if (!Number.isFinite(n)) return false;
  if (shortSport === 'mlb' && marketType === 'spread') return Math.abs(n) !== 1.5;
  if (shortSport === 'mlb' && marketType === 'total') return n < 5 || n > 13.5;
  return false;
}

function firstTotalLineForBook(ev, bookKey, sport) {
  const book = (ev.bookmakers || []).find(row => normalizeBookKey(row.key) === bookKey);
  if (!book || CORE_DUPLICATE_PARLAY_BOOK_SET.has(bookKey) || REMOVED_BOOK_SET.has(bookKey)) return null;
  for (const market of book.markets || []) {
    if (market.key !== 'totals') continue;
    const over = (market.outcomes || []).find(o => /over/i.test(o.name));
    const under = (market.outcomes || []).find(o => /under/i.test(o.name));
    const point = Number(over?.point ?? under?.point);
    if (Number.isFinite(point) && !unsupportedMainLine(sport, 'total', point)) return point;
  }
  return null;
}

function mainLineContext(ev, sport) {
  const shortSport = sportShort(sport);
  if (shortSport !== 'mlb') return {};
  const anchorLine = MLB_MAIN_TOTAL_ANCHOR_BOOKS
    .map(book => firstTotalLineForBook(ev, book, sport))
    .find(line => Number.isFinite(line));
  return { mlbMainTotalLine: anchorLine ?? null };
}

function unsupportedEventLine(context, sport, marketType, line) {
  if (sportShort(sport) === 'mlb' && marketType === 'total') {
    if (context?.mlbMainTotalLine == null) return false;
    const main = Number(context?.mlbMainTotalLine);
    const n = Number(line);
    return Number.isFinite(main) && Number.isFinite(n) && Math.abs(main - n) > 0.001;
  }
  return false;
}

function sportsbookAltLineType(platform, sport, marketType, line, lineContext) {
  if (!SPORTSBOOK_BOOK_SET.has(platform)) return null;
  if (marketType !== 'spread' && marketType !== 'total') return null;
  if (sportShort(sport) !== 'mlb') return null;
  const n = Number(line);
  if (!Number.isFinite(n)) return null;
  if (marketType === 'spread') return Math.abs(n) === 1.5 ? 'main' : 'alt';
  if (marketType === 'total') {
    if (unsupportedMainLine(sport, marketType, n)) return null;
    return unsupportedEventLine(lineContext, sport, marketType, n) ? 'alt' : 'main';
  }
  return null;
}

function requestPath(endpoint, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') qs.set(key, value);
  });
  const query = qs.toString();
  return `/v1${endpoint}${query ? `?${query}` : ''}`;
}

function proofBase(meta, ev, book, market, normalizedMarketType = null) {
  const lastUpdate = book?.last_update || market?.last_update || null;
  const ageSeconds = lastUpdateAgeSeconds(book, market, meta?.fetchTimestamp);
  return {
    sourceEndpoint: meta?.endpoint || null,
    sourceRequest: meta?.requestPath || null,
    rawEventId: ev?.id || ev?.event_id || ev?.key || null,
    rawBookmakerKey: book?.key || null,
    rawBookmakerTitle: book?.title || book?.key || null,
    rawMarketKey: market?.key || null,
    normalizedMarketType,
    rawCommenceTime: ev?.commence_time || null,
    displayedDate: String(ev?.commence_time || '').slice(0, 10) || null,
    lastUpdate,
    lastUpdateAgeSeconds: ageSeconds,
    fetchTimestamp: meta?.fetchTimestamp || null,
    cacheStatus: 'fresh',
    rawHomeTeam: ev?.home_team || null,
    rawAwayTeam: ev?.away_team || null
  };
}

function sideProof(base, outcome, normalizedSide, normalizedAmerican) {
  return {
    ...base,
    rawOutcomeName: outcome?.name || null,
    rawOutcomePrice: outcome?.price ?? null,
    rawOutcomePoint: outcome?.point ?? null,
    normalizedSide,
    normalizedAmerican
  };
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
  if (sport === 'basketball_wnba') return 'wnba';
  if (sport === 'americanfootball_nfl') return 'nfl';
  if (sport === 'americanfootball_ncaaf') return 'ncaaf';
  if (sport === 'basketball_ncaab') return 'ncaab';
  if (sport === 'icehockey_nhl') return 'nhl';
  if (String(sport || '').startsWith('soccer_')) return 'soccer';
  return sport;
}

function configuredList(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

function supplementalMlbBooks() {
  return configuredList('PARLAY_MLB_SUPPLEMENT_BOOKS', DEFAULT_MLB_SUPPLEMENT_BOOKS)
    .map(normalizeBookKey)
    .filter(book => book && FINAL_BOOK_SET.has(book) && !REMOVED_BOOK_SET.has(book));
}

function maxCreditsPerRefresh() {
  const raw = Number(process.env.PARLAY_MAX_CREDITS_PER_REFRESH || 30);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

function estimatedCredits(call) {
  if (call.kind === 'mlb_supplement' && call.markets === 'h2h') return 1;
  if (call.kind === 'events' || call.kind === 'sports') return 0;
  return 3;
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
    market.lineType || 'main',
    market.away,
    market.home,
    eventDate,
    market.line ?? '',
    market.favoredTeamName || '',
    market.player || '',
    market.statType || ''
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

function normalizeEvent(ev, sport, debug, meta = {}) {
  const out = [];
  const home = ev.home_team;
  const away = ev.away_team;
  const startTime = ev.commence_time;
  const lineContext = mainLineContext(ev, sport);

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
    if (CORE_DUPLICATE_PARLAY_BOOK_SET.has(platform)) {
      noteSkip(debug, `core_duplicate_parlay_book_${platform}`);
      continue;
    }
    if (!FINAL_BOOK_SET.has(platform)) {
      noteSkip(debug, `unsupported_book_${platform}`);
      continue;
    }
    if (isAuditOnlyBook(platform)) {
      noteSkip(debug, `audit_only_book_${platform}`);
      continue;
    }
    if (!isTrustedLiveBook(platform)) {
      noteSkip(debug, `untrusted_live_book_${platform}`);
      continue;
    }

    for (const market of book.markets || []) {
      const key = market.key;
      const outcomes = market.outcomes || [];

      if (staleSportsbookRow(platform, book, market, meta)) {
        noteSkip(debug, `stale_book_included_${platform}`);
      }

      if (key === 'h2h') {
        if (outcomes.length !== 2) {
          noteSkip(debug, `h2h_unsupported_outcome_count_${outcomes.length}`);
          continue;
        }
        const awayOut = outcomes.find(o => o.name === away);
        const homeOut = outcomes.find(o => o.name === home);

        const yesPrice = implied(awayOut?.price);
        const noPrice = implied(homeOut?.price);

        if (!yesPrice || !noPrice) {
          noteSkip(debug, 'h2h_missing_prices');
          continue;
        }
        if (invalidSportsbookHold(platform, yesPrice, noPrice)) {
          noteSkip(debug, `sportsbook_h2h_invalid_same_book_hold_${platform}`);
          continue;
        }

        out.push({
          id: `${ev.id}-${platform}-h2h`,
          source: 'parlay',
    platform,
    bookTitle,
    trustStatus: 'trusted_live',
    sport: sportShort(sport),
          marketType: 'moneyline',
          home,
          away,
          startTime,
          yesPrice,
          noPrice,
          sourceProof: {
            YES: sideProof(proofBase(meta, ev, book, market, 'moneyline'), awayOut, `${away} wins`, awayOut?.price ?? null),
            NO: sideProof(proofBase(meta, ev, book, market, 'moneyline'), homeOut, `${home} wins`, homeOut?.price ?? null)
          },
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
        const lineType = sportsbookAltLineType(platform, sport, 'total', point, lineContext);
        if (!lineType && unsupportedMainLine(sport, 'total', point)) {
          noteSkip(debug, `unsupported_main_total_line_${sportShort(sport)}_${point}`);
          continue;
        }
        if (!lineType && unsupportedEventLine(lineContext, sport, 'total', point)) {
          noteSkip(debug, `non_anchor_total_line_${sportShort(sport)}_${point}_main_${lineContext.mlbMainTotalLine}`);
          continue;
        }
        if (invalidSportsbookHold(platform, yesPrice, noPrice)) {
          noteSkip(debug, `sportsbook_total_invalid_same_book_hold_${platform}`);
          continue;
        }

        out.push({
          id: `${ev.id}-${platform}-total-${point}`,
          source: 'parlay',
    platform,
    bookTitle,
    trustStatus: SPORTSBOOK_BOOK_SET.has(platform) ? 'trusted_live' : 'trusted_live',
          sport: sportShort(sport),
          marketType: 'total',
          lineType: lineType || 'main',
          home,
          away,
          startTime,
          line: Number(point),
          yesPrice,
          noPrice,
          sourceProof: {
            YES: sideProof(proofBase(meta, ev, book, market, 'total'), over, `Over ${point}`, over?.price ?? null),
            NO: sideProof(proofBase(meta, ev, book, market, 'total'), under, `Under ${point}`, under?.price ?? null)
          },
          rawTitle: `${away} vs ${home}: O/U ${point}`,
          noTitle: `${away} vs ${home}: O/U ${point}`,
          url: googleUrl(bookTitle, away, home)
        });
      }

      if (key === 'spreads') {
        const awayOut = outcomes.find(o => o.name === away);
        const homeOut = outcomes.find(o => o.name === home);
        const awayPoint = Number(awayOut?.point);
        const homePoint = Number(homeOut?.point);
        const yesPrice = implied(awayOut?.price);
        const noPrice = implied(homeOut?.price);

        if (!awayOut || !homeOut || !Number.isFinite(awayPoint) || !Number.isFinite(homePoint) || !yesPrice || !noPrice) {
          noteSkip(debug, 'spread_missing_team_price_or_line');
          continue;
        }
        if (invalidSportsbookHold(platform, yesPrice, noPrice)) {
          noteSkip(debug, `sportsbook_spread_invalid_same_book_hold_${platform}`);
          continue;
        }
        if (Math.abs(awayPoint + homePoint) > 0.001) {
          noteSkip(debug, 'spread_points_not_opposing');
          continue;
        }
        const lineType = sportsbookAltLineType(platform, sport, 'spread', Math.abs(awayPoint), lineContext);
        if (!lineType && unsupportedMainLine(sport, 'spread', Math.abs(awayPoint))) {
          noteSkip(debug, `unsupported_main_spread_line_${sportShort(sport)}_${Math.abs(awayPoint)}`);
          continue;
        }

        out.push({
          id: `${ev.id}-${platform}-spread-${Math.abs(awayPoint)}`,
          source: 'parlay',
          platform,
          bookTitle,
          trustStatus: SPORTSBOOK_BOOK_SET.has(platform) ? 'trusted_live' : 'trusted_live',
          sport: sportShort(sport),
          marketType: 'spread',
          lineType: lineType || 'main',
          home,
          away,
          startTime,
          line: Math.abs(awayPoint),
          yesPrice,
          noPrice,
          sourceProof: {
            YES: sideProof(proofBase(meta, ev, book, market, 'spread'), awayOut, `${away} ${awayPoint > 0 ? '+' : ''}${awayPoint}`, awayOut?.price ?? null),
            NO: sideProof(proofBase(meta, ev, book, market, 'spread'), homeOut, `${home} ${homePoint > 0 ? '+' : ''}${homePoint}`, homeOut?.price ?? null)
          },
          favoredTeamName: away,
          rawTitle: `Spread: ${away} (${awayPoint > 0 ? '+' : ''}${awayPoint})`,
          noTitle: `Spread: ${home} (${homePoint > 0 ? '+' : ''}${homePoint})`,
          spreadSides: {
            YES: { team: away, point: awayPoint, rawPrice: awayOut.price ?? null },
            NO: { team: home, point: homePoint, rawPrice: homeOut.price ?? null }
          },
          url: googleUrl(bookTitle, away, home)
        });
      }
    }
  }

  return out;
}

function normalizeExchangeMarket(exchangeKey, m, sport, debug, meta = {}) {
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

  const overPrice = implied(m.over_price);
  const underPrice = implied(m.under_price);

  if (marketType === 'moneyline' && marketKey === 'moneyline') {
    if (!overPrice || !underPrice) {
      noteSkip(debug, 'exchange_moneyline_missing_prices');
      return null;
    }

    return {
      id: `${platform}-${sport}-${away}-${home}-${startTime}-moneyline`,
      source: 'parlay',
      platform,
      bookTitle,
      trustStatus: 'trusted_live',
      sport: sportShort(sport),
      marketType: 'moneyline',
      home,
      away,
      startTime,
      yesPrice: underPrice,
      noPrice: overPrice,
      rawYesPrice: underPrice,
      rawNoPrice: overPrice,
      sourceProof: {
        YES: {
          sourceEndpoint: meta?.endpoint || null,
          sourceRequest: meta?.requestPath || null,
          rawEventId: m.event_id || m.id || m.key || null,
          rawBookmakerKey: platform,
          rawBookmakerTitle: bookTitle,
          rawMarketKey: m.market_key || null,
          normalizedMarketType: 'moneyline',
          rawOutcomeName: away,
          rawOutcomePrice: m.under_price ?? null,
          rawOutcomePoint: null,
          normalizedSide: `${away} wins`,
          normalizedAmerican: americanFromProbability(underPrice),
          rawCommenceTime: startTime,
          displayedDate: String(startTime || '').slice(0, 10),
          lastUpdate: m.last_update || null,
          fetchTimestamp: meta?.fetchTimestamp || null,
          cacheStatus: 'fresh',
          rawHomeTeam: home,
          rawAwayTeam: away
        },
        NO: {
          sourceEndpoint: meta?.endpoint || null,
          sourceRequest: meta?.requestPath || null,
          rawEventId: m.event_id || m.id || m.key || null,
          rawBookmakerKey: platform,
          rawBookmakerTitle: bookTitle,
          rawMarketKey: m.market_key || null,
          normalizedMarketType: 'moneyline',
          rawOutcomeName: home,
          rawOutcomePrice: m.over_price ?? null,
          rawOutcomePoint: null,
          normalizedSide: `${home} wins`,
          normalizedAmerican: americanFromProbability(overPrice),
          rawCommenceTime: startTime,
          displayedDate: String(startTime || '').slice(0, 10),
          lastUpdate: m.last_update || null,
          fetchTimestamp: meta?.fetchTimestamp || null,
          cacheStatus: 'fresh',
          rawHomeTeam: home,
          rawAwayTeam: away
        }
      },
      rawTitle: `${away} vs ${home}`,
      noTitle: `${away} vs ${home}`,
      exchangeMarketType: m.market_type || null,
      exchangeLastUpdate: m.last_update || null,
      exchangeVolumeUsd: m.volume_usd ?? null,
      url: googleUrl(bookTitle, away, home)
    };
  }

  if (marketType === 'run line' && marketKey === 'spreads') {
    const homePoint = Number(line);
    if (!Number.isFinite(homePoint) || !overPrice || !underPrice) {
      noteSkip(debug, 'exchange_spread_missing_prices_or_line');
      return null;
    }
    const awayPoint = -homePoint;
    if (Math.abs(awayPoint + homePoint) > 0.001) {
      noteSkip(debug, 'exchange_spread_points_not_opposing');
      return null;
    }
    if (unsupportedMainLine(sport, 'spread', Math.abs(homePoint))) {
      noteSkip(debug, `exchange_unsupported_main_spread_line_${sportShort(sport)}_${Math.abs(homePoint)}`);
      return null;
    }

    return {
      id: `${platform}-${sport}-${away}-${home}-${startTime}-spread-${Math.abs(homePoint)}`,
      source: 'parlay',
      platform,
      bookTitle,
      trustStatus: 'trusted_live',
      sport: sportShort(sport),
      marketType: 'spread',
      home,
      away,
      startTime,
      line: Math.abs(homePoint),
      yesPrice: underPrice,
      noPrice: overPrice,
      rawYesPrice: underPrice,
      rawNoPrice: overPrice,
      sourceProof: {
        YES: {
          sourceEndpoint: meta?.endpoint || null,
          sourceRequest: meta?.requestPath || null,
          rawEventId: m.event_id || m.id || m.key || null,
          rawBookmakerKey: platform,
          rawBookmakerTitle: bookTitle,
          rawMarketKey: m.market_key || null,
          normalizedMarketType: 'spread',
          rawOutcomeName: away,
          rawOutcomePrice: m.under_price ?? null,
          rawOutcomePoint: awayPoint,
          normalizedSide: `${away} ${awayPoint > 0 ? '+' : ''}${awayPoint}`,
          normalizedAmerican: americanFromProbability(underPrice),
          rawCommenceTime: startTime,
          displayedDate: String(startTime || '').slice(0, 10),
          lastUpdate: m.last_update || null,
          fetchTimestamp: meta?.fetchTimestamp || null,
          cacheStatus: 'fresh',
          rawHomeTeam: home,
          rawAwayTeam: away
        },
        NO: {
          sourceEndpoint: meta?.endpoint || null,
          sourceRequest: meta?.requestPath || null,
          rawEventId: m.event_id || m.id || m.key || null,
          rawBookmakerKey: platform,
          rawBookmakerTitle: bookTitle,
          rawMarketKey: m.market_key || null,
          normalizedMarketType: 'spread',
          rawOutcomeName: home,
          rawOutcomePrice: m.over_price ?? null,
          rawOutcomePoint: homePoint,
          normalizedSide: `${home} ${homePoint > 0 ? '+' : ''}${homePoint}`,
          normalizedAmerican: americanFromProbability(overPrice),
          rawCommenceTime: startTime,
          displayedDate: String(startTime || '').slice(0, 10),
          lastUpdate: m.last_update || null,
          fetchTimestamp: meta?.fetchTimestamp || null,
          cacheStatus: 'fresh',
          rawHomeTeam: home,
          rawAwayTeam: away
        }
      },
      rawTitle: `Spread: ${away} (${awayPoint > 0 ? '+' : ''}${awayPoint})`,
      noTitle: `Spread: ${home} (${homePoint > 0 ? '+' : ''}${homePoint})`,
      spreadSides: {
        YES: { team: away, point: awayPoint, rawPrice: m.under_price ?? null },
        NO: { team: home, point: homePoint, rawPrice: m.over_price ?? null }
      },
      exchangeMarketType: m.market_type || null,
      exchangeLastUpdate: m.last_update || null,
      exchangeVolumeUsd: m.volume_usd ?? null,
      url: googleUrl(bookTitle, away, home)
    };
  }

  if (marketType !== 'runs') {
    noteSkip(debug, 'exchange_unsupported_market_type');
    return null;
  }

  // ProphetX often returns player props or derivative markets with generic keys.
  // Do not map those into game totals until the market_type is explicitly safe.
  if (!['totals', 'total', 'game_total', 'game_totals'].includes(marketKey)) {
    noteSkip(debug, `exchange_unsupported_market_key_${marketKey || 'missing'}`);
    return null;
  }

  noteSkip(debug, `exchange_unsupported_market_type_${marketType}_${marketKey}`);
  return null;
}

function normalizePropRow(row, sport, debug, meta = {}) {
  const platform = normalizeBookKey(row.bookmaker || row.bookmaker_key || row.bookmakerKey);
  const bookTitle = row.bookmaker_title || row.bookmaker || platform;
  const marketKey = String(row.market_key || '').toLowerCase();
  const player = String(row.player || row.player_name || '').trim();
  const home = row.home_team;
  const away = row.away_team;
  const startTime = row.commence_time || row.start_time || row.startTime;
  const line = row.line ?? row.point ?? row.strike;

  if (!platform || !player || !home || !away || !startTime || line == null) {
    noteSkip(debug, 'prop_missing_required_fields');
    return null;
  }
  if (REMOVED_BOOK_SET.has(platform)) {
    noteSkip(debug, `excluded_book_${platform}`);
    return null;
  }
  if (!FINAL_BOOK_SET.has(platform)) {
    noteSkip(debug, `unsupported_book_${platform}`);
    return null;
  }
  if (!SAFE_MLB_PROP_MARKETS.has(marketKey)) {
    noteSkip(debug, `prop_unsupported_market_${marketKey || 'missing'}`);
    return null;
  }
  if (/_alt\b|milestone|fantasy|1st_|4th_|anytime|first|moneyline/i.test(marketKey)) {
    noteSkip(debug, `prop_unsafe_market_${marketKey}`);
    return null;
  }

  const yesPrice = implied(row.over_price);
  const noPrice = implied(row.under_price);
  if (!yesPrice || !noPrice) {
    noteSkip(debug, 'prop_missing_prices');
    return null;
  }

  const label = PROP_MARKET_LABELS[marketKey] || marketKey.replace(/^player_/, '').replace(/_/g, ' ');
  return {
    id: `${row.event_id || row.id || `${away}-${home}-${startTime}`}-${platform}-${marketKey}-${player}-${line}`,
    source: 'parlay',
    platform,
          bookTitle,
          trustStatus: SPORTSBOOK_BOOK_SET.has(platform) ? 'trusted_live' : 'trusted_live',
          sport: sportShort(sport),
    marketType: 'prop',
    home,
    away,
    startTime,
    line: Number(line),
    player: player.toLowerCase(),
    statType: marketKey,
    yesPrice,
    noPrice,
    sourceProof: {
      YES: {
        sourceEndpoint: meta?.endpoint || null,
        sourceRequest: meta?.requestPath || null,
        rawEventId: row.event_id || row.id || row.key || null,
        rawBookmakerKey: platform,
        rawBookmakerTitle: bookTitle,
        rawMarketKey: marketKey,
        rawOutcomeName: 'Over',
        rawOutcomePrice: row.over_price ?? null,
        rawOutcomePoint: line,
        normalizedSide: `${player} over ${line} ${marketKey}`,
        normalizedAmerican: row.over_price ?? null,
        rawCommenceTime: startTime,
        displayedDate: String(startTime || '').slice(0, 10),
        lastUpdate: row.last_update || null,
        fetchTimestamp: meta?.fetchTimestamp || null,
        cacheStatus: 'fresh',
        rawHomeTeam: home,
        rawAwayTeam: away
      },
      NO: {
        sourceEndpoint: meta?.endpoint || null,
        sourceRequest: meta?.requestPath || null,
        rawEventId: row.event_id || row.id || row.key || null,
        rawBookmakerKey: platform,
        rawBookmakerTitle: bookTitle,
        rawMarketKey: marketKey,
        rawOutcomeName: 'Under',
        rawOutcomePrice: row.under_price ?? null,
        rawOutcomePoint: line,
        normalizedSide: `${player} under ${line} ${marketKey}`,
        normalizedAmerican: row.under_price ?? null,
        rawCommenceTime: startTime,
        displayedDate: String(startTime || '').slice(0, 10),
        lastUpdate: row.last_update || null,
        fetchTimestamp: meta?.fetchTimestamp || null,
        cacheStatus: 'fresh',
        rawHomeTeam: home,
        rawAwayTeam: away
      }
    },
    rawTitle: `${player}: ${label} O/U ${line}`,
    noTitle: `${player}: ${label} O/U ${line}`,
    url: googleUrl(bookTitle, player, label)
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
  let includeProps = false;
  try {
    const url = new URL(req.url || '', 'https://arb-finder.local');
    forceFresh = url.searchParams.get('fresh') === '1';
    includeProps = url.searchParams.get('props') === '1';
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

    const soccerSports = configuredList('PARLAY_SOCCER_SPORTS', DEFAULT_SOCCER_SPORTS);
    const expandedSports = configuredList('PARLAY_EXPANDED_SPORTS', EXPANDED_SPORTS);
    const optionalSports = [...new Set([...expandedSports, ...soccerSports])];
    const candidateSports = [...new Set([...CORE_SPORTS, ...optionalSports])];
    const creditBudget = maxCreditsPerRefresh();
    let activeSportKeys = [];
    let eventPrecheckRows = {};
    const planningDebug = {
      candidateSports,
      creditBudget,
      includedSports: [],
      skippedSports: [],
      eventPrechecks: [],
      skippedCallsForBudget: []
    };

    try {
      const sportsResult = await fetchJson('/sports');
      if (sportsResult.response.ok) {
        const sportsRows = listFromPayload(sportsResult.json);
        activeSportKeys = sportsRows.filter(row => row.active).map(row => row.key).filter(Boolean);
      } else {
        planningDebug.sportsPrecheckError = {
          status: sportsResult.response.status,
          body: sportsResult.text.slice(0, 400)
        };
      }
    } catch (error) {
      planningDebug.sportsPrecheckError = error.message || String(error);
    }

    const activeSportSet = new Set(activeSportKeys.length ? activeSportKeys : candidateSports);
    // Parlay can mark a sport inactive in /sports while its /events and /odds
    // endpoints still return current markets. Precheck every configured sport
    // and let event availability decide optional coverage.
    const activeCandidates = candidateSports;
    const eventPrechecks = await Promise.allSettled(activeCandidates.map(async sport => {
      const result = await fetchJson(`/sports/${sport}/events`, {
        commenceTimeFrom: timeWindow.commenceTimeFrom,
        commenceTimeTo: timeWindow.commenceTimeTo
      });
      return { sport, result };
    }));
    for (const settled of eventPrechecks) {
      if (settled.status !== 'fulfilled') {
        planningDebug.eventPrechecks.push({
          ok: false,
          error: settled.reason?.message || String(settled.reason)
        });
        continue;
      }
      const { sport, result } = settled.value;
      const rows = result.response.ok ? listFromPayload(result.json) : [];
      eventPrecheckRows[sport] = rows.length;
      planningDebug.eventPrechecks.push({
        sport,
        ok: result.response.ok,
        status: result.response.status,
        rows: rows.length,
        responseMs: result.elapsedMs,
        creditHeaders: creditHeaders(result.response.headers)
      });
    }

    const plannedCalls = [];
    let plannedCreditEstimate = 0;
    const maybeAddCall = (call) => {
      const estimate = estimatedCredits(call);
      if (plannedCreditEstimate + estimate > creditBudget) {
        planningDebug.skippedCallsForBudget.push({
          kind: call.kind,
          sport: call.sport,
          endpoint: call.endpoint,
          bookmaker: call.bookmaker,
          exchange: call.exchange,
          estimatedCredits: estimate,
          plannedCreditEstimate,
          creditBudget
        });
        return false;
      }
      plannedCreditEstimate += estimate;
      plannedCalls.push({ ...call, estimatedCredits: estimate });
      return true;
    };

    const maybeAddSportOddsCall = (sport) => {
      const activeInSports = activeSportSet.has(sport);
      if (!activeInSports && eventPrecheckRows[sport] == null) {
        planningDebug.skippedSports.push({ sport, reason: 'not_active_in_v1_sports' });
        return false;
      }
      if (eventPrecheckRows[sport] === 0) {
        planningDebug.skippedSports.push({
          sport,
          reason: activeInSports ? 'no_events_in_lookahead_window' : 'not_active_in_v1_sports_and_no_events_in_lookahead_window'
        });
        return false;
      }
      if (eventPrecheckRows[sport] == null && !CORE_SPORTS.includes(sport)) {
        planningDebug.skippedSports.push({ sport, reason: 'event_precheck_unavailable_for_optional_sport' });
        return false;
      }
      const added = maybeAddCall({
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
      if (added) {
        planningDebug.includedSports.push({
          sport,
          eventPrecheckRows: eventPrecheckRows[sport] ?? null,
          activeInSports
        });
      }
      return added;
    };

    for (const sport of CORE_SPORTS) {
      maybeAddSportOddsCall(sport);
    }
    for (const sport of optionalSports) {
      maybeAddSportOddsCall(sport);
    }
    for (const call of SUPPORTED_EXCHANGE_CALLS) {
      if (eventPrecheckRows[call.sport] === 0) continue;
      maybeAddCall({
        kind: 'exchange',
        sport: call.sport,
        endpoint: `/exchange/${call.sport}/markets`,
        exchange: call.exchange,
        params: { exchange: call.exchange }
      });
    }
    for (const bookmaker of supplementalMlbBooks()) {
      if (!planningDebug.includedSports.some(row => row.sport === 'baseball_mlb')) continue;
      maybeAddCall({
        kind: 'mlb_supplement',
        sport: 'baseball_mlb',
        endpoint: '/sports/baseball_mlb/odds',
        bookmaker,
        markets: SUPPLEMENTAL_MLB_MARKETS,
        params: {
          bookmakers: bookmaker,
          markets: SUPPLEMENTAL_MLB_MARKETS,
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        }
      });
    }
    if (includeProps) {
      maybeAddCall({
        kind: 'props',
        sport: 'baseball_mlb',
        endpoint: '/sports/baseball_mlb/props',
        params: {
          oddsFormat: 'american',
          commenceTimeFrom: timeWindow.commenceTimeFrom,
          commenceTimeTo: timeWindow.commenceTimeTo
        }
      });
    }
    planningDebug.plannedCreditEstimate = plannedCreditEstimate;

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
        requestPath: requestPath(call.endpoint, call.params),
        bookmaker: call.bookmaker,
        exchange: call.exchange,
        supplement: call.kind === 'mlb_supplement' ? 'mlb_individual_bookmaker_main_lines' : undefined,
        requestedMarkets: call.markets,
        responseMs: result.elapsedMs,
        creditHeaders: creditHeaders(r.headers)
      };
      const sourceMeta = {
        endpoint: call.endpoint,
        requestPath: requestPath(call.endpoint, call.params),
        fetchTimestamp: new Date().toISOString()
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
          .map(m => normalizeExchangeMarket(call.exchange, m, call.sport, { skipped }, sourceMeta))
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

      if (call.kind === 'props') {
        const allRows = listFromPayload(result.json);
        const rows = allRows.filter(row => inTimeWindow(row.commence_time || row.start_time || row.startTime, timeWindow));
        const normalizedProps = rows
          .map(row => normalizePropRow(row, call.sport, { skipped }, sourceMeta))
          .filter(Boolean);

        normalizedProps.forEach(m => {
          booksSeen[m.platform] = m.bookTitle || m.platform;
          rawBooksSeen[m.platform] = m.bookTitle || m.platform;
        });
        const added = pushUniqueMarkets(markets, normalizedProps, seenMarketKeys);

        debug.push({
          ...baseDebug,
          ok: true,
          rows: rows.length,
          rawRows: allRows.length,
          normalized: normalizedProps.length,
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
        const normalized = normalizeEvent(ev, call.sport, { skipped }, sourceMeta);
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
      sportPlanning: planningDebug,
      supportedExchangeCalls: SUPPORTED_EXCHANGE_CALLS,
      includeProps,
      cacheStatus: forceFresh ? 'fresh' : 'vercel-cache-eligible',
      upstreamCallsAttempted: plannedCalls.length,
      trustedLiveBookKeys: TRUSTED_LIVE_BOOK_KEYS,
      auditOnlyBookKeys: AUDIT_ONLY_BOOK_KEYS,
      maxLastUpdateAgeSeconds: MAX_LAST_UPDATE_AGE_SECONDS,
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
