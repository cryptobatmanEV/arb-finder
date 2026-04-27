// Debug: Check tonight's games specifically for arb opportunities
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA  = 'https://gamma-api.polymarket.com';

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const KA_TO_PM = {
  POR:'por',SAS:'sas',ATL:'atl',NYK:'nyk',PHI:'phi',BOS:'bos',
  HOU:'hou',LAL:'lal',TOR:'tor',CLE:'cle',ORL:'orl',DET:'det',
  OKC:'okc',PHX:'phx',MIN:'min',DEN:'den',
};

const KALSHI_TEAMS = {
  'san antonio':'sas','spurs':'sas','portland':'por','trail blazers':'por',
  'atlanta':'atl','hawks':'atl','new york':'nyk','knicks':'nyk',
  'philadelphia':'phi','76ers':'phi','boston':'bos','celtics':'bos',
  'houston':'hou','rockets':'hou','los angeles l':'lal','lakers':'lal',
  'toronto':'tor','raptors':'tor','cleveland':'cle','cavaliers':'cle',
  'orlando':'orl','magic':'orl','detroit':'det','pistons':'det',
  'oklahoma city':'okc','thunder':'okc','phoenix':'phx','suns':'phx',
  'minnesota':'min','timberwolves':'min','denver':'den','nuggets':'den',
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
  return `nba-${away}-${home}-${year}-${mon}-${day}`;
}

function extractFavoredTeam(title) {
  const m = (title||'').match(/^(.+?)\s+wins by over/i);
  if (!m) return null;
  return KALSHI_TEAMS[m[1].trim().toLowerCase()] || null;
}

function extractPMTeam(question) {
  const m = (question||'').match(/Spread:\s+(.+?)\s+\(/i);
  if (!m) return null;
  return KALSHI_TEAMS[m[1].trim().toLowerCase()] || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const tonightGames = ['nba-por-sas-2026-04-28','nba-atl-nyk-2026-04-28','nba-phi-bos-2026-04-28'];
  const results = [];

  for (const gk of tonightGames) {
    // Get Kalshi spreads for this game
    const [away, home] = gk.split('-').slice(1,3);
    const kaCode = (Object.entries(KA_TO_PM).find(([k,v]) => v===away)||[])[0]?.toUpperCase() +
                   (Object.entries(KA_TO_PM).find(([k,v]) => v===home)||[])[0]?.toUpperCase();

    const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBASPREAD&limit=200`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const kaSpreads = (d.markets||[]).filter(m =>
      m.status==='active' && !m.mve_collection_ticker &&
      gameKeyFromTicker(m.ticker) === gk
    );

    // Get Polymarket spreads
    const pmRes = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const pmData = await pmRes.json();
    const event = Array.isArray(pmData) ? pmData[0] : pmData;
    const pmSpreads = (event?.markets||[]).filter(m =>
      /^Spread:/i.test(m.question||'') && !/1H/i.test(m.question||'')
    );

    // Cross match
    kaSpreads.forEach(ka => {
      const kaFav  = extractFavoredTeam(ka.title);
      const kaLineM = (ka.title||'').match(/over\s+([\d.]+)/i);
      const kaLine = kaLineM ? parseFloat(kaLineM[1]) : null;
      const kaYes  = parseFloat(ka.yes_ask_dollars||0);
      const kaNo   = parseFloat(ka.no_ask_dollars||0);

      pmSpreads.forEach(pm => {
        const pmFav  = extractPMTeam(pm.question);
        const pmLineM = (pm.question||'').match(/\(([-+]?[\d.]+)\)/);
        const pmLine = pmLineM ? Math.abs(parseFloat(pmLineM[1])) : null;
        const pmYes  = parseFloat(pm.bestAsk||0);
        const pmNo   = parseFloat(pm.bestBid||0) > 0 ? 1 - parseFloat(pm.bestBid) : 0;

        if (kaFav && pmFav && kaFav === pmFav && kaLine && pmLine && Math.abs(kaLine-pmLine)<=0.5) {
          const sumA = (pmYes * 1.01) + kaNo;   // PM YES + KA NO (with PM fee)
          const sumB = pmNo   + (kaYes);          // PM NO  + KA YES
          const best = Math.min(sumA, sumB);
          results.push({
            game: gk,
            ka: ka.title, pm: pm.question,
            ka_yes: kaYes, ka_no: kaNo,
            pm_yes_raw: pmYes, pm_yes_with_fee: parseFloat((pmYes*1.01).toFixed(3)),
            pm_no: parseFloat(pmNo.toFixed(3)),
            sumA: sumA.toFixed(3), sumB: sumB.toFixed(3),
            best: best.toFixed(3),
            margin: ((1-best)*100).toFixed(2)+'%',
            is_arb: best < 1.0,
          });
        }
      });
    });
  }

  results.sort((a,b) => parseFloat(a.best)-parseFloat(b.best));
  return res.status(200).json({
    total_pairs: results.length,
    real_arbs: results.filter(r=>r.is_arb),
    near_arbs: results.filter(r=>!r.is_arb && parseFloat(r.best)<1.02),
    all: results,
  });
}
