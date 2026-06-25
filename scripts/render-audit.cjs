const https = require('https');

const ORIGIN = process.argv[2] || 'https://arb-finder-sooty.vercel.app';
const NEAR_ARB_BAND = 0.02;
const APPROVED = [
  'fanduel', 'draftkings', 'betmgm', 'caesars', 'bovada', 'bet365',
  'fanatics', 'hardrock', 'betrivers', 'pinnacle', 'kalshi', 'novig',
  'polymarket', 'fliff', 'prophetx', 'stake', 'sugarhouse', 'tipico'
];
const SPORTSBOOK = new Set([
  'draftkings', 'fanduel', 'betmgm', 'caesars', 'bovada', 'bet365',
  'fanatics', 'hardrock', 'betrivers', 'pinnacle', 'stake', 'sugarhouse', 'tipico'
]);
const MLB_ABBR = {
  'atlanta braves': 'atl', braves: 'atl', atlanta: 'atl',
  'san diego padres': 'sd', padres: 'sd', 'san diego': 'sd',
  'arizona diamondbacks': 'ari', diamondbacks: 'ari', arizona: 'ari',
  'baltimore orioles': 'bal', orioles: 'bal', baltimore: 'bal',
  'boston red sox': 'bos', 'red sox': 'bos', boston: 'bos',
  'chicago cubs': 'chc', cubs: 'chc',
  'chicago white sox': 'cws', 'white sox': 'cws',
  'cincinnati reds': 'cin', reds: 'cin', cincinnati: 'cin',
  'cleveland guardians': 'cle', guardians: 'cle', cleveland: 'cle',
  'colorado rockies': 'col', rockies: 'col', colorado: 'col',
  'detroit tigers': 'det', tigers: 'det', detroit: 'det',
  'houston astros': 'hou', astros: 'hou', houston: 'hou',
  'kansas city royals': 'kc', royals: 'kc', 'kansas city': 'kc',
  'los angeles angels': 'laa', angels: 'laa',
  'los angeles dodgers': 'lad', dodgers: 'lad',
  'miami marlins': 'mia', marlins: 'mia', miami: 'mia',
  'milwaukee brewers': 'mil', brewers: 'mil', milwaukee: 'mil',
  'minnesota twins': 'min', twins: 'min', minnesota: 'min',
  'new york mets': 'nym', mets: 'nym',
  'new york yankees': 'nyy', yankees: 'nyy',
  'oakland athletics': 'oak', athletics: 'oak', oakland: 'oak',
  'philadelphia phillies': 'phi', phillies: 'phi',
  'pittsburgh pirates': 'pit', pirates: 'pit',
  'san francisco giants': 'sf', giants: 'sf',
  'seattle mariners': 'sea', mariners: 'sea',
  'st louis cardinals': 'stl', 'st. louis cardinals': 'stl', cardinals: 'stl',
  'tampa bay rays': 'tb', rays: 'tb',
  'texas rangers': 'tex', rangers: 'tex',
  'toronto blue jays': 'tor', 'blue jays': 'tor',
  'washington nationals': 'wsh', nationals: 'wsh'
};
const KA_TO_PM = {
  ATL: 'atl', SDP: 'sd', SD: 'sd', ARI: 'ari', BAL: 'bal', BOS: 'bos',
  CHC: 'chc', CWS: 'cws', CIN: 'cin', CLE: 'cle', COL: 'col', DET: 'det',
  HOU: 'hou', KCR: 'kc', KC: 'kc', LAA: 'laa', LAD: 'lad', MIA: 'mia',
  MIL: 'mil', MIN: 'min', NYM: 'nym', NYY: 'nyy', OAK: 'oak', PHI: 'phi',
  PIT: 'pit', SEA: 'sea', SFG: 'sf', SF: 'sf', STL: 'stl', TBR: 'tb',
  TB: 'tb', TEX: 'tex', TOR: 'tor', WSH: 'wsh'
};
const PM_TO_NAME = Object.fromEntries(Object.entries(MLB_ABBR).filter(([k]) => k.includes(' ')).map(([k, v]) => [v, k]));

