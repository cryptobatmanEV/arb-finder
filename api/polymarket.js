/**
 * Polymarket Sports Proxy
 * Uses Gamma API for market discovery, CLOB API for real-time prices
 * Gamma bestAsk/bestBid is cached ~5 min — CLOB /book gives live data
 * Applies confirmed 1% sports fee with ceiling rounding
 */

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB  = 'https://clob.polymarket.com';
const KALSH = 'https://api.elections.kalshi.com/trade-api/v2';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

const KA_TO_PM = {
  // NBA
  ATL:'atl',BOS:'bos',BKN:'bkn',CHA:'cha',CHI:'chi',CLE:'cle',DAL:'dal',
  DEN:'den',DET:'det',GSW:'gsw',HOU:'hou',IND:'ind',LAC:'lac',LAL:'lal',
  MEM:'mem',MIA:'mia',MIL:'mil',MIN:'min',NOP:'nop',NYK:'nyk',OKC:'okc',
  ORL:'orl',PHI:'phi',PHX:'phx',POR:'por',SAC:'sac',SAS:'sas',TOR:'tor',
  UTA:'uta',WAS:'was',
  // MLB — confirmed from Polymarket teams endpoint
  SF:'sf',WSH:'wsh',NYM:'nym',BAL:'bal',NYY:'nyy',TB:'tb',
  LAD:'lad',SD:'sd',COL:'col',ARI:'ari',STL:'stl',CHC:'chc',
  OAK:'oak',SEA:'sea',LAA:'laa',TEX:'tex',KC:'kc',CWS:'cws',
  ATH:'oak',KCR:'kc',KAN:'kc',SDP:'sd',SFG:'sf',TBR:'tb',
  MIL:'mil',MIN:'min',DET:'det',HOU:'hou',MIA:'mia',
  PHI:'phi',PIT:'pit',CIN:'cin',NYM:'nym',NYY:'nyy',
  // NHL
  ANA:'ana',BUF:'buf',CAR:'car',CBJ:'cbj',CGY:'cgy',EDM:'edm',FLA:'fla',
  LAK:'lak',MTL:'mtl',NJD:'njd',NSH:'nsh',NYI:'nyi',NYR:'nyr',
  OTT:'ott',SJS:'sjs',TBL:'tbl',VAN:'van',VGK:'vgk',WPG:'wpg',
  // Utah Hockey Club — Kalshi uses UTA, some systems use UTH
  UTH:'uta',
  // NHL uses WSH for Capitals (same as MLB Nationals)
};

// Polymarket charges 1% sports fee on execution.
// IMPORTANT: Do NOT ceil to whole cents — Polymarket computes payouts at precise
// sub-cent prices (e.g. 63.63¢) even though it displays "Avg Price 64¢".
// ceil(63.63 → 64¢) then doing stake/0.64 = $15.63 vs Polymarket's actual $15.70.
// Store 4 decimal precision so our payout display matches Polymarket's internal calc.
const pmPrice = (p) => parseFloat((p * 1.01).toFixed(4));

