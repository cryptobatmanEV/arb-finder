// Debug: Check Novig STL-PIT market outcome descriptions and bids
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const r = await fetch('https://api.novig.us/v1/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: `{
      market(
        where: {
          status: { _eq: "OPEN" }
          type: { _eq: "MONEY" }
          is_consensus: { _eq: true }
          event: { description: { _ilike: "%cardinals%pirates%" } }
        }
        limit: 3
      ) {
        id type description is_consensus
        outcomes { id index description last }
        event {
          description league
          game {
            awayTeam { name short_name }
            homeTeam { name short_name }
            scheduled_start
          }
        }
      }
    }` }),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  const markets = d?.data?.market || [];

  // Also get orderbook for first market
  const books = [];
  for (const mkt of markets) {
    const bookRes = await fetch(
      `https://api.novig.us/nbx/v1/markets/book/batch?marketIds=${mkt.id}&currency=CASH`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    const book = await bookRes.json();
    const b = Array.isArray(book) ? book[0] : book;
    books.push({
      market_desc: mkt.description,
      event: mkt.event?.description,
      away: mkt.event?.game?.awayTeam?.short_name,
      home: mkt.event?.game?.homeTeam?.short_name,
      outcomes: mkt.outcomes.map(o => {
        const ladder = b?.ladders?.[o.id];
        const bestBid = ladder?.bids?.length
          ? Math.max(...ladder.bids.map(b => b.price))
          : null;
        return {
          index: o.index,
          description: o.description,
          last: o.last,
          bestBid,
          computed_buy_price: bestBid ? parseFloat((1 - bestBid).toFixed(3)) : null,
        };
      }),
    });
  }

  return res.status(200).json({ books, errors: d?.errors });
}
