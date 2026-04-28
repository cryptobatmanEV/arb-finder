// Debug: Check floor_strike for NBA spreads and MLB totals
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const series = ['KXNBASPREAD', 'KXNBATOTAL', 'KXMLBTOTAL', 'KXNHLTOTAL'];
  const results = {};

  for (const s of series) {
    const r = await fetch(`${KALSHI}/markets?series_ticker=${s}&limit=5`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    const mkts = (d.markets||[])
      .filter(m => m.status==='active' && !m.mve_collection_ticker)
      .slice(0,3);

    results[s] = mkts.map(m => ({
      ticker: m.ticker,
      title: m.title,
      floor_strike: m.floor_strike,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
      // Current line extraction (wrong)
      ticker_suffix: m.ticker.split('-').pop(),
      title_over: (m.title.match(/over\s+([\d.]+)/i)||[])[1] || null,
    }));
  }

  return res.status(200).json(results);
}
