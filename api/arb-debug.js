// Debug: Check if Polymarket adds fees on top of orderbook price
const CLOB  = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const gRes = await fetch(`${GAMMA}/events?slug=nba-sas-por-2026-04-24&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const gData = await gRes.json();
  const event  = Array.isArray(gData) ? gData[0] : gData;
  const spread = (event?.markets||[]).find(m => /Spread.*Spurs/i.test(m.question||''));
  if (!spread) return res.status(200).json({ error: 'not found' });

  const ids = Array.isArray(spread.clobTokenIds)
    ? spread.clobTokenIds : JSON.parse(spread.clobTokenIds||'[]');

  const yesTokenId = ids[0];

  // Get orderbook
  const bookRes = await fetch(`${CLOB}/book?token_id=${yesTokenId}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const book = await bookRes.json();
  const asks = (book.asks||[]).sort((a,b) => parseFloat(a.price)-parseFloat(b.price));

  // Get spread endpoint
  const spreadRes = await fetch(`${CLOB}/spread?token_id=${yesTokenId}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const spreadData = await spreadRes.json();

  // Get midpoint
  const midRes = await fetch(`${CLOB}/midpoint?token_id=${yesTokenId}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const midData = await midRes.json();

  // Get market info for fee
  const mktRes = await fetch(`${CLOB}/markets/${spread.conditionId}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const mktData = mktRes.ok ? await mktRes.json() : null;

  return res.status(200).json({
    top_ask: asks[0]?.price,
    second_ask: asks[1]?.price,
    spread_endpoint: spreadData,
    midpoint: midData,
    market_fee_rate: mktData?.maker_base_fee || mktData?.taker_base_fee || mktData?.feeType || 'not found',
    gamma_feesEnabled: spread.feesEnabled,
    gamma_feeType: spread.feeType,
    note: 'Polymarket shows 53c avg but orderbook top is 52c — checking if fee is applied'
  });
}
