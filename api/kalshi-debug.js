// Debug — shows what the series-based Kalshi proxy actually returns
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  
  // Test one sports series and one non-sports
  const testSeries = ['KXNBA', 'KXMLB', 'KXBTC'];
  const results = {};
  
  for (const series of testSeries) {
    const params = new URLSearchParams({ series_ticker: series, limit: '5' });
    const r = await fetch(`${BASE}/markets?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    const markets = (data.markets || []);
    const binary = markets.filter(m => !m.mve_collection_ticker && m.market_type === 'binary');
    results[series] = {
      total: markets.length,
      binaryCount: binary.length,
      firstBinary: binary[0] ? {
        ticker: binary[0].ticker,
        title: binary[0].title,
        status: binary[0].status,
        expected_expiration_time: binary[0].expected_expiration_time,
        yes_ask_dollars: binary[0].yes_ask_dollars,
        no_ask_dollars: binary[0].no_ask_dollars,
        mve_collection_ticker: binary[0].mve_collection_ticker,
      } : null,
    };
  }
  
  return res.status(200).json(results);
}
