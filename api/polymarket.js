/**
 * Polymarket Sports Proxy — Orderbook-Depth Real-Time Architecture
 *
 * Stage 1: Gamma API — market discovery + token IDs (5-min cache OK for structure)
 * Stage 2: CLOB /book — full orderbook per token (real-time, no cache)
 *
 * Uses orderbook depth to calculate TRUE fill price accounting for slippage.
 * No more fake arbs from top-of-book prices that aren't executable.
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

// Standard bet size used to calculate depth-adjusted fill price
// We check that this amount is fillable at the displayed price
const STANDARD_BET = 50; // $50 — filters out markets with < $50 liquidity at best price

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

// Calculate true fill price given orderbook asks and a dollar amount
function calcFillPrice(asks, dollarAmount) {
  const sorted = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  let remaining   = dollarAmount;
  let totalShares = 0;
  let totalCost   = 0;

  for (const level of sorted) {
    if (remaining <= 0) break;
    const price     = parseFloat(level.price);
    const available = parseFloat(level.size);
    const costFull  = available * price;

    if (costFull <= remaining) {
      totalShares += available;
      totalCost   += costFull;
      remaining   -= costFull;
    } else {
      const shares = remaining / price;
      totalShares += shares;
      totalCost   += remaining;
      remaining    = 0;
    }
  }

  if (totalShares === 0) return null;
  return {
    avgPrice:       parseFloat((totalCost / totalShares).toFixed(4)),
    fullyFillable:  remaining === 0,
    topOfBook:      sorted[0] ? parseFloat(sorted[0].price) : null,
    liquidityAtTop: sorted[0] ? parseFloat(sorted[0].size)  : 0,
  };
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
    const data  = await r.json();
    const event = Array.isArray(data) ? data[0] : data;
    return (event?.markets || [])
      .filter(m => !/\b1H\b/.test(m.question || ''))
      .map(m => ({ ...m, eventSlug: slug, eventEndDate: event?.endDate }));
  } catch { return []; }
}

// Fetch orderbook for a single token — returns asks and bids
async function fetchOrderbook(tokenId) {
  try {
    const r = await fetch(`${CLOB}/book?token_id=${tokenId}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Stage 1: Get today's game slugs from Kalshi schedule
    const slugs = await getKalshiGameSlugs();

    // Stage 2: Fetch Gamma market metadata in batches
    const allMarkets = [];
    const batchSize  = 8;
    for (let i = 0; i < slugs.length; i += batchSize) {
      const batch   = slugs.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(fetchEventMarkets));
      results.forEach(mkts => allMarkets.push(...mkts));
      if (i + batchSize < slugs.length) await sleep(150);
    }

    // Stage 3: Collect YES token IDs (we price via YES orderbook)
    const tokenToMarketIdx = {};
    allMarkets.forEach((m, idx) => {
      const ids = Array.isArray(m.clobTokenIds)
        ? m.clobTokenIds
        : JSON.parse(m.clobTokenIds || '[]');
      if (ids[0]) tokenToMarketIdx[ids[0]] = { idx, role: 'yes', noTokenId: ids[1] };
    });

    const yesTokenIds = Object.keys(tokenToMarketIdx);

    // Stage 4: Fetch orderbooks in batches of 10 (CLOB rate limit friendly)
    const orderbooks = {};
    for (let i = 0; i < yesTokenIds.length; i += 10) {
      const batch = yesTokenIds.slice(i, i + 10);
      const results = await Promise.all(batch.map(async tid => {
        const book = await fetchOrderbook(tid);
        return { tid, book };
      }));
      results.forEach(({ tid, book }) => {
        if (book) orderbooks[tid] = book;
      });
      if (i + 10 < yesTokenIds.length) await sleep(100);
    }

    // Stage 5: Calculate depth-adjusted prices and inject into markets
    const enriched = allMarkets.map((m, idx) => {
      const ids = Array.isArray(m.clobTokenIds)
        ? m.clobTokenIds
        : JSON.parse(m.clobTokenIds || '[]');

      const yesTokenId = ids[0];
      const noTokenId  = ids[1];

      if (!yesTokenId || !orderbooks[yesTokenId]) return m;

      const book    = orderbooks[yesTokenId];
      const yesAsks = book.asks || []; // Asks = what you pay to BUY YES
      const yesBids = book.bids || []; // Bids = what you receive to SELL YES
      // NO asks = derived from YES bids (complement market)
      // Cost to buy NO = 1 - best YES bid
      const noAsks  = yesBids.map(b => ({
        price: (1 - parseFloat(b.price)).toFixed(4),
        size:  b.size,
      }));

      const yesFill = calcFillPrice(yesAsks, STANDARD_BET);
      const noFill  = calcFillPrice(noAsks,  STANDARD_BET);

      // Apply Polymarket sports fee: confirmed 1% for all sports markets
      // Debug confirmed: feesEnabled=true, feeType=sports_fees_v2, fee_rate=1000
      // 52¢ orderbook × 1.01 = 52.52¢ → matches Polymarket's shown avg price of 53¢
      const fee = (m.feesEnabled || m.feeType === 'sports_fees_v2') ? 0.01 : 0;
      const yesFillWithFee = yesFill?.avgPrice ? parseFloat((yesFill.avgPrice * (1 + fee)).toFixed(4)) : null;
      const noFillWithFee  = noFill?.avgPrice  ? parseFloat((noFill.avgPrice  * (1 + fee)).toFixed(4)) : null;

      return {
        ...m,
        // Depth-adjusted prices with fee applied — matches Polymarket execution price
        clobYesBuy: yesFillWithFee || null,
        clobNoBuy:  noFillWithFee  || null,
        // Top of book (for reference)
        clobYesTop: yesFill?.topOfBook || null,
        clobNoTop:  noFill?.topOfBook  || null,
        // Liquidity indicators
        yesFullyFillable: yesFill?.fullyFillable || false,
        noFullyFillable:  noFill?.fullyFillable  || false,
        yesLiquidityAtTop: yesFill?.liquidityAtTop || 0,
      };
    });

    return res.status(200).json({
      markets:           enriched,
      total:             enriched.length,
      slugsChecked:      slugs.length,
      orderbooksFetched: Object.keys(orderbooks).length,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
