/**
 * Novig Sports Proxy
 * Uses GraphQL to fetch markets + batch orderbook for real-time prices
 * Auth: Bearer token (user JWT, ~30 day expiry)
 */

const GQL  = 'https://api.novig.us/v1/graphql';
const BOOK = 'https://api.novig.us/nbx/v1/markets/book/batch';

const LEAGUES = ['NBA','MLB','NFL','NHL'];
const MARKET_TYPES = ['MONEY','SPREAD','TOTAL','MONEYLINE',
  'POINTS','REBOUNDS','ASSISTS','THREE_POINTERS_MADE','STEALS','BLOCKS',
  'PITCHER_STRIKEOUTS','HITS','HOME_RUNS'];

async function gql(query, token) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10000),
  });
  return r.json();
}

function calcBestBid(ladder) {
  // Best bid = highest price someone is willing to pay
  if (!ladder?.bids?.length) return null;
  return Math.max(...ladder.bids.map(b => b.price));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOVIG_BEARER_TOKEN || '';
  if (!token) return res.status(500).json({ error: 'NOVIG_BEARER_TOKEN not set' });

  try {
    // Stage 1: Fetch all open NBA/MLB/NHL/NFL events + markets via GraphQL
    const result = await gql(`{
      event(
        where: {
          league: { _in: ${JSON.stringify(LEAGUES)} }
          status: { _in: ["OPEN_PREGAME", "OPEN_INGAME"] }
          type: { _eq: "Game" }
        }
        limit: 50
      ) {
        id
        description
        league
        status
        scheduled_start
        game {
          id
          sport
          awayTeam { id name short_name }
          homeTeam { id name short_name }
          scheduled_start
          spreadStrike
          totalStrike
          moneyAway
          moneyHome
        }
        markets(where: { status: { _in: ["OPEN", "OPEN_PREGAME"] } }) {
          id
          type
          status
          strike
          description
          competitor { id name short_name }
          player { id name }
          outcomes {
            id
            index
            description
            last
          }
        }
      }
    }`, token);

    const events = result?.data?.event || [];
    if (result?.errors?.length) {
      return res.status(500).json({ error: result.errors[0].message });
    }

    // Stage 2: Collect all outcome IDs for batch orderbook fetch
    const allOutcomeIds = [];
    const outcomeToMarket = {}; // outcomeId → { eventIdx, marketIdx, outcomeIdx }

    events.forEach((evt, ei) => {
      (evt.markets || []).forEach((mkt, mi) => {
        (mkt.outcomes || []).forEach((out, oi) => {
          allOutcomeIds.push(out.id);
          outcomeToMarket[out.id] = { ei, mi, oi };
        });
      });
    });

    // Collect market IDs for batch book fetch
    const allMarketIds = [];
    events.forEach(evt => {
      (evt.markets || []).forEach(mkt => {
        if (!allMarketIds.includes(mkt.id)) allMarketIds.push(mkt.id);
      });
    });

    // Stage 3: Fetch orderbooks in batches of 20
    const books = {}; // marketId → book data
    const batchSize = 20;
    for (let i = 0; i < allMarketIds.length; i += batchSize) {
      const batch = allMarketIds.slice(i, i + batchSize);
      try {
        const r = await fetch(
          `${BOOK}?marketIds=${batch.join(',')}&currency=CASH`,
          {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(8000),
          }
        );
        const data = await r.json();
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item?.market?.id) books[item.market.id] = item;
          });
        }
      } catch {}
      if (i + batchSize < allMarketIds.length) await new Promise(r => setTimeout(r, 100));
    }

    // Stage 4: Enrich markets with live prices from orderbook
    const enrichedEvents = events.map(evt => ({
      ...evt,
      markets: (evt.markets || []).map(mkt => {
        const book = books[mkt.id];
        const enrichedOutcomes = (mkt.outcomes || []).map(out => {
          const ladder = book?.ladders?.[out.id];
          const bestBid = calcBestBid(ladder);
          // On Novig exchange: best bid = what buyers pay = price for this outcome
          return {
            ...out,
            liveBid: bestBid,
            // If no orderbook, fall back to last traded price
            price: bestBid || out.last || null,
          };
        });
        return { ...mkt, outcomes: enrichedOutcomes };
      }),
    }));

    return res.status(200).json({
      events: enrichedEvents,
      total: enrichedEvents.length,
      markets: enrichedEvents.reduce((s, e) => s + (e.markets?.length || 0), 0),
      books_fetched: Object.keys(books).length,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message, platform: 'novig' });
  }
}
