// Debug: Check CLOB orderbook depth for SAS-POR spread market
// Confirms we can calculate true fill price accounting for slippage
const CLOB  = 'https://clob.polymarket.com';
const GAMMA = 'https://gamma-api.polymarket.com';

function calcFillPrice(asks, dollarAmount) {
  // asks = [{price, size}, ...] sorted ascending by price
  // dollarAmount = how much you want to spend
  // Returns: { avgPrice, sharesFilledAt, totalCost, fullyFillable }
  let remaining = dollarAmount;
  let totalShares = 0;
  let totalCost   = 0;

  for (const level of asks) {
    if (remaining <= 0) break;
    const price      = parseFloat(level.price);
    const available  = parseFloat(level.size); // shares available at this price
    const costAtLevel = available * price;      // cost to buy all shares at this level

    if (costAtLevel <= remaining) {
      // Buy all shares at this level
      totalShares += available;
      totalCost   += costAtLevel;
      remaining   -= costAtLevel;
    } else {
      // Partially fill this level
      const sharesBought = remaining / price;
      totalShares += sharesBought;
      totalCost   += remaining;
      remaining    = 0;
    }
  }

  const avgPrice = totalShares > 0 ? totalCost / totalShares : null;
  return {
    avgPrice: avgPrice ? parseFloat(avgPrice.toFixed(4)) : null,
    sharesAcquired: parseFloat(totalShares.toFixed(2)),
    totalCost: parseFloat(totalCost.toFixed(2)),
    fullyFillable: remaining === 0,
    unfilled: parseFloat(remaining.toFixed(2)),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get SAS-POR spread token IDs from Gamma
  const gRes = await fetch(`${GAMMA}/events?slug=nba-sas-por-2026-04-24&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const gData = await gRes.json();
  const event  = Array.isArray(gData) ? gData[0] : gData;
  const spread = (event?.markets||[]).find(m => /spread/i.test(m.question||'') && /spurs/i.test(m.question||''));

  if (!spread) return res.status(200).json({ error: 'SAS spread market not found' });

  const tokenIds = Array.isArray(spread.clobTokenIds)
    ? spread.clobTokenIds
    : JSON.parse(spread.clobTokenIds || '[]');

  const yesTokenId = tokenIds[0]; // YES = Spurs covers

  // Fetch full orderbook for YES token
  const bookRes = await fetch(`${CLOB}/book?token_id=${yesTokenId}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const book = await bookRes.json();

  // Calculate fill prices for different stake sizes
  const asks = (book.asks || []).sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  const bids = (book.bids || []).sort((a, b) => parseFloat(b.price) - parseFloat(a.price));

  const stakeSizes = [10, 25, 50, 100, 250, 500];
  const fillAnalysis = stakeSizes.map(stake => ({
    stake: `$${stake}`,
    ...calcFillPrice(asks, stake),
  }));

  return res.status(200).json({
    market: spread.question,
    top_of_book_ask: asks[0]?.price || null,
    top_of_book_size: asks[0]?.size || null,
    total_ask_liquidity: asks.reduce((s, a) => s + parseFloat(a.size), 0).toFixed(2),
    total_bid_liquidity: bids.reduce((s, b) => s + parseFloat(b.size), 0).toFixed(2),
    ask_levels: asks.slice(0, 8).map(a => ({ price: a.price, size: a.size })),
    fill_analysis: fillAnalysis,
    conclusion: 'Use avgPrice from fill_analysis for the stake size to get true arb margin',
  });
}
