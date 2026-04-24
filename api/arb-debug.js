// Debug: Find Durant across ALL Kalshi prop series + check gameKey extraction
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
                JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
const KA_TO_PM = {
  LAL:'lal',HOU:'hou',DEN:'den',MIN:'min',DET:'det',ORL:'orl',
  OKC:'okc',PHX:'phx',ATL:'atl',BOS:'bos',MIA:'mia',MIL:'mil',
  SAS:'sas',POR:'por',NYK:'nyk',GSW:'gsw',IND:'ind',CLE:'cle',
  CHI:'chi',TOR:'tor',PHI:'phi',MEM:'mem',NOP:'nop',SAC:'sac',
  DAL:'dal',UTA:'uta',WAS:'was',LAC:'lac',BKN:'bkn',CHA:'cha',
};

function gameKeyFromTicker(ticker) {
  const parts = ticker.split('-');
  const middle = parts[1] || '';
  const dateM = middle.match(/^(\d{2})([A-Z]{3})(\d{2})/);
  if (!dateM) return `PARSE_FAILED:${ticker}`;
  const year = '20'+dateM[1], mon = MONTHS[dateM[2]]||'??', day = dateM[3].padStart(2,'0');
  const ts = middle.slice(dateM[0].length);
  const away = KA_TO_PM[ts.slice(0,3)] || `UNKNOWN:${ts.slice(0,3)}`;
  const home = KA_TO_PM[ts.slice(3,6)] || `UNKNOWN:${ts.slice(3,6)}`;
  return `nba-${away}-${home}-${year}-${mon}-${day}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const series = ['KXNBAPTS','KXNBAREB','KXNBAAST','KXNBA3PT'];
  const allDurant = [];

  for (const s of series) {
    const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=200`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    (d.markets||[])
      .filter(m => /durant/i.test(m.title||''))
      .forEach(m => {
        const gk = gameKeyFromTicker(m.ticker);
        allDurant.push({
          series: s,
          ticker: m.ticker,
          title: m.title,
          status: m.status,
          gameKey: gk,
          yes_ask: m.yes_ask_dollars,
          no_ask: m.no_ask_dollars,
          no_is_real: parseFloat(m.no_ask_dollars||0) > 0.05 &&
                      parseFloat(m.no_ask_dollars||0) < 0.95,
          yes_no_sum: (parseFloat(m.yes_ask_dollars||0) + parseFloat(m.no_ask_dollars||0)).toFixed(3),
        });
      });
  }

  return res.status(200).json({
    total_durant_found: allDurant.length,
    durant_markets: allDurant,
    no_is_real_count: allDurant.filter(m => m.no_is_real).length,
    no_is_fake_count: allDurant.filter(m => !m.no_is_real).length,
  });
}
