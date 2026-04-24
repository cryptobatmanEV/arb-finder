/**
 * Polymarket Sports Proxy
 * 
 * Strategy: Use Kalshi game tickers as the schedule source to build
 * Polymarket event slugs, then fetch those events directly.
 * 
 * Kalshi: KXNBAGAME-26APR23DENMIN-MIN → nba, Apr 23, DEN vs MIN
 * Polymarket slug: nba-den-min-2026-04-23
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

// Kalshi 3-letter → Polymarket lowercase abbreviation
const CODE_MAP = {
  // NBA
  ATL:'atl',BOS:'bos',BKN:'bkn',CHA:'cha',CHI:'chi',CLE:'cle',DAL:'dal',
  DEN:'den',DET:'det',GSW:'gsw',HOU:'hou',IND:'ind',LAC:'lac',LAL:'lal',
  MEM:'mem',MIA:'mia',MIL:'mil',MIN:'min',NOP:'nop',NYK:'nyk',OKC:'okc',
  ORL:'orl',PHI:'phi',PHX:'phx',POR:'por',SAC:'sac',SAS:'sas',TOR:'tor',
  UTA:'uta',WAS:'was',
  // MLB
  ARI:'ari',ATH:'oak',BAL:'bal',CHC:'chc',CIN:'cin',COL:'col',
  CWS:'cws',DET:'det',HOU:'hou',KC:'kc',KCR:'kc',LAA:'laa',LAD:'lad',
  MIA:'mia',MIL:'mil',MIN:'min',NYM:'nym',NYY:'nyy',OAK:'oak',
  PHI:'phi',PIT:'pit',SD:'sd',SDP:'sd',SEA:'sea',SF:'sf',SFG:'sf',
  STL:'stl',TB:'tb',TBR:'tb',TEX:'tex',TOR:'tor',WSH:'wsh',
};

const SPORT_PREFIX = {
  KXNBAGAME:'nba', KXMLBGAME:'mlb', KXNFLGAME:'nfl', KXNHLGAME:'nhl',
};

function parseKalshiGameTicker(ticker) {
  // KXNBAGAME-26APR27DETORL-ORL → { sport:'nba', date:'2026-04-27', away:'det', home:'orl' }
  const months = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  const parts = ticker.split('-');
  if (parts.length < 2) return null;

  const seriesKey = Object.keys(SPORT_PREFIX).find(k => ticker.startsWith(k));
  if (!seriesKey) return null;
  const sport = SPORT_PREFIX[seriesKey];

  // parts[1] = 26APR27DETORL (year+month+day+teamcodes)
  const middle = parts[1];
  const dateM = middle.match(/^(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const date = `20${dateM[1]}-${months[dateM[2]]}-${dateM[3].padStart(2,'0')}`;

  // Team codes after the date
  const teamStr = middle.slice(dateM[0].length); // e.g. DETORL
  if (teamStr.length < 6) return null;
  const awayCode = teamStr.slice(0, 3);
  const homeCode = teamStr.slice(3, 6);

  const away = CODE_MAP[awayCode];
  const home = CODE_MAP[homeCode];
  if (!away || !home) return null;

  return { sport, date, away, home, slug: `${sport}-${away}-${home}-${date}` };
}

async function getKalshiGameTickers() {
  const series = ['KXNBAGAME','KXMLBGAME','KXNFLGAME','KXNHLGAME'];
  const tickers = new Set();
  
  await Promise.all(series.map(async s => {
    try {
      const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=200`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return;
      const d = await r.json();
      (d.markets || [])
        .filter(m => !m.mve_collection_ticker && m.market_type === 'binary' && m.status === 'active')
        .forEach(m => tickers.add(m.ticker));
    } catch {}
  }));
  return [...tickers];
}

async function fetchPolymarketEvent(slug) {
  try {
    const r = await fetch(`${GAMMA}/events?slug=${slug}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const events = await r.json();
    const event = Array.isArray(events) ? events[0] : events;
    if (!event || !event.markets) return [];
    return event.markets.map(m => ({ ...m, eventSlug: slug, eventTitle: event.title, eventEndDate: event.endDate }));
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: Get today's game tickers from Kalshi
    const tickers = await getKalshiGameTickers();

    // Step 2: Parse tickers into unique game slugs
    const slugMap = new Map();
    tickers.forEach(ticker => {
      const parsed = parseKalshiGameTicker(ticker);
      if (parsed) slugMap.set(parsed.slug, parsed);
    });

    // Step 3: Fetch Polymarket events for each game in batches
    const slugs = [...slugMap.keys()];
    const allMarkets = [];
    const batchSize = 8;

    for (let i = 0; i < slugs.length; i += batchSize) {
      const batch = slugs.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchPolymarketEvent));
      results.forEach(mkts => allMarkets.push(...mkts));
      if (i + batchSize < slugs.length) await new Promise(r => setTimeout(r, 200));
    }

    return res.status(200).json({
      markets: allMarkets,
      total: allMarkets.length,
      slugsChecked: slugs.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
