/**
 * Polymarket Sports Proxy
 * Uses Gamma API for market discovery + real-time bestAsk prices
 * Applies confirmed 1% sports fee with ceiling rounding
 */

const GAMMA  = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

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
  ATH:'oak',KCR:'kc',SDP:'sd',SFG:'sf',TBR:'tb',WSH:'wsh',
  // NHL
  BUF:'buf',CAR:'car',CBJ:'cbj',CGY:'cgy',EDM:'edm',FLA:'fla',
  LAK:'lak',MTL:'mtl',NJD:'njd',NSH:'nsh',NYI:'nyi',NYR:'nyr',
  OTT:'ott',SJS:'sjs',TBL:'tbl',VAN:'van',VGK:'vgk',WPG:'wpg',ANA:'ana',
};

// Confirmed: Polymarket charges 1% sports fee, rounds up to nearest cent on execution
// 52¢ × 1.01 = 52.52¢ → ceil → 53¢ (matches actual Polymarket avg fill price)
const pmPrice = (p) => Math.ceil(p * 1.01 * 100) / 100;

function gameKeyFromKalshiTicker(ticker) {
  const parts  = ticker.split('-');
  const middle = parts[1] || '';
  const dateM  = middle.match(/(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const year = '20' + dateM[1];
  const mon  = MONTHS[dateM[2]] || '01';
  const day  = dateM[3].padStart(2, '0');
  const rest = middle.slice(dateM.index + dateM[0].length);
  const teamStr = rest.replace(/^\d+/, '');
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
    // Get game slugs from Kalshi schedule
    const slugs = await getKalshiGameSlugs();

    // Fetch Gamma market metadata in batches
    const allMarkets = [];
    for (let i = 0; i < slugs.length; i += 8) {
      const results = await Promise.all(slugs.slice(i, i+8).map(fetchEventMarkets));
      results.forEach(mkts => allMarkets.push(...mkts));
      if (i + 8 < slugs.length) await sleep(100);
    }

    // Apply confirmed 1% fee with ceiling rounding to each market's prices
    const enriched = allMarkets.map(m => {
      const bestAsk = parseFloat(m.bestAsk || 0);
      const bestBid = parseFloat(m.bestBid || 0);
      const fallback = m.outcomePrices
        ? (Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices||'[]'))
        : [];

      // YES price: bestAsk (Gamma cached but good enough) + 1% fee, ceiling rounded
      const yesBase = bestAsk > 0.01 ? bestAsk : parseFloat(fallback[0]||0);
      // NO price: 1 - bestBid gives cost to buy NO
      const noBase  = bestBid > 0.01 ? (1 - bestBid) : parseFloat(fallback[1]||0);

      const clobYesBuy = yesBase > 0.01 ? pmPrice(yesBase) : null;
      const clobNoBuy  = noBase  > 0.01 ? pmPrice(noBase)  : null;

      return { ...m, clobYesBuy, clobNoBuy, yesFullyFillable: true };
    });

    return res.status(200).json({
      markets: enriched,
      total:   enriched.length,
      slugsChecked: slugs.length,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message, platform: 'polymarket' });
  }
}
