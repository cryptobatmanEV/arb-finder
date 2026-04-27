// Debug: Check current Kalshi spread/total/game prices vs Polymarket for tonight's games
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA  = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  const KA_TO_PM = {
    LAL:'lal',HOU:'hou',MIN:'min',DEN:'den',OKC:'okc',PHX:'phx',
    NYK:'nyk',ATL:'atl',BOS:'bos',PHI:'phi',CLE:'cle',TOR:'tor',
  };

  function gameKey(ticker) {
    const m = ticker.split('-')[1]?.match(/^(\d{2})([A-Z]{3})(\d{2})([A-Z]{6})/);
    if (!m) return null;
    const away = KA_TO_PM[m[4].slice(0,3)] || m[4].slice(0,3).toLowerCase();
    const home = KA_TO_PM[m[4].slice(3,6)] || m[4].slice(3,6).toLowerCase();
    return `nba-${away}-${home}-20${m[1]}-${MONTHS[m[2]]}-${m[3].padStart(2,'0')}`;
  }

  // Get today's NBA spread markets
  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBASPREAD&limit=50`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const spreads = (d.markets||[]).filter(m =>
    m.status==='active' && !m.mve_collection_ticker &&
    parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0) <= 1.05
  );

  // For each unique game, fetch Polymarket
  const games = {};
  spreads.forEach(m => {
    const gk = gameKey(m.ticker);
    if (gk && !games[gk]) games[gk] = [];
    if (gk) games[gk].push(m);
  });

  const results = [];
  for (const [gk, kaMkts] of Object.entries(games).slice(0,5)) {
    const pmRes = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const pmData = await pmRes.json();
    const event = Array.isArray(pmData) ? pmData[0] : pmData;
    const pmSpreads = (event?.markets||[]).filter(m => /Spread/i.test(m.question||''));

    kaMkts.forEach(ka => {
      const kaYes = parseFloat(ka.yes_ask_dollars||0);
      const kaNo  = parseFloat(ka.no_ask_dollars||0);
      const titleM = (ka.title||'').match(/(.+?)\s+wins by over\s+([\d.]+)/i);
      const kaLine = titleM ? parseFloat(titleM[2]) : null;

      pmSpreads.forEach(pm => {
        const pr = Array.isArray(pm.outcomePrices) ? pm.outcomePrices : JSON.parse(pm.outcomePrices||'[]');
        const pmYes = parseFloat(pm.bestAsk||pr[0]||0);
        const pmNo  = 1 - parseFloat(pm.bestBid||0);
        const pmLineM = (pm.question||'').match(/\(([-\d.]+)\)/);
        const pmLine = pmLineM ? Math.abs(parseFloat(pmLineM[1])) : null;

        if (kaLine && pmLine && Math.abs(kaLine - pmLine) <= 0.5) {
          const sumA = pmYes + kaNo;
          const sumB = pmNo  + kaYes;
          results.push({
            game: gk,
            ka_title: ka.title,
            pm_title: pm.question,
            ka_yes: kaYes, ka_no: kaNo,
            pm_yes: pmYes, pm_no: pmNo.toFixed(3),
            sumA: sumA.toFixed(3), sumB: sumB.toFixed(3),
            best: Math.min(sumA,sumB).toFixed(3),
            margin: ((1-Math.min(sumA,sumB))*100).toFixed(2)+'%',
            is_arb: Math.min(sumA,sumB) < 1.0,
          });
        }
      });
    });
  }

  results.sort((a,b) => parseFloat(a.best)-parseFloat(b.best));
  return res.status(200).json({
    matched_pairs: results.length,
    best_opportunities: results.slice(0,10),
  });
}
