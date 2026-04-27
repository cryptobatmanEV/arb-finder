// Debug: Test Polymarket CLOB endpoints for real-time prices
const CLOB = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get SEA-MIN token IDs from Gamma first
  const gmRes = await fetch(`${GAMMA}/events?slug=mlb-sea-min-2026-05-04&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const gmData = await gmRes.json();
  const event = Array.isArray(gmData) ? gmData[0] : gmData;
  const mlMarket = event?.markets?.find(m => !m.question?.includes('inning'));
  const tokenIds = Array.isArray(mlMarket?.clobTokenIds)
    ? mlMarket.clobTokenIds
    : JSON.parse(mlMarket?.clobTokenIds || '[]');

  const results = {
    gamma_bestAsk: mlMarket?.bestAsk,
    gamma_bestBid: mlMarket?.bestBid,
    gamma_question: mlMarket?.question,
    token_ids: tokenIds,
  };

  if (tokenIds.length >= 2) {
    // Try CLOB midpoint endpoint
    try {
      const r = await fetch(`${CLOB}/midpoints?token_id=${tokenIds[0]}&token_id=${tokenIds[1]}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000)
      });
      results['clob_midpoints'] = { status: r.status, data: r.ok ? await r.json() : null };
    } catch(e) { results['clob_midpoints'] = { error: e.message }; }

    // Try CLOB last trade price
    try {
      const r = await fetch(`${CLOB}/last-trade-price?token_id=${tokenIds[0]}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000)
      });
      results['clob_last_trade'] = { status: r.status, data: r.ok ? await r.json() : null };
    } catch(e) { results['clob_last_trade'] = { error: e.message }; }

    // Try CLOB book endpoint directly
    try {
      const r = await fetch(`${CLOB}/book?token_id=${tokenIds[0]}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000)
      });
      const d = r.ok ? await r.json() : null;
      results['clob_book'] = {
        status: r.status,
        best_ask: d?.asks?.[0]?.price,
        best_bid: d?.bids?.[0]?.price,
      };
    } catch(e) { results['clob_book'] = { error: e.message }; }

    // Try CLOB prices GET endpoint
    try {
      const r = await fetch(`${CLOB}/price?token_id=${tokenIds[0]}&side=BUY`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000)
      });
      results['clob_price_get'] = { status: r.status, data: r.ok ? await r.json() : null };
    } catch(e) { results['clob_price_get'] = { error: e.message }; }
  }

  return res.status(200).json(results);
}
