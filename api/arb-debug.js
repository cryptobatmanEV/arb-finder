// Debug: Show all Polymarket slugs vs all Kalshi gameKeys to find mismatches
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA  = 'https://gamma-api.polymarket.com';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const KA_TO_PM = {
  ATL:'atl',BOS:'bos',BKN:'bkn',CHA:'cha',CHI:'chi',CLE:'cle',DAL:'dal',
  DEN:'den',DET:'det',GSW:'gsw',HOU:'hou',IND:'ind',LAC:'lac',LAL:'lal',
  MEM:'mem',MIA:'mia',MIL:'mil',MIN:'min',NOP:'nop',NYK:'nyk',OKC:'okc',
  ORL:'orl',PHI:'phi',PHX:'phx',POR:'por',SAC:'sac',SAS:'sas',TOR:'tor',
  UTA:'uta',WAS:'was',
};

function gameKeyFromTicker(ticker) {
  const parts = ticker.split('-');
  const middle = parts[1] || '';
  const dateM = middle.match(/^(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const year = '20'+dateM[1], mon = MONTHS[dateM[2]]||'01', day = dateM[3].padStart(2,'0');
  const ts = middle.slice(dateM[0].length);
  const away = KA_TO_PM[ts.slice(0,3)] || ts.slice(0,3).toLowerCase();
  const home = KA_TO_PM[ts.slice(3,6)] || ts.slice(3,6).toLowerCase();
  let sport = 'nba';
  if (/KXMLB/.test(ticker)) sport = 'mlb';
  if (/KXNHL/.test(ticker)) sport = 'nhl';
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get all Kalshi game keys from GAME series
  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBAGAME&limit=200`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const kalshiKeys = [...new Set(
    (d.markets||[])
      .filter(m => !m.mve_collection_ticker && m.status==='active')
      .map(m => gameKeyFromTicker(m.ticker))
      .filter(Boolean)
  )];

  // Test each key against Polymarket
  const results = [];
  for (const gk of kalshiKeys) {
    const pmRes = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    const pmData = await pmRes.json();
    const event = Array.isArray(pmData) ? pmData[0] : pmData;
    results.push({
      kalshi_key: gk,
      polymarket_found: !!event?.id,
      pm_title: event?.title || null,
      pm_market_count: event?.markets?.length || 0,
    });
  }

  return res.status(200).json({
    total_kalshi_games: kalshiKeys.length,
    matched_on_polymarket: results.filter(r => r.polymarket_found).length,
    not_matched: results.filter(r => !r.polymarket_found).map(r => r.kalshi_key),
    matched: results.filter(r => r.polymarket_found),
  });
}
