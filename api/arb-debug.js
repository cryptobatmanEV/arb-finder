// Debug: Check Kevin Durant assists market on both platforms
const GAMMA  = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = {};

  // 1. Check Polymarket LAL vs HOU event for KD assists
  const pmRes = await fetch(`${GAMMA}/events?slug=nba-lal-hou-2026-04-24&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const pmData = await pmRes.json();
  const event = Array.isArray(pmData) ? pmData[0] : pmData;
  const kdMarkets = (event?.markets || []).filter(m => /kevin durant/i.test(m.question||''));

  results.polymarket_kd_markets = kdMarkets.map(m => ({
    question: m.question,
    outcomePrices: m.outcomePrices,
    bestAsk: m.bestAsk,
    bestBid: m.bestBid,
    active: m.active,
    acceptingOrders: m.acceptingOrders,
    liquidity: m.liquidity,
  }));

  // 2. Check Kalshi for KD assists markets
  const kaRes = await fetch(`${KALSHI}/markets?series_ticker=KXNBAAST&limit=100`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const kaData = await kaRes.json();
  const kdKalshi = (kaData.markets || []).filter(m =>
    /durant/i.test(m.title||'') && m.status === 'active'
  );

  results.kalshi_kd_assists = kdKalshi.map(m => ({
    ticker: m.ticker,
    title: m.title,
    status: m.status,
    yes_ask: m.yes_ask_dollars,
    yes_bid: m.yes_bid_dollars,
    no_ask: m.no_ask_dollars,
    no_bid: m.no_bid_dollars,
    yes_ask_size: m.yes_ask_size_fp,
    no_ask_size: m.no_ask_size_fp,
    can_buy_no: parseFloat(m.no_ask_dollars||0) > 0.01 && parseFloat(m.no_ask_dollars||0) < 0.99,
    note: parseFloat(m.no_ask_dollars||0) <= 0.01 ? 'NO SIDE NOT AVAILABLE - no sellers' :
          parseFloat(m.no_ask_dollars||0) >= 0.99 ? 'NO SIDE NOT AVAILABLE - fully priced' : 'NO available'
  }));

  results.diagnosis = {
    pm_kd_count: results.polymarket_kd_markets.length,
    ka_kd_count: results.kalshi_kd_assists.length,
    ka_with_no_available: results.kalshi_kd_assists.filter(m => m.can_buy_no).length,
    ka_without_no: results.kalshi_kd_assists.filter(m => !m.can_buy_no).map(m => m.title),
  };

  return res.status(200).json(results);
}
