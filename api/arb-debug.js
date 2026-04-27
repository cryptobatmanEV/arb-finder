// Debug: Find actual live MLB Polymarket events and show all their market types
const GAMMA  = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const KA_TO_PM = {
  SF:'sf',WSH:'wsh',NYM:'nym',BAL:'bal',NYY:'nyy',TB:'tb',
  LAD:'lad',SD:'sd',COL:'col',ARI:'ari',STL:'stl',CHC:'chc',
  OAK:'oak',SEA:'sea',LAA:'laa',TEX:'tex',KC:'kc',CWS:'cws',
  BOS:'bos',ATL:'atl',MIA:'mia',MIL:'mil',MIN:'min',CIN:'cin',
  PIT:'pit',DET:'det',CLE:'cle',HOU:'hou',PHI:'phi',TOR:'tor',
};

function gameKeyFromTicker(ticker) {
  const middle = ticker.split('-')[1] || '';
  const dateM = middle.match(/(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const year = '20'+dateM[1], mon = MONTHS[dateM[2]]||'01', day = dateM[3].padStart(2,'0');
  const rest = middle.slice(dateM.index + dateM[0].length).replace(/^\d+/, '');
  let away = null, home = null;
  for (const aLen of [2, 3]) {
    const aC = rest.slice(0, aLen), hC = rest.slice(aLen);
    if (hC.length >= 2 && KA_TO_PM[aC] && KA_TO_PM[hC]) {
      away = KA_TO_PM[aC]; home = KA_TO_PM[hC]; break;
    }
  }
  if (!away) away = rest.slice(0,3).toLowerCase();
  if (!home) home = rest.slice(3,6).toLowerCase();
  return `mlb-${away}-${home}-${year}-${mon}-${day}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get Kalshi MLB games
  const r = await fetch(`${KALSHI}/markets?series_ticker=KXMLBGAME&limit=20`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const keys = [...new Set(
    (d.markets||[])
      .filter(m => !m.mve_collection_ticker && m.status==='active')
      .map(m => gameKeyFromTicker(m.ticker))
      .filter(Boolean)
  )].slice(0, 5);

  // For each game key, fetch Polymarket and show ALL market questions
  const results = [];
  for (const gk of keys) {
    const pmRes = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const pmData = await pmRes.json();
    const event = Array.isArray(pmData) ? pmData[0] : pmData;
    results.push({
      gameKey: gk,
      found: !!event?.id,
      title: event?.title,
      questions: event?.markets?.map(m => m.question) || [],
    });
  }

  return res.status(200).json({ games: results });
}
