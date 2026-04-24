/**
 * Polymarket Sports Proxy — Two-Stage Real-Time Architecture
 *
 * Stage 1: Gamma API — market discovery, token IDs, metadata (5-min cache OK)
 * Stage 2: CLOB API — real-time YES/NO prices per token (no cache)
 *
 * This gives accurate live prices matching what users see on Polymarket.
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB  = 'https://clob.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

const KA_TO_PM = {
  ATL:'atl',BOS:'bos',BKN:'bkn',CHA:'cha',CHI:'chi',CLE:'cle',DAL:'dal',
  DEN:'den',DET:'det',GSW:'gsw',HOU:'hou',IND:'ind',LAC:'lac',LAL:'lal',
  MEM:'mem',MIA:'mia',MIL:'mil',MIN:'min',NOP:'nop',NYK:'nyk',OKC:'okc',
  ORL:'orl',PHI:'phi',PHX:'phx',POR:'por',SAC:'sac',SAS:'sas',TOR:'tor',
  UTA:'uta',WAS:'was',
  // MLB
  ARI:'ari',ATH:'oak',BAL:'bal',CHC:'chc',CIN:'cin',COL:'col',CWS:'cws',
  KCR:'kc',LAA:'laa',LAD:'lad',NYM:'nym',NYY:'nyy',OAK:'oak',SDP:'sd',
  SEA:'sea',SFG:'sf',STL:'stl',TBR:'tb',TEX:'tex',WSH:'wsh',
};

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
      (d.markets || [])
        .filter(m => !m.mve_collection_ticker && m.market_type === 'binary' && m.status === 'active')
        .forEach(m => {
          const gk = gameKeyFromKalshiTicker(m.ticker);
          if (gk) slugs.add(gk);
        });
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
    const data   = await r.json();
    const event  = Array.isArray(data) ? data[0] : data;
    return (event?.markets || [])
      .filter(m => !/\b1H\b/.test(m.question || ''))
      .map(m => ({ ...m, eventSlug: slug, eventEndDate: event?.endDate }));
  } catch { return []; }
}

// Batch fetch real-time prices from CLOB for multiple token IDs
async function fetchClobPrices(tokenIds) {
  if (!tokenIds.length) return {};
  try {
    // POST /prices accepts array of {token_id, side}
    const body = tokenIds.flatMap(id => [
      { token_id: id, side: 'BUY' },
    ]);
    const r = await fetch(`${CLOB}/prices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return {};
    return await r.json(); // { tokenId: { BUY: "0.77" }, ... }
  } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Stage 1: Get game slugs from Kalshi schedule
    const slugs = await getKalshiGameSlugs();

    // Stage 2: Fetch Gamma market metadata for each game (in batches)
    const allMarkets = [];
    const batchSize  = 8;
    for (let i = 0; i < slugs.length; i += batchSize) {
      const batch   = slugs.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchEventMarkets));
      results.forEach(mkts => allMarkets.push(...mkts));
      if (i + batchSize < slugs.length) await new Promise(r => setTimeout(r, 150));
    }

    // Stage 3: Collect all token IDs for real-time CLOB price fetch
    const tokenMap = {}; // tokenId → market index
    allMarkets.forEach((m, idx) => {
      const ids = Array.isArray(m.clobTokenIds)
        ? m.clobTokenIds
        : JSON.parse(m.clobTokenIds || '[]');
      if (ids[0]) tokenMap[ids[0]] = { idx, role: 'yes' };
      if (ids[1]) tokenMap[ids[1]] = { idx, role: 'no'  };
    });

    // Stage 4: Batch fetch real-time prices from CLOB
    const tokenIds   = Object.keys(tokenMap);
    const clobPrices = await fetchClobPrices(tokenIds);

    // Stage 5: Inject real-time prices into each market
    const enriched = allMarkets.map((m, idx) => {
      const ids = Array.isArray(m.clobTokenIds)
        ? m.clobTokenIds
        : JSON.parse(m.clobTokenIds || '[]');

      const yesTokenId = ids[0];
      const noTokenId  = ids[1];

      // Real-time BUY prices from CLOB (what you pay to buy YES or NO)
      const yesBuy = yesTokenId && clobPrices[yesTokenId]
        ? parseFloat(clobPrices[yesTokenId].BUY || 0)
        : null;
      const noBuy  = noTokenId  && clobPrices[noTokenId]
        ? parseFloat(clobPrices[noTokenId].BUY || 0)
        : null;

      return {
        ...m,
        // Override with real-time CLOB prices when available
        bestAsk: yesBuy || m.bestAsk,
        bestBid: m.bestBid,
        clobYesBuy: yesBuy,
        clobNoBuy:  noBuy,
      };
    });

    return res.status(200).json({
      markets: enriched,
      total:   enriched.length,
      slugsChecked: slugs.length,
      clobPricesFetched: tokenIds.length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
