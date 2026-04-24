// Diagnostic — shows what structured data is extracted from both platforms
// Visit /api/match-debug to see extraction results
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch a sample of Polymarket markets
  const pmRes = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=500&_t=' + Date.now(), {
    headers: { Accept: 'application/json' }
  });
  const pmData = await pmRes.json();
  const pmMarkets = Array.isArray(pmData) ? pmData : (pmData.markets || []);

  // Fetch a sample of Kalshi NBA game markets
  const kaRes = await fetch('https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXNBAGAME&limit=20', {
    headers: { Accept: 'application/json' }
  });
  const kaData = await kaRes.json();
  const kaMarkets = (kaData.markets || []).filter(m => !m.mve_collection_ticker && m.market_type === 'binary' && m.status === 'active');

  // Show first 10 Polymarket sports markets with their extracted fields
  const pmSports = pmMarkets
    .filter(m => {
      const t = (m.question || '').toLowerCase();
      return /knick|laker|celtic|heat|hawk|bull|nets|nugget|thunder|clipper|warrior|cavalier|piston|magic|bucks|pacer|suns|grizzl|pelican|rocket|maverick|king|spur|jazz|blazer|timberwolv|hornet|wizard|raptor|76er|sixers|nba|basketball|mlb|yankee|dodger|red sox|astro|brave|padre|cubby|cubs|giant|ranger|mariner|brewer|twins|tiger|guardian|royal|oriole|rays|blue jay|national|marlin|rockie|diamondback|pirate|reds/.test(t);
    })
    .slice(0, 15)
    .map(m => ({
      question: m.question,
      endDateIso: m.endDateIso,
      endDate: m.endDate,
      outcomePrices: m.outcomePrices,
    }));

  // Show Kalshi markets with their ticker breakdown
  const kaSample = kaMarkets.slice(0, 10).map(m => ({
    ticker: m.ticker,
    title: m.title,
    expected_expiration_time: m.expected_expiration_time,
    yes_ask_dollars: m.yes_ask_dollars,
    no_ask_dollars: m.no_ask_dollars,
    status: m.status,
  }));

  return res.status(200).json({
    polymarket_sports_sample: pmSports,
    kalshi_nba_sample: kaSample,
    pm_total_fetched: pmMarkets.length,
    ka_total_fetched: kaMarkets.length,
  });
}
