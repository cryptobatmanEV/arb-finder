/**
 * Novig Sports Proxy — Market-first approach
 * Query markets directly instead of going through events
 * Auth: Bearer token (user JWT, ~30 day expiry)
 */

const GQL  = 'https://api.novig.us/v1/graphql';
const BOOK = 'https://api.novig.us/nbx/v1/markets/book/batch';

const LEAGUES = ['NBA','MLB','NFL','NHL'];
const GAME_TYPES = ['MONEY','SPREAD','TOTAL','MONEYLINE'];
const PROP_TYPES = ['POINTS','REBOUNDS','ASSISTS','THREE_POINTERS_MADE',
  'STEALS','BLOCKS','PITCHER_STRIKEOUTS','HITS','HOME_RUNS','SHOTS_ON_GOAL'];
const ALL_TYPES = [...GAME_TYPES, ...PROP_TYPES];

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
  if (!ladder?.bids?.length) return null;
  return Math.max(...ladder.bids.map(b => b.price));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOVIG_BEARER_TOKEN || '';
  if (!token) return res.status(500).json({ error: 'NOVIG_BEARER_TOKEN not set' });

  try {
    // Query markets directly — much more reliable than going through events
    const result = await gql(`{
      market(
        limit: 200
        where: {
          status: { _eq: "OPEN" }
          type: { _in: ${JSON.stringify(ALL_TYPES)} }
          event: {
            league: { _in: ${JSON.stringify(LEAGUES)} }
            status: { _in: ["OPEN_PREGAME"] }
            type: { _eq: "Game" }
          }
        }
        order_by: { updated_at: desc }
      ) {
        id type status strike description
        competitor { id name short_name }
        player { id name }
        outcomes {
          id index description last
        }
        event {
          id description league status scheduled_start
          game {
            id sport
            awayTeam { id name short_name }
            homeTeam { id name short_name }
            scheduled_start
          }
        }
      }
    }`, token);

    const markets = result?.data?.market || [];
    if (result?.errors?.length) {
      return res.status(500).json({ error: result.errors[0].message });
    }

    // Collect market IDs for batch orderbook
    const marketIds = [...new Set(markets.map(m => m.id))];

    // Fetch orderbooks in batches of 20
    const books = {};
    for (let i = 0; i < marketIds.length; i += 20) {
      const batch = marketIds.slice(i, i + 20);
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
      if (i + 20 < marketIds.length) await sleep(100);
    }

    // Enrich markets with live prices
    const enriched = markets.map(mkt => {
      const book = books[mkt.id];
      const enrichedOutcomes = (mkt.outcomes || []).map(out => {
        const ladder = book?.ladders?.[out.id];
        const liveBid = calcBestBid(ladder);
        return { ...out, liveBid, price: liveBid || out.last || null };
      });
      return { ...mkt, outcomes: enrichedOutcomes };
    });

    // Group by event for cleaner response
    const eventMap = {};
    enriched.forEach(mkt => {
      const eid = mkt.event?.id;
      if (!eid) return;
      if (!eventMap[eid]) {
        eventMap[eid] = { ...mkt.event, markets: [] };
      }
      eventMap[eid].markets.push(mkt);
    });

    const events = Object.values(eventMap);

    return res.status(200).json({
      events,
      total: events.length,
      markets: enriched.length,
      books_fetched: Object.keys(books).length,
    });

  } catch(err) {
    return res.status(500).json({ error: err.message, platform: 'novig' });
  }
}