function gameKeyFromKalshiTicker(ticker) {
  const parts  = ticker.split('-');
  const middle = parts[1] || '';
  const dateM  = middle.match(/(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const year = '20' + dateM[1];
  const mon  = MONTHS[dateM[2]] || '01';
  const day  = dateM[3].padStart(2, '0');
  const rest = middle.slice(dateM.index + dateM[0].length);
  const teamStr = rest.replace(/^\d+/, ''); // strip embedded game time (MLB only)
  let sport = 'other';
  if (/KXNBA/.test(ticker)) sport = 'nba';
  else if (/KXMLB/.test(ticker)) sport = 'mlb';
  else if (/KXNFL/.test(ticker)) sport = 'nfl';
  else if (/KXNHL/.test(ticker)) sport = 'nhl';
  let away = null, home = null;
  for (const aLen of [2, 3]) {
    const aC = teamStr.slice(0, aLen);
    const hC = teamStr.slice(aLen);
    if (hC.length >= 2 && KA_TO_PM[aC] && KA_TO_PM[hC]) {
      away = KA_TO_PM[aC]; home = KA_TO_PM[hC]; break;
    }
  }
  if (!away) away = KA_TO_PM[teamStr.slice(0,3)] || teamStr.slice(0,3).toLowerCase();
  if (!home) home = KA_TO_PM[teamStr.slice(3,6)] || teamStr.slice(3,6).toLowerCase();
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

async function getKalshiGameSlugs() {
  const series = ['KXNBAGAME','KXMLBGAME','KXNFLGAME','KXNHLGAME'];
  const slugs  = new Set();
  await Promise.all(series.map(async s => {
    try {
      const r = await fetch(`${KALSH}/markets?series_ticker=${s}&limit=200`, {
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

/**
 * Fetch real-time orderbook from CLOB for a YES token.
 * Returns { bestAsk, bestBid } or null on failure.
 * bestAsk = lowest ask = price to BUY YES
 * bestBid = highest bid = used to derive NO buy price: 1 - bestBid
 */
async function fetchClobBook(tokenId) {
  try {
    const r = await fetch(`${CLOB}/book?token_id=${tokenId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const book = await r.json();
    const asks = (book.asks || []).map(a => parseFloat(a.price)).filter(p => p > 0 && p < 1);
    const bids = (book.bids || []).map(b => parseFloat(b.price)).filter(p => p > 0 && p < 1);
    return {
      bestAsk: asks.length ? Math.min(...asks) : null,
      bestBid: bids.length ? Math.max(...bids) : null,
    };
  } catch {
    return null;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Get today's game slugs from Kalshi schedule
    const slugs = await getKalshiGameSlugs();

    // 2. Fetch Gamma market metadata in batches
    const allMarkets = [];
    for (let i = 0; i < slugs.length; i += 8) {
      const results = await Promise.all(slugs.slice(i, i+8).map(fetchEventMarkets));
      results.forEach(mkts => allMarkets.push(...mkts));
      if (i + 8 < slugs.length) await sleep(100);
    }

    // 3. Extract YES token IDs for CLOB real-time price fetch
    //    clobTokenIds is a JSON array: [yesTokenId, noTokenId]
    //    Index 0 = YES token (bestAsk = YES buy price, bestBid used for NO buy price)
    const tokenIdToMarket = {}; // yesTokenId → array index
    allMarkets.forEach((m, i) => {
      let ids = m.clobTokenIds;
      if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
      if (Array.isArray(ids) && ids[0]) tokenIdToMarket[ids[0]] = i;
    });

    // 4. Batch-fetch CLOB books (10 concurrent, 50ms between batches)
    //    This replaces Gamma's ~5min cached bestAsk/bestBid with live orderbook data
    const clobData = {}; // yesTokenId → { bestAsk, bestBid }
    const allTokenIds = Object.keys(tokenIdToMarket);
    for (let i = 0; i < allTokenIds.length; i += 10) {
      const batch = allTokenIds.slice(i, i + 10);
      const results = await Promise.all(batch.map(async tid => {
        const book = await fetchClobBook(tid);
        return { tid, book };
      }));
      results.forEach(({ tid, book }) => { if (book) clobData[tid] = book; });
      if (i + 10 < allTokenIds.length) await sleep(50);
    }

    // 5. Enrich markets with real-time CLOB prices
    //    Falls back to Gamma cached prices if CLOB unavailable for a market
    const enriched = allMarkets.map(m => {
      let ids = m.clobTokenIds;
      if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch { ids = []; } }
      const yesTokenId = Array.isArray(ids) ? ids[0] : null;
      const clob = yesTokenId ? clobData[yesTokenId] : null;

      // CLOB real-time prices (preferred) → Gamma cached prices (fallback)
      const bestAsk = clob?.bestAsk ?? parseFloat(m.bestAsk || 0);
      const bestBid = clob?.bestBid ?? parseFloat(m.bestBid || 0);
      const clobLive = !!clob; // flag so index.html knows source quality

      const fallback = m.outcomePrices
        ? (Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices||'[]'))
        : [];

      // YES buy price: best ask + 1% fee, ceiling rounded
      const yesBase = bestAsk > 0.01 ? bestAsk : parseFloat(fallback[0]||0);
      // NO buy price: 1 − best bid (buying NO = selling YES at what buyers will pay)
      const noBase  = bestBid > 0.01 ? (1 - bestBid) : parseFloat(fallback[1]||0);

      const clobYesBuy = yesBase > 0.01 ? pmPrice(yesBase) : null;
      const clobNoBuy  = noBase  > 0.01 ? pmPrice(noBase)  : null;

      return {
        ...m,
        clobYesBuy,
        clobNoBuy,
        yesFullyFillable: true,
        clobLive,        // true = prices from live CLOB, false = Gamma cache
        clobYesTokenId: yesTokenId || null,
      };
    });

    const liveCount = enriched.filter(m => m.clobLive).length;

    return res.status(200).json({
      markets: enriched,
      total:   enriched.length,
      slugsChecked: slugs.length,
      clobLiveCount: liveCount,
      clobCachedCount: enriched.length - liveCount,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