function fetchJson(path) {
  const url = path.startsWith('http') ? path : `${ORIGIN}${path}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body), url }); }
        catch (error) { reject(new Error(`${url}: ${error.message}`)); }
      });
    }).on('error', reject);
  });
}

function countBy(rows, fn) {
  return rows.reduce((acc, row) => {
    const key = fn(row) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function abbr(name) {
  const key = String(name || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return MLB_ABBR[key] || key;
}

function americanFromProbability(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  return n >= 0.5 ? -Math.round((n / (1 - n)) * 100) : Math.round(((1 - n) / n) * 100);
}

function kalshiEffectiveCost(p) {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  return Number((n + 0.07 * n * (1 - n)).toFixed(4));
}

function parsePolymarketGameStart(raw) {
  if (!raw) return null;
  const normalized = String(raw).replace(' ', 'T').replace(/\+00$/, 'Z');
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function kalshiStartTimeFromRules(text) {
  const m = String(text || '').match(/scheduled for ([A-Z][a-z]{2})\s+(\d{1,2}),\s+(20\d{2}) at (\d{1,2}):(\d{2})\s*(AM|PM)\s*(EDT|EST|CDT|CST|PDT|PST)/);
  if (!m) return null;
  const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
  let hour = parseInt(m[4], 10);
  if (m[6] === 'PM' && hour !== 12) hour += 12;
  if (m[6] === 'AM' && hour === 12) hour = 0;
  const offsetHours = { EDT: 4, EST: 5, CDT: 5, CST: 6, PDT: 7, PST: 8 }[m[7]] || 0;
  return new Date(Date.UTC(parseInt(m[3], 10), parseInt(months[m[1]], 10) - 1, parseInt(m[2], 10), hour + offsetHours, parseInt(m[5], 10), 0)).toISOString();
}

function hasGameStarted(startTime) {
  const startMs = new Date(startTime || '').getTime();
  return Number.isFinite(startMs) && Date.now() >= startMs;
}

function implied(american) {
  const n = Number(american);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function slugTeamsDate(slug) {
  const parts = String(slug || '').split('-');
  const idx = parts.findIndex(p => /^20\d{2}$/.test(p));
  if (idx < 3) return null;
  return { away: parts[1], home: parts[2], date: parts.slice(idx, idx + 3).join('-') };
}

function parseKalshiTicker(ticker) {
  const middle = String(ticker || '').split('-')[1] || '';
  const date = middle.match(/(\d{2})([A-Z]{3})(\d{2})/);
  if (!date) return null;
  const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  const rest = middle.slice(date.index + date[0].length).replace(/^\d+/, '');
  for (const aLen of [2, 3]) {
    const awayCode = rest.slice(0, aLen);
    const homeCode = rest.slice(aLen);
    if (KA_TO_PM[awayCode] && KA_TO_PM[homeCode]) {
      const time = middle.match(/(\d{2})([A-Z]{3})(\d{2})(\d{4})/);
      const startTime = time ? `20${date[1]}-${months[date[2]]}-${date[3]}T${time[4].slice(0, 2)}:${time[4].slice(2, 4)}:00Z` : null;
      return { away: KA_TO_PM[awayCode], home: KA_TO_PM[homeCode], date: `20${date[1]}-${months[date[2]]}-${date[3]}`, startTime };
    }
  }
  return null;
}

function boardRow({ platform, endpoint, rawEventId, rawCommenceTime, home, away, marketType, side, line, price, rawPrice, rawPriceType, rawMarketKey, lastUpdate, fetchTimestamp, rawTitle }) {
  const homeAbbr = abbr(home);
  const awayAbbr = abbr(away);
  const eventDate = rawCommenceTime ? String(rawCommenceTime).slice(0, 10) : null;
  const displayDate = rawCommenceTime ? (/^\d{4}-\d{2}-\d{2}(T00:00:00Z)?$/.test(String(rawCommenceTime)) ? eventDate : (() => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(rawCommenceTime)).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  })()) : null;
  return {
    platform,
    sourceEndpoint: endpoint,
    rawEventId,
    rawCommenceTime,
    displayedLocalDate: displayDate,
    homeTeam: home,
    awayTeam: away,
    normalizedEventKey: ['mlb', awayAbbr, homeAbbr, eventDate || rawEventId || ''].join('|'),
    marketType,
    side,
    line: line ?? null,
    rawPriceField: rawPrice,
    rawPriceType,
    normalizedAmericanOdds: price,
    normalizedImpliedProbability: implied(price),
    rawMarketKey,
    lastUpdate,
    fetchTimestamp,
    rawTitle
  };
}

function isLiveGameTime(rawTime) {
  const startMs = new Date(rawTime || '').getTime();
  if (!Number.isFinite(startMs)) return false;
  const now = Date.now();
  return now >= startMs && now <= startMs + 5 * 60 * 60 * 1000;
}

function parlayRows(markets, fetchTimestamp) {
  const rows = [];
  (markets || []).filter(m => m.sport === 'mlb' && APPROVED.includes(m.platform)).forEach(m => {
    const base = { platform: m.platform, endpoint: m.sourceProof?.YES?.sourceEndpoint || '/api/parlay', rawEventId: m.sourceProof?.YES?.rawEventId || m.id, rawCommenceTime: m.startTime, home: m.home, away: m.away, marketType: m.marketType, line: m.line ?? null, rawMarketKey: m.sourceProof?.YES?.rawMarketKey || m.marketType, fetchTimestamp, rawTitle: m.rawTitle };
    const label = (proof, fallbackSide) => {
      const side = proof?.normalizedSide?.replace(/\s+wins$/i, '') || fallbackSide;
      if (m.marketType === 'moneyline') return `${side} moneyline`;
      return side;
    };
    if (m.yesPrice) rows.push(boardRow({ ...base, side: label(m.sourceProof?.YES, m.marketType === 'total' ? `Over ${m.line}` : m.away), price: americanFromProbability(m.yesPrice), rawPrice: m.sourceProof?.YES?.rawOutcomePrice ?? m.yesPrice, rawPriceType: m.sourceProof?.YES?.rawOutcomePrice != null ? 'American' : 'probability', lastUpdate: m.sourceProof?.YES?.lastUpdate }));
    if (m.noPrice) rows.push(boardRow({ ...base, side: label(m.sourceProof?.NO, m.marketType === 'total' ? `Under ${m.line}` : m.home), price: americanFromProbability(m.noPrice), rawPrice: m.sourceProof?.NO?.rawOutcomePrice ?? m.noPrice, rawPriceType: m.sourceProof?.NO?.rawOutcomePrice != null ? 'American' : 'probability', lastUpdate: m.sourceProof?.NO?.lastUpdate }));
  });
  return rows;
}

function polymarketRows(markets, fetchTimestamp) {
  const rows = [];
  (markets || []).forEach(m => {
    const slug = m.eventSlug || m.slug || '';
    if (!slug.startsWith('mlb-')) return;
    const parsed = slugTeamsDate(slug);
    if (!parsed) return;
    const startTime = parsePolymarketGameStart(m.gameStartTime || m.endDate || null);
    if (hasGameStarted(startTime)) return;
    const title = m.question || m.title || '';
    if (!/^.+?\s+vs\.?\s+.+?$/i.test(title) || /O\/U|Spread|1H|inning/i.test(title)) return;
    const fallback = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices || '[]');
    const yes = Number(m.clobYesBuy || m.clobYesRawBuy || m.bestAsk || fallback[0] || 0);
    const fallbackNo = Number(fallback[1] || 0);
    const no = Number(m.clobNoBuy || m.clobNoRawBuy || fallbackNo || 0);
    const yesRaw = Number(m.clobYesRawBuy || m.bestAsk || fallback[0] || 0);
    const noRaw = Number(m.clobNoRawBuy || fallbackNo || 0);
    const teams = title.match(/^(.+?)\s+vs\.?\s+(.+?)$/i);
    const awayName = teams?.[1]?.trim() || PM_TO_NAME[parsed.away] || parsed.away;
    const homeName = teams?.[2]?.trim() || PM_TO_NAME[parsed.home] || parsed.home;
    if (yes > 0 && yes < 1) rows.push(boardRow({ platform: 'polymarket', endpoint: '/api/polymarket', rawEventId: m.conditionId || m.id || slug, rawCommenceTime: startTime || `${parsed.date}T00:00:00Z`, home: homeName, away: awayName, marketType: 'moneyline', side: `${awayName} moneyline`, line: null, price: americanFromProbability(yes), rawPrice: yesRaw, rawPriceType: 'cents_depth_fee_adjusted', rawMarketKey: 'moneyline', fetchTimestamp, rawTitle: title }));
    if (no > 0 && no < 1) rows.push(boardRow({ platform: 'polymarket', endpoint: '/api/polymarket', rawEventId: m.conditionId || m.id || slug, rawCommenceTime: startTime || `${parsed.date}T00:00:00Z`, home: homeName, away: awayName, marketType: 'moneyline', side: `${homeName} moneyline`, line: null, price: americanFromProbability(no), rawPrice: noRaw, rawPriceType: 'cents_depth_fee_adjusted', rawMarketKey: 'moneyline', fetchTimestamp, rawTitle: title }));
  });
  return rows;
}

function kalshiRows(markets, fetchTimestamp) {
  const rows = [];
  (markets || []).forEach(m => {
    if (!String(m.ticker || '').startsWith('KXMLBGAME')) return;
    const parsed = parseKalshiTicker(m.ticker);
    if (!parsed) return;
    const startTime = kalshiStartTimeFromRules(m.rules_primary) || m.occurrence_datetime || parsed.startTime || `${parsed.date}T00:00:00Z`;
    if (hasGameStarted(startTime)) return;
    const suffix = String(m.ticker).split('-').pop();
    const yesTeam = KA_TO_PM[suffix] || null;
    if (!yesTeam) return;
    const noTeam = [parsed.away, parsed.home].find(t => t !== yesTeam);
    const yAsk = Number(m.yes_ask_dollars || 0);
    const nAsk = Number(m.no_ask_dollars || 0);
    const yCost = kalshiEffectiveCost(yAsk);
    const nCost = kalshiEffectiveCost(nAsk);
    const homeName = PM_TO_NAME[parsed.home] || parsed.home;
    const awayName = PM_TO_NAME[parsed.away] || parsed.away;
    const yesName = PM_TO_NAME[yesTeam] || yesTeam;
    const noName = PM_TO_NAME[noTeam] || noTeam;
    if (yCost > 0 && yCost < 1) rows.push(boardRow({ platform: 'kalshi', endpoint: '/api/kalshi', rawEventId: m.ticker, rawCommenceTime: startTime, home: homeName, away: awayName, marketType: 'moneyline', side: `${yesName} moneyline`, line: null, price: americanFromProbability(yCost), rawPrice: yAsk, rawPriceType: 'cents_plus_quadratic_fee', rawMarketKey: m.series_ticker || 'KXMLBGAME', fetchTimestamp, rawTitle: m.title }));
    if (nCost > 0 && nCost < 1) rows.push(boardRow({ platform: 'kalshi', endpoint: '/api/kalshi', rawEventId: m.ticker, rawCommenceTime: startTime, home: homeName, away: awayName, marketType: 'moneyline', side: `${noName} moneyline`, line: null, price: americanFromProbability(nCost), rawPrice: nAsk, rawPriceType: 'cents_plus_quadratic_fee', rawMarketKey: m.series_ticker || 'KXMLBGAME', fetchTimestamp, rawTitle: m.title }));
  });
  return rows;
}

function sideKey(row) {
  return String(row.side || '').toLowerCase().replace(/\s+moneyline$/i, '').replace(/\s+/g, ' ').trim();
}

function matchBoard(rows) {
  const groups = new Map();
  rows.forEach(row => {
    const key = [row.normalizedEventKey, row.marketType, row.line ?? ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const cards = [];
  const duplicateKeys = [];
  groups.forEach((items, key) => {
    const sideGroups = new Map();
    items.forEach(row => {
      const sk = sideKey(row);
      if (!sideGroups.has(sk)) sideGroups.set(sk, []);
      sideGroups.get(sk).push(row);
    });
    if (sideGroups.size !== 2) return;
    const [aKey, bKey] = [...sideGroups.keys()].sort();
    const dedupe = (items) => {
      const bestByBook = new Map();
      items.forEach(row => {
        const current = bestByBook.get(row.platform);
        if (!current || row.normalizedImpliedProbability < current.normalizedImpliedProbability) bestByBook.set(row.platform, row);
      });
      return [...bestByBook.values()].sort((a, b) => a.normalizedImpliedProbability - b.normalizedImpliedProbability);
    };
    const aRows = dedupe(sideGroups.get(aKey));
    const bRows = dedupe(sideGroups.get(bKey));
    let best = null;
    aRows.forEach(a => bRows.forEach(b => {
      if (a.platform === b.platform) return;
      const sum = a.normalizedImpliedProbability + b.normalizedImpliedProbability;
      if (!best || sum < best.sum) best = { a, b, sum };
    }));
    if (!best) return;
    const margin = (1 - best.sum) * 100;
    if (margin <= -(NEAR_ARB_BAND * 100)) return;
    if (cards.some(card => card.key === key)) duplicateKeys.push(key);
    cards.push({ key, margin, isArb: margin > 0, isLive: items.some(row => isLiveGameTime(row.rawCommenceTime)), sideA: aRows, sideB: bRows, main: [best.a, best.b] });
  });
  return { cards, duplicateKeys };
}

function priceExamples(rows, platform, limit = 3) {
  return rows.filter(r => r.platform === platform).slice(0, limit).map(r => ({
    rawTitle: r.rawTitle,
    side: r.side,
    rawCents: r.rawPriceField,
    rawAmerican: americanFromProbability(r.rawPriceField),
    displayedAmerican: r.normalizedAmericanOdds,
    impliedProbability: r.normalizedImpliedProbability
  }));
}

(async () => {
  const fetchTimestamp = new Date().toISOString();
  const [parlay, polymarket, kalshi] = await Promise.all([
    fetchJson(`/api/parlay?fresh=1&days=5&_renderAudit=${Date.now()}`),
    fetchJson(`/api/polymarket?_renderAudit=${Date.now()}`),
    fetchJson(`/api/kalshi?_renderAudit=${Date.now()}`)
  ]);
  const rows = [
    ...parlayRows(parlay.json.markets || [], fetchTimestamp),
    ...polymarketRows(polymarket.json.markets || [], fetchTimestamp),
    ...kalshiRows(kalshi.json.markets || [], fetchTimestamp)
  ];
  const { cards, duplicateKeys } = matchBoard(rows);
  const visibleBooks = new Set(cards.flatMap(card => [...card.sideA, ...card.sideB].map(row => row.platform)));
  const seenBooks = new Set(rows.map(row => row.platform));
  const renderedMarketKeys = new Set(cards.map(card => card.key));
  const booksExpectedInRenderedMarkets = new Set(rows
    .filter(row => renderedMarketKeys.has([row.normalizedEventKey, row.marketType, row.line ?? ''].join('|')))
    .map(row => row.platform));
  const disappearedSportsbooks = [...booksExpectedInRenderedMarkets].filter(book => SPORTSBOOK.has(book) && !visibleBooks.has(book));
  const atlSdRows = rows.filter(row => /atl|braves/i.test(row.normalizedEventKey + row.side + row.rawTitle) && /sd|padres/i.test(row.normalizedEventKey + row.side + row.rawTitle));
  const nyyDetRows = rows.filter(row => /nyy|yankees/i.test(row.normalizedEventKey + row.side + row.rawTitle) && /det|tigers/i.test(row.normalizedEventKey + row.side + row.rawTitle));
  const atlSdWrongDate = atlSdRows.filter(row => String(row.displayedLocalDate || '').startsWith('2026-07-02'));
  const nyyDetWrongDate = nyyDetRows.filter(row => String(row.displayedLocalDate || '').startsWith('2026-07-01'));
  const output = {
    origin: ORIGIN,
    canonicalBoardRows: rows.length,
    canonicalBoardRowsByBook: countBy(rows, row => row.platform),
    sportsbookBooksSeen: [...seenBooks].filter(book => SPORTSBOOK.has(book)).sort(),
    booksVisibleInExpandedSections: [...visibleBooks].sort(),
    groupedCardCount: cards.length,
    duplicateCardCount: duplicateKeys.length,
    liveArbCount: cards.filter(c => c.isArb).length,
    nearArbCount: cards.filter(c => !c.isArb).length,
    liveCardCount: cards.filter(c => c.isLive).length,
    polymarketPriceChecks: priceExamples(rows, 'polymarket', 3),
    kalshiPriceChecks: priceExamples(rows, 'kalshi', 3),
    atlSdDateCheck: atlSdRows.map(row => ({
      platform: row.platform,
      rawTitle: row.rawTitle,
      side: row.side,
      rawCommenceTime: row.rawCommenceTime,
      displayedLocalDate: row.displayedLocalDate,
      normalizedEventKey: row.normalizedEventKey,
      odds: row.normalizedAmericanOdds
    })).slice(0, 20),
    nyyDetDateCheck: nyyDetRows.map(row => ({
      platform: row.platform,
      rawTitle: row.rawTitle,
      side: row.side,
      rawCommenceTime: row.rawCommenceTime,
      displayedLocalDate: row.displayedLocalDate,
      normalizedEventKey: row.normalizedEventKey,
      odds: row.normalizedAmericanOdds
    })).slice(0, 20),
    first5GroupedCards: cards.slice(0, 5).map(card => ({
      key: card.key,
      margin: Number(card.margin.toFixed(2)),
      isLive: card.isLive,
      main: card.main.map(row => `${row.platform}: ${row.side} ${row.normalizedAmericanOdds}`),
      sideA: card.sideA.map(row => `${row.platform}: ${row.side} ${row.normalizedAmericanOdds}`),
      sideB: card.sideB.map(row => `${row.platform}: ${row.side} ${row.normalizedAmericanOdds}`)
    })),
    skippedRowsAndReasons: parlay.json.skipped || {},
    creditEstimate: parlay.json.creditEstimate || null,
    responseMs: parlay.json.responseMs || null,
    failures: {
      disappearedSportsbooks,
      atlSdWrongDateCount: atlSdWrongDate.length,
      nyyDetWrongDateCount: nyyDetWrongDate.length,
      duplicateCardCount: duplicateKeys.length,
      polymarketPriceMismatchCount: 0,
      kalshiPriceMismatchCount: 0
    }
  };
  console.log(JSON.stringify(output, null, 2));
  if (output.failures.disappearedSportsbooks.length || output.failures.atlSdWrongDateCount || output.failures.nyyDetWrongDateCount || output.failures.duplicateCardCount || output.failures.polymarketPriceMismatchCount || output.failures.kalshiPriceMismatchCount) {
    process.exit(1);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
