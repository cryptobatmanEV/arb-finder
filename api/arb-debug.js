// Debug: Check what MLB/NHL games exist on both platforms right now
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA  = 'https://gamma-api.polymarket.com';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

const KA_TO_PM = {
  // MLB
  ARI:'ari',ATH:'oak',BAL:'bal',BOS:'bos',CHC:'chc',CIN:'cin',COL:'col',
  CWS:'cws',DET:'det',HOU:'hou',KC:'kc',KCR:'kc',LAA:'laa',LAD:'lad',
  MIA:'mia',MIL:'mil',MIN:'min',NYM:'nym',NYY:'nyy',OAK:'oak',PHI:'phi',
  PIT:'pit',SDP:'sd',SEA:'sea',SFG:'sf',STL:'stl',TBR:'tb',TEX:'tex',
  TOR:'tor',WSH:'wsh',ATL:'atl',CLE:'cle',
  // NHL
  BOS:'bos',BUF:'buf',CAR:'car',CBJ:'cbj',CGY:'cgy',CHI:'chi',COL:'col',
  DAL:'dal',DET:'det',EDM:'edm',FLA:'fla',LAK:'lak',MIN:'min',MTL:'mtl',
  NJD:'njd',NSH:'nsh',NYI:'nyi',NYR:'nyr',OTT:'ott',PHI:'phi',PIT:'pit',
  SEA:'sea',SJS:'sjs',STL:'stl',TBL:'tbl',TOR:'tor',UTA:'uta',VAN:'van',
  VGK:'vgk',WPG:'wpg',WSH:'was',
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
  let sport = 'other';
  if (/KXMLB/.test(ticker)) sport = 'mlb';
  if (/KXNHL/.test(ticker)) sport = 'nhl';
  if (/KXNFL/.test(ticker)) sport = 'nfl';
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const series = ['KXMLBGAME','KXNHLGAME'];
  const results = {};

  for (const s of series) {
    const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=200`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const mkts = (d.markets||[]).filter(m =>
      !m.mve_collection_ticker && m.status==='active' && m.market_type==='binary'
    );

    // Get unique game keys
    const gameKeys = [...new Set(mkts.map(m => gameKeyFromTicker(m.ticker)).filter(Boolean))];

    // Test each on Polymarket
    const games = [];
    for (const gk of gameKeys.slice(0,10)) {
      const pmRes = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
      });
      const pmData = await pmRes.json();
      const event = Array.isArray(pmData) ? pmData[0] : pmData;
      games.push({
        kalshi_key: gk,
        pm_found: !!event?.id,
        pm_title: event?.title || null,
        pm_markets: event?.markets?.length || 0,
      });
    }

    results[s] = {
      total_kalshi_games: gameKeys.length,
      pm_matched: games.filter(g=>g.pm_found).length,
      games,
    };
  }

  return res.status(200).json(results);
}
