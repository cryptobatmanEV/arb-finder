/**
 * ARB DEBUG ENDPOINT
 * Visit /api/arb-debug to see EXACTLY what the matching engine extracts
 * and which pairs it creates. No guessing.
 */

const GAMMA  = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

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
  const parts  = ticker.split('-');
  const middle = parts[1] || '';
  const dateM  = middle.match(/^(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return null;
  const year = '20' + dateM[1];
  const mon  = MONTHS[dateM[2]] || '01';
  const day  = dateM[3].padStart(2,'0');
  const ts   = middle.slice(dateM[0].length);
  const away = KA_TO_PM[ts.slice(0,3)] || ts.slice(0,3).toLowerCase();
  const home = KA_TO_PM[ts.slice(3,6)] || ts.slice(3,6).toLowerCase();
  let sport = 'other';
  if (/KXNBA/.test(ticker)) sport='nba';
  else if (/KXMLB/.test(ticker)) sport='mlb';
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

function extractFavoredTeam(title, gameKey) {
  const t = title.toLowerCase();
  const parts = (gameKey||'').split('-');
  const dIdx  = parts.findIndex(p => /^20\d{2}$/.test(p));
  const teams = dIdx >= 2 ? parts.slice(1, dIdx) : [];

  // Polymarket: "Spread: Thunder (-9.5)" → match team name
  // Kalshi: "Oklahoma City wins by over 9.5" → match city name
  const PM_FULL = {
    okc:'thunder|oklahoma city', phx:'suns|phoenix', den:'nuggets|denver',
    min:'timberwolves|minnesota', det:'pistons|detroit', orl:'magic|orlando',
    nyk:'knicks|new york', atl:'hawks|atlanta', bos:'celtics|boston',
    mia:'heat|miami', mil:'bucks|milwaukee', sas:'spurs|san antonio',
    por:'blazers|trail blazers|portland', lal:'lakers|los angeles lakers',
    lac:'clippers|los angeles clippers', gsw:'warriors|golden state',
    hou:'rockets|houston', ind:'pacers|indiana', cle:'cavaliers|cleveland',
    chi:'bulls|chicago', tor:'raptors|toronto', phi:'sixers|76ers|philadelphia',
    mem:'grizzlies|memphis', nop:'pelicans|new orleans', okc:'thunder|oklahoma',
    sac:'kings|sacramento', dal:'mavericks|dallas', uta:'jazz|utah', was:'wizards|washington',
  };

  for (const abbr of teams) {
    const pattern = PM_FULL[abbr] || abbr;
    if (new RegExp(pattern).test(t)) return abbr;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // 1. Fetch sample Kalshi spread markets
  const kaRes  = await fetch(`${KALSHI}/markets?series_ticker=KXNBASPREAD&limit=20`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
  });
  const kaData = await kaRes.json();
  const kaMkts = (kaData.markets || [])
    .filter(m => !m.mve_collection_ticker && m.market_type==='binary' && m.status==='active')
    .slice(0, 10);

  // 2. Fetch Polymarket event for first game found
  const firstGameKey = kaMkts.length ? gameKeyFromTicker(kaMkts[0].ticker) : null;
  let pmMkts = [];
  if (firstGameKey) {
    const pmRes = await fetch(`${GAMMA}/events?slug=${firstGameKey}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    const pmData = await pmRes.json();
    const event  = Array.isArray(pmData) ? pmData[0] : pmData;
    pmMkts = (event?.markets || []).filter(m => !/\b1H\b/.test(m.question||''));
  }

  // 3. Show extracted structure for each market
  const kaExtracted = kaMkts.map(m => {
    const gk  = gameKeyFromTicker(m.ticker);
    const fav = extractFavoredTeam(m.title, gk);
    const lineM = (m.title||'').match(/over\s+([\d.]+)/i);
    return {
      ticker:      m.ticker,
      rawTitle:    m.title,
      gameKey:     gk,
      marketType:  'spread',
      line:        lineM ? parseFloat(lineM[1]) : null,
      favoredTeam: fav,
      yes_ask:     m.yes_ask_dollars,
      no_ask:      m.no_ask_dollars,
      sum:         (parseFloat(m.yes_ask_dollars)||0) + (parseFloat(m.no_ask_dollars)||0),
    };
  });

  const pmExtracted = pmMkts.map(m => {
    const spM  = (m.question||'').match(/Spread:\s+(.+?)\s+\([+-]?([\d.]+)\)/i);
    const fav  = spM ? spM[1].toLowerCase() : null;
    const line = spM ? parseFloat(spM[2]) : null;
    const pr   = Array.isArray(m.outcomePrices) ? m.outcomePrices : JSON.parse(m.outcomePrices||'[]');
    return {
      rawTitle:    m.question,
      gameKey:     firstGameKey,
      marketType:  spM ? 'spread' : 'other',
      line,
      favoredTeamRaw: fav,
      yesPrice:    parseFloat(pr[0]||0),
      noPrice:     parseFloat(pr[1]||0),
    };
  }).filter(m => m.marketType === 'spread');

  // 4. Show which pairs would match and why/why not
  const matchResults = [];
  kaExtracted.forEach(ka => {
    pmExtracted.forEach(pm => {
      const sameGame = ka.gameKey === pm.gameKey;
      const lineDiff = ka.line !== null && pm.line !== null ? Math.abs(ka.line - pm.line) : 'N/A';
      const sameTeam = ka.favoredTeam && pm.favoredTeamRaw && pm.favoredTeamRaw.includes(
        (ka.favoredTeam === 'okc' ? 'thunder' : ka.favoredTeam)
      );
      matchResults.push({
        ka_title:    ka.rawTitle,
        pm_title:    pm.rawTitle,
        sameGame,
        ka_line:     ka.line,
        pm_line:     pm.line,
        lineDiff,
        ka_fav:      ka.favoredTeam,
        pm_fav_raw:  pm.favoredTeamRaw,
        sameTeam,
        wouldMatch:  sameGame && lineDiff !== 'N/A' && lineDiff <= 0.5 && sameTeam,
        impliedSum:  sameTeam ? (pm.yesPrice + ka.noPrice).toFixed(3) + ' or ' + (pm.noPrice + ka.yesPrice).toFixed(3) : 'N/A',
      });
    });
  });

  return res.status(200).json({
    firstGameKey,
    kalshi_spreads: kaExtracted,
    polymarket_spreads: pmExtracted,
    match_analysis: matchResults.filter(r => r.sameGame),
  });
}
