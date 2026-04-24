/**
 * ARB DEBUG V2 — Tests specific known games for correct matching
 * Visit /api/arb-debug to see extraction and match analysis
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

// ALL known Kalshi team name variations → abbreviation
// This is the exact lookup that must be in index.html
const KALSHI_TEAM_NAMES = {
  'oklahoma city': 'okc', 'thunder': 'okc',
  'phoenix': 'phx', 'suns': 'phx',
  'denver': 'den', 'nuggets': 'den',
  'minnesota': 'min', 'timberwolves': 'min', 'wolves': 'min',
  'detroit': 'det', 'pistons': 'det',
  'orlando': 'orl', 'magic': 'orl',
  'new york': 'nyk', 'knicks': 'nyk',
  'atlanta': 'atl', 'hawks': 'atl',
  'boston': 'bos', 'celtics': 'bos',
  'miami': 'mia', 'heat': 'mia',
  'milwaukee': 'mil', 'bucks': 'mil',
  'san antonio': 'sas', 'spurs': 'sas',
  'portland': 'por', 'trail blazers': 'por', 'blazers': 'por',
  'los angeles l': 'lal', 'lakers': 'lal',   // KEY FIX
  'los angeles c': 'lac', 'clippers': 'lac',  // KEY FIX
  'golden state': 'gsw', 'warriors': 'gsw',
  'houston': 'hou', 'rockets': 'hou',
  'indiana': 'ind', 'pacers': 'ind',
  'cleveland': 'cle', 'cavaliers': 'cle',
  'chicago': 'chi', 'bulls': 'chi',
  'toronto': 'tor', 'raptors': 'tor',
  'philadelphia': 'phi', 'sixers': 'phi', '76ers': 'phi',
  'memphis': 'mem', 'grizzlies': 'mem',
  'new orleans': 'nop', 'pelicans': 'nop',
  'sacramento': 'sac', 'kings': 'sac',
  'dallas': 'dal', 'mavericks': 'dal', 'mavs': 'dal',
  'utah': 'uta', 'jazz': 'uta',
  'washington': 'was', 'wizards': 'was',
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
  if (/KXNBA/.test(ticker)) sport = 'nba';
  else if (/KXMLB/.test(ticker)) sport = 'mlb';
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

function extractKalshiFavoredTeam(title) {
  // "Oklahoma City wins by over 9.5 points?" → 'okc'
  // "Los Angeles L wins by over 7.5 points?" → 'lal'
  const t = title.toLowerCase();
  const m = t.match(/^(.+?)\s+wins by over/i);
  if (!m) return null;
  const teamStr = m[1].trim();
  return KALSHI_TEAM_NAMES[teamStr] || null;
}

function extractPMFavoredTeam(title) {
  // "Spread: Thunder (-9.5)" → 'okc'
  // "Spread: Rockets (-8.5)" → 'hou'
  const m = title.match(/Spread:\s+(.+?)\s+\(/i);
  if (!m) return null;
  const teamStr = m[1].trim().toLowerCase();
  return KALSHI_TEAM_NAMES[teamStr] || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch ALL Kalshi spread markets (limited)
  const kaRes  = await fetch(`${KALSHI}/markets?series_ticker=KXNBASPREAD&limit=100`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
  });
  const kaData = await kaRes.json();
  const kaMkts = (kaData.markets || [])
    .filter(m => !m.mve_collection_ticker && m.market_type === 'binary' && m.status === 'active');

  // Get unique game keys
  const gameKeys = [...new Set(kaMkts.map(m => gameKeyFromTicker(m.ticker)).filter(Boolean))];

  // For each game, fetch Polymarket and analyze
  const results = {};

  for (const gk of gameKeys.slice(0, 5)) {
    const pmRes  = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    const pmData = await pmRes.json();
    const event  = Array.isArray(pmData) ? pmData[0] : pmData;
    const pmAll  = (event?.markets || []).filter(m => !/\b1H\b/.test(m.question || ''));
    const pmSpreads = pmAll.filter(m => /Spread:/i.test(m.question || ''));

    const kaSpreads = kaMkts.filter(m => gameKeyFromTicker(m.ticker) === gk);

    // Cross-match analysis
    const matches = [];
    kaSpreads.forEach(ka => {
      const kaFav  = extractKalshiFavoredTeam(ka.title || '');
      const kaLine = parseFloat((ka.title || '').match(/over\s+([\d.]+)/i)?.[1] || 0);
      const kaSum  = (parseFloat(ka.yes_ask_dollars)||0) + (parseFloat(ka.no_ask_dollars)||0);

      pmSpreads.forEach(pm => {
        const pr    = Array.isArray(pm.outcomePrices) ? pm.outcomePrices : JSON.parse(pm.outcomePrices||'[]');
        const pmFav = extractPMFavoredTeam(pm.question || '');
        const pmLn  = parseFloat((pm.question||'').match(/\([+-]?([\d.]+)\)/)?.[1] || 0);
        const lineDiff = Math.abs(kaLine - pmLn);
        const sameTeam = kaFav && pmFav && kaFav === pmFav;
        const wouldMatch = sameTeam && lineDiff <= 0.5;

        if (wouldMatch || (sameTeam && lineDiff <= 2)) {
          const pmYes = parseFloat(pr[0]||0);
          const pmNo  = parseFloat(pr[1]||0);
          const kaYes = parseFloat(ka.yes_ask_dollars)||0;
          const kaNo  = parseFloat(ka.no_ask_dollars)||0;
          const sumA  = pmYes + kaNo;  // PM YES + KA NO
          const sumB  = pmNo  + kaYes; // PM NO  + KA YES
          matches.push({
            ka_title: ka.title,
            pm_title: pm.question,
            ka_fav: kaFav,
            pm_fav: pmFav,
            ka_line: kaLine,
            pm_line: pmLn,
            line_diff: lineDiff,
            same_team: sameTeam,
            would_match: wouldMatch,
            implied_sumA: sumA.toFixed(3) + ' (PM_YES+KA_NO)',
            implied_sumB: sumB.toFixed(3) + ' (PM_NO+KA_YES)',
            arb_if_match: wouldMatch ? (sumA < 1 ? `ARB ${((1-sumA)*100).toFixed(2)}%` : sumB < 1 ? `ARB ${((1-sumB)*100).toFixed(2)}%` : 'near-arb') : 'no match',
          });
        }
      });
    });

    results[gk] = {
      ka_spread_count: kaSpreads.length,
      pm_spread_count: pmSpreads.length,
      potential_pairs: matches,
    };
  }

  return res.status(200).json({
    note: 'wouldMatch=true means same team, line within ±0.5. Check implied sums.',
    results,
    team_name_fix_confirmed: {
      'Los Angeles L': extractKalshiFavoredTeam('Los Angeles L wins by over 7.5 points?'),
      'Oklahoma City': extractKalshiFavoredTeam('Oklahoma City wins by over 9.5 points?'),
      'Orlando':       extractKalshiFavoredTeam('Orlando wins by over 1.5 points?'),
      'Detroit':       extractKalshiFavoredTeam('Detroit wins by over 2.5 points?'),
    }
  });
}
