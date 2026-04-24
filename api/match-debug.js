// Check Kalshi NBA/MLB futures vs Polymarket futures
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Kalshi season futures
  const futures = ['KXNBA','KXMLB','KXNFL','KXNHL','KXWNBA'];
  const kaMarkets = [];
  for (const s of futures) {
    const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${s}&limit=50`, {
      headers: { Accept: 'application/json' }
    });
    const d = await r.json();
    const active = (d.markets||[]).filter(m => !m.mve_collection_ticker && m.market_type==='binary' && m.status==='active');
    kaMarkets.push(...active.map(m => ({
      ticker: m.ticker, title: m.title,
      yes_ask: m.yes_ask_dollars, no_ask: m.no_ask_dollars,
      expiry: m.expected_expiration_time,
    })));
  }

  // Polymarket futures - get more
  const pmRes = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=500&_t='+Date.now());
  const pmData = await pmRes.json();
  const pmMarkets = (Array.isArray(pmData)?pmData:pmData.markets||[])
    .filter(m => {
      const t = (m.question||'').toLowerCase();
      return /nba finals|nba champion|mlb champion|world series|nfl champion|super bowl|nhl stanley|stanley cup|win the 2026/.test(t);
    })
    .map(m => ({
      question: m.question,
      endDateIso: m.endDateIso,
      prices: m.outcomePrices,
    }));

  return res.status(200).json({
    kalshi_futures: kaMarkets,
    polymarket_futures: pmMarkets,
    ka_count: kaMarkets.length,
    pm_count: pmMarkets.length,
  });
}
