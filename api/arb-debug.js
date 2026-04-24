// Debug V3: Moneyline matching validation
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
  // NHL
  DAL:'dal',MIN:'min',BOS:'bos',TOR:'tor',FLA:'fla',TBL:'tbl',
  NYR:'nyr',WSH:'was',COL:'col',WPG:'wpg',VGK:'vgk',EDM:'edm',
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
  if (/KXNBA/.test(ticker)) sport='nba';
  else if (/KXMLB/.test(ticker)) sport='mlb';
  else if (/KXNHL/.test(ticker)) sport='nhl';
  return `${sport}-${away}-${home}-${year}-${mon}-${day}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch NHL and NBA game markets from Kalshi
  const series = ['KXNHlgame','KXNBAGAME'];
  const kaMkts = [];
  for (const s of series) {
    const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=30`, {
      headers:{Accept:'application/json'}, signal:AbortSignal.timeout(8000)
    });
    const d = await r.json();
    kaMkts.push(...(d.markets||[]).filter(m=>!m.mve_collection_ticker&&m.market_type==='binary'&&m.status==='active'));
  }

  // Get unique game keys
  const gameKeys = [...new Set(kaMkts.map(m=>gameKeyFromTicker(m.ticker)).filter(Boolean))];

  const results = [];
  for (const gk of gameKeys.slice(0,8)) {
    // Fetch Polymarket event
    const pmRes = await fetch(`${GAMMA}/events?slug=${gk}&_t=${Date.now()}`, {
      headers:{Accept:'application/json'}, signal:AbortSignal.timeout(8000)
    });
    const pmData = await pmRes.json();
    const event = Array.isArray(pmData) ? pmData[0] : pmData;
    // Only get simple moneyline markets (no ":" qualifier, no "1H")
    const pmMoneylines = (event?.markets||[]).filter(m => {
      const q = m.question||'';
      return !q.includes(':') && !q.includes('1H') && q.includes('vs');
    });

    // Get Kalshi game markets for this game key
    const kaMono = kaMkts.filter(m => gameKeyFromTicker(m.ticker)===gk);

    // For each PM moneyline, show its prices and corresponding Kalshi prices
    for (const pm of pmMoneylines) {
      const pr = Array.isArray(pm.outcomePrices) ? pm.outcomePrices : JSON.parse(pm.outcomePrices||'[]');
      const pmYes = parseFloat(pr[0]||0);
      const pmNo  = parseFloat(pr[1]||0);

      // Find Kalshi team-A and team-B markets for this game
      for (const ka of kaMono) {
        const kaYes = parseFloat(ka.yes_ask_dollars)||0;
        const kaNo  = parseFloat(ka.no_ask_dollars)||0;
        const sumA  = pmYes + kaNo;  // PM YES (team A wins) + KA NO (team A loses)
        const sumB  = pmNo  + kaYes; // PM NO  (team A loses) + KA YES (team A wins)
        results.push({
          gameKey: gk,
          pm_question: pm.question,
          pm_yes: pmYes, pm_no: pmNo,
          ka_title: ka.title,
          ka_yes: kaYes, ka_no: kaNo,
          ka_yes_no_sum: (kaYes+kaNo).toFixed(3),
          sumA_pmYes_kaNO: sumA.toFixed(3),
          sumB_pmNo_kaYES: sumB.toFixed(3),
          best_sum: Math.min(sumA,sumB).toFixed(3),
          is_arb: Math.min(sumA,sumB) < 1.0,
          margin: Math.min(sumA,sumB) < 1.0 ? ((1-Math.min(sumA,sumB))*100).toFixed(2)+'%' : 'none',
          note: sumA < 0.92 || sumB < 0.92 ? 'WARNING: Sum<0.92 suggests wrong match or stale price' : 'ok',
        });
      }
    }
  }

  // Sort by best_sum ascending (best arbs first)
  results.sort((a,b) => parseFloat(a.best_sum)-parseFloat(b.best_sum));

  return res.status(200).json({
    total_pairs_checked: results.length,
    real_arbs: results.filter(r=>r.is_arb),
    near_arbs: results.filter(r=>!r.is_arb && parseFloat(r.best_sum)<1.02),
    suspicious: results.filter(r=>r.note!=='ok'),
  });
}
