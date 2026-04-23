// Full pipeline debug — shows raw data at every step
// Visit /api/debug to see exactly what's happening

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const results = {};

  // Test Polymarket
  try {
    const r = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=5', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    const markets = Array.isArray(data) ? data : (data.data || data.markets || []);
    const first = markets[0];
    results.polymarket = {
      status: r.status,
      totalReturned: markets.length,
      firstMarketKeys: first ? Object.keys(first) : [],
      pricingFields: first ? {
        outcomePrices: first.outcomePrices,
        outcomes: first.outcomes,
        tokens: first.tokens ? first.tokens.slice(0,2) : undefined,
      } : null,
      firstTitle: first?.question || first?.title,
    };
  } catch(e) {
    results.polymarket = { error: e.message };
  }

  // Test Kalshi
  try {
    const r = await fetch('https://api.elections.kalshi.com/trade-api/v2/markets?limit=5', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();
    const markets = data.markets || [];
    const first = markets[0];
    const firstBinary = markets.find(m => !m.mve_collection_ticker);
    results.kalshi = {
      status: r.status,
      totalReturned: markets.length,
      hasCursor: !!data.cursor,
      firstMarketKeys: first ? Object.keys(first) : [],
      firstBinaryMarket: firstBinary ? {
        ticker: firstBinary.ticker,
        title: firstBinary.title,
        status: firstBinary.status,
        market_type: firstBinary.market_type,
        mve_collection_ticker: firstBinary.mve_collection_ticker,
        yes_ask_dollars: firstBinary.yes_ask_dollars,
        yes_bid_dollars: firstBinary.yes_bid_dollars,
        no_ask_dollars: firstBinary.no_ask_dollars,
        no_bid_dollars: firstBinary.no_bid_dollars,
      } : null,
    };
  } catch(e) {
    results.kalshi = { error: e.message };
  }

  // Test paginated Kalshi count
  try {
    let total = 0, binary = 0, cursor = '';
    for (let i = 0; i < 3; i++) {
      const params = new URLSearchParams({ limit: '200' });
      if (cursor) params.set('cursor', cursor);
      const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?${params}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000),
      });
      const data = await r.json();
      const markets = data.markets || [];
      total += markets.length;
      binary += markets.filter(m => !m.mve_collection_ticker && m.market_type === 'binary').length;
      cursor = data.cursor || '';
      if (!cursor || markets.length < 200) break;
    }
    results.kalshi.paginationTest = { totalAfter3Pages: total, binaryMarketsFound: binary };
  } catch(e) {
    results.kalshi.paginationError = e.message;
  }

  return res.status(200).json(results);
}
