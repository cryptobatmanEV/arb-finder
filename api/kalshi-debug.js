// Debug — tests the actual daily game series tickers
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
  const testSeries = ['KXNBAGAME','KXNBASPREAD','KXNBATOTAL','KXMLBGAME','KXMLBTOTAL','KXNFLGAME'];
  const results = {};
  
  for (const series of testSeries) {
    try {
      const params = new URLSearchParams({ series_ticker: series, limit: '5' });
      const r = await fetch(`${BASE}/markets?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const data = await r.json();
      const markets = (data.markets || []);
      const binary = markets.filter(m => !m.mve_collection_ticker && m.market_type === 'binary' && m.status === 'active');
      results[series] = {
        httpStatus: r.status,
        total: markets.length,
        activeAndBinary: binary.length,
        firstMarket: binary[0] ? {
          ticker: binary[0].ticker,
          title: binary[0].title,
          expected_expiration_time: binary[0].expected_expiration_time,
          yes_ask_dollars: binary[0].yes_ask_dollars,
          no_ask_dollars: binary[0].no_ask_dollars,
        } : null,
      };
    } catch(e) {
      results[series] = { error: e.message };
    }
  }
  
  return res.status(200).json(results);
}
