// Debug: Raw dump of KXNBAAST series - no filtering at all
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBAAST&limit=100&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const markets = d.markets || [];

  return res.status(200).json({
    http_status: r.status,
    total_returned: markets.length,
    cursor: d.cursor,
    first_5: markets.slice(0, 5).map(m => ({
      ticker: m.ticker,
      title: m.title,
      status: m.status,
      market_type: m.market_type,
      yes_ask: m.yes_ask_dollars,
      yes_ask_size: m.yes_ask_size_fp,
      no_ask: m.no_ask_dollars,
      no_ask_size: m.no_ask_size_fp,
      mve: m.mve_collection_ticker || null,
    })),
    all_titles: markets.map(m => m.title),
  });
}
