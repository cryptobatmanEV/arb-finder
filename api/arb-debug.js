// Debug: Get actual Novig order book for SEA-MIN right now
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Find SEA-MIN market on Novig
  const r = await fetch('https://api.novig.us/v1/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: `{
      market(
        where: {
          status: { _eq: "OPEN" }
          type: { _eq: "MONEY" }
          event: { description: { _ilike: "%mariners%twins%" } }
        }
        limit: 5
      ) {
        id type description status
        outcomes { id index description last }
        event { description league scheduled_start }
      }
    }` }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  const markets = d?.data?.market || [];

  // Get orderbook for each market found
  const results = [];
  for (const mkt of markets) {
    const bookRes = await fetch(
      `https://api.novig.us/nbx/v1/markets/book/batch?marketIds=${mkt.id}&currency=CASH`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    const book = await bookRes.json();
    const bookData = Array.isArray(book) ? book[0] : book;

    const outcomeDetails = mkt.outcomes.map(out => {
      const ladder = bookData?.ladders?.[out.id];
      const bestBid = ladder?.bids?.length
        ? Math.max(...ladder.bids.map(b => b.price))
        : null;
      const bestAsk = ladder?.asks?.length
        ? Math.min(...ladder.asks.map(a => a.price))
        : null;
      return {
        description: out.description,
        index: out.index,
        last: out.last,
        bestBid,
        bestAsk,
        // What our code computes as buy price
        computed_buy_price: bestBid !== null ? parseFloat((1 - bestBid).toFixed(4)) : null,
      };
    });

    results.push({
      market_id: mkt.id,
      description: mkt.description,
      event: mkt.event?.description,
      outcomes: outcomeDetails,
    });
  }

  return res.status(200).json({
    markets_found: markets.length,
    results,
    errors: d?.errors,
  });
}
