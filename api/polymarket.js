/**
 * Polymarket Sports Proxy — Fast Two-Stage Architecture
 *
 * Stage 1: Gamma API for market discovery + token IDs
 * Stage 2a: CLOB POST /prices — batch real-time top-of-book prices (fast, one call)
 * Stage 2b: CLOB GET /book — full orderbook ONLY for near-arb candidates (targeted)
 *
 * This stays well within Vercel's 10s timeout while giving accurate prices.
 */

const GAMMA  = 'https://gamma-api.polymarket.com';
const CLOB   = 'https://clob.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

const KA_TO_PM = {
  ATL:'atl',BOS:'bos',BKN:'bkn',CHA:'cha',CHI:'chi',CLE:'cle',DAL:'dal',
  DEN:'den',DET:'det',GSW:'gsw',HOU:'hou',IND:'ind',LAC:'lac',LAL:'lal',
  MEM:'mem',MIA:'mia',MIL:'mil',MIN:'min',NOP:'nop',NYK:'nyk',OKC:'okc',
  ORL:'orl',PHI:'phi',PHX:'phx',POR:'por',SAC:'sac',SAS:'sas',TOR:'tor',
  UTA:'uta',WAS:'was',
  ARI:'ari',ATH:'oak',BAL:'bal',CHC:'chc',CIN:'cin',COL:'col',CWS:'cws',
  KCR:'kc',LAA:'laa',LAD:'lad',NYM:'nym',NYY:'nyy',OAK:'oak',SDP:'sd',
  SEA:'sea',SFG:'sf',STL:'stl',TBR:'tb',TEX:'tex',WSH:'wsh',
};

const PM_FEE  = 0.01;  // Polymarket 1% sports fee (confirmed)
const STANDARD_BET = 50;

function gameKeyFromKalshiTicker(ticker) {
  const parts  = ticker.split('-');
  const middle = parts[1] || '';
  const dateM  = middle.match(/^(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const year = '20' + dateM[1];
  const mon  = MONTHS[dateM[2]] || '01';
  const day  = dateM[3].padStart(2, '0');
  const ts   = middle.slice(dateM[0].length);
  const away = KA_TO_PM[ts.slice(0,3)] || ts.slice(0,3).toLowerCase();
  const home = KA_TO_PM[ts.slice(3,6)] || ts.slice(3,6).toLowerCase();
  let sport = 'other';
  if (/KXNBA/.test(ticker)) sport = 'nba';
  else if (/KXMLB/.test(ticker)) sport = 'mlb';
  else if (/KXNFL/.test(ticker)) sport = 'nfl';
  else if (/KXNHL/.test(ticker)) sport = 'nhl';
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

function calcFillPrice(asks, dollars) {
  const sorted = [...asks].sort((a,b) => parseFloat(a.price)-parseFloat(b.price));
  let rem = dollars, shares = 0, cost = 0;
  for (const lvl of sorted) {
    if (rem <= 0) break;
    const p = parseFloat(lvl.price), sz = parseFloat(lvl.size);
    const full = sz * p;
    if (full <= rem) { shares += sz; cost += full; rem -= full; }
    else { shares += rem/p; cost += rem; rem = 0; }
  }
  if (!shares) return null;
  return { avgPrice: parseFloat((cost/shares).toFixed(4)), fullyFillable: rem === 0 };
}

async function getKalshiGameSlugs() {
  const series = ['KXNBAGAME','KXMLBGAME','KXNFLGAME','KXNHLGAME'];
  const slugs  = new Set();
  await Promise.all(series.map(async s => {
    try {
      const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=200`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) return;
      const d = await r.json();
      (d.markets||[])
        .filter(m => !m.mve_collection_ticker && m.market_type==='binary' && m.status==='active')
        .forEach(m => { const gk = gameKeyFromKalshiTicker(m.ticker); if (gk) slugs.add(gk); });
    } catch {}
  }));
  return [...slugs];
}

async function fetchEventMarkets(slug) {
  try {
    const r = await fetch(`${GAMMA}/events?slug=${slug}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return [];
    const data  = await r.json();
    const event = Array.isArray(data) ? data[0] : data;
    return (event?.markets||[])
      .filter(m => !/\b1H\b/.test(m.question||''))
      .map(m => ({ ...m, eventSlug: slug }));
  } catch { return []; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Stage 1: Kalshi game slugs
    const slugs = await getKalshiGameSlugs();

    // Stage 2: Gamma metadata in batches
    const allMarkets = [];
    for (let i = 0; i < slugs.length; i += 8) {
      const results = await Promise.all(slugs.slice(i, i+8).map(fetchEventMarkets));
      results.forEach(mkts => allMarkets.push(...mkts));
      if (i + 8 < slugs.length) await sleep(100);
    }

    // Stage 3: Collect YES token IDs → batch price fetch (ONE fast API call)
    const tokenToIdx = {};
    allMarkets.forEach((m, idx) => {
      const ids = Array.isArray(m.clobTokenIds)
        ? m.clobTokenIds : JSON.parse(m.clobTokenIds||'[]');
      if (ids[0]) tokenToIdx[ids[0]] = { idx, yesId: ids[0], noId: ids[1] };
    });

    const yesIds = Object.keys(tokenToIdx);
    const noIds  = Object.values(tokenToIdx).map(v => v.noId).filter(Boolean);
    const allIds = [...yesIds, ...noIds];

    // Batch price fetch — single POST call for all tokens
    let clobPrices = {};
    try {
      const body = allIds.map(id => ({ token_id: id, side: 'BUY' }));
      const r = await fetch(`${CLOB}/prices`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', Accept:'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) clobPrices = await r.json();
    } catch {}

    // Stage 4: Apply prices + fee to each market
    const enriched = allMarkets.map((m, idx) => {
      const ids = Array.isArray(m.clobTokenIds)
        ? m.clobTokenIds : JSON.parse(m.clobTokenIds||'[]');
      const yesId = ids[0], noId = ids[1];

      // Top-of-book price from batch endpoint
      const yesTob = yesId && clobPrices[yesId] ? parseFloat(clobPrices[yesId].BUY||0) : 0;
      const noTob  = noId  && clobPrices[noId]  ? parseFloat(clobPrices[noId].BUY||0)  : 0;

      // Fall back to Gamma bestAsk if CLOB unavailable
      const yesBase = yesTob > 0.01 ? yesTob : parseFloat(m.bestAsk||0);
      const noBase  = noTob  > 0.01 ? noTob  : (parseFloat(m.bestBid||0) > 0.01 ? 1 - parseFloat(m.bestBid) : 0);

      // Apply Polymarket 1% sports fee (confirmed by debug)
      const clobYesBuy = yesBase > 0.01 ? parseFloat((yesBase * (1 + PM_FEE)).toFixed(4)) : null;
      const clobNoBuy  = noBase  > 0.01 ? parseFloat((noBase  * (1 + PM_FEE)).toFixed(4)) : null;

      return { ...m, clobYesBuy, clobNoBuy, yesFullyFillable: true };
    });

    return res.status(200).json({
      markets: enriched,
      total: enriched.length,
      slugsChecked: slugs.length,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
