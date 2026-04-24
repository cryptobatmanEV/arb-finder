// Debug: Confirm CLOB real-time price vs Gamma cached price for OKC-PHX
const CLOB  = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Step 1: Get token IDs from Gamma
  const gRes = await fetch(`${GAMMA}/events?slug=nba-okc-phx-2026-04-25&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const gData = await gRes.json();
  const event = Array.isArray(gData) ? gData[0] : gData;
  const moneyline = (event?.markets||[]).find(m =>
    m.question?.includes('vs') && !m.question?.includes(':')
  );

  if (!moneyline) return res.status(200).json({ error: 'market not found' });

  const tokenIds = Array.isArray(moneyline.clobTokenIds)
    ? moneyline.clobTokenIds
    : JSON.parse(moneyline.clobTokenIds || '[]');

  const yesTokenId = tokenIds[0];
  const noTokenId  = tokenIds[1];

  // Step 2: Get real-time prices from CLOB
  const [yesBuyRes, noBuyRes] = await Promise.all([
    fetch(`${CLOB}/price?token_id=${yesTokenId}&side=BUY`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    }),
    fetch(`${CLOB}/price?token_id=${noTokenId}&side=BUY`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
    }),
  ]);

  const yesPrice = await yesBuyRes.json();
  const noPrice  = await noBuyRes.json();

  return res.status(200).json({
    market: moneyline.question,
    token_ids: { yes: yesTokenId, no: noTokenId },
    gamma_cached: {
      bestAsk: moneyline.bestAsk,
      bestBid: moneyline.bestBid,
      outcomePrices: moneyline.outcomePrices,
      cache_header: 'public, max-age=300 (5 min cache)',
    },
    clob_realtime: {
      yes_buy_price: yesPrice,
      no_buy_price: noPrice,
      cache_header: 'no cache — direct orderbook',
    },
    difference: {
      yes: Math.abs((moneyline.bestAsk||0) - parseFloat(yesPrice?.price||0)).toFixed(3),
      note: 'If difference > 0, CLOB is more accurate'
    }
  });
}
