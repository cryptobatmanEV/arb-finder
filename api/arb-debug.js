// Debug: Check response headers and timestamp to confirm no caching
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const GAMMA = 'https://gamma-api.polymarket.com';

  // Fetch OKC vs PHX with timestamp to confirm live data
  const t = Date.now();
  const r = await fetch(`${GAMMA}/events?slug=nba-okc-phx-2026-04-25&_t=${t}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    signal: AbortSignal.timeout(8000)
  });

  const data = await r.json();
  const event = Array.isArray(data) ? data[0] : data;
  const moneyline = (event?.markets || []).find(m =>
    !m.question?.includes(':') && m.question?.includes('vs')
  );

  return res.status(200).json({
    fetched_at: new Date(t).toISOString(),
    response_headers: {
      'cache-control': r.headers.get('cache-control'),
      'cf-cache-status': r.headers.get('cf-cache-status'),
      'age': r.headers.get('age'),
    },
    moneyline: moneyline ? {
      question: moneyline.question,
      bestAsk: moneyline.bestAsk,
      bestBid: moneyline.bestBid,
      outcomePrices: moneyline.outcomePrices,
      lastTradePrice: moneyline.lastTradePrice,
      updatedAt: moneyline.updatedAt,
    } : null
  });
}
