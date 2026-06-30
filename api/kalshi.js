// Kalshi daily game markets — batched to avoid 429 rate limiting
const BASE = 'https://api.elections.kalshi.com/trade-api/v2';

const SERIES = [
  'KXNBAGAME','KXNBASPREAD','KXNBATOTAL','KXNBAPTS','KXNBAREB','KXNBAAST','KXNBA3PT',
  'KXMLBGAME','KXMLBSPREAD','KXMLBTOTAL','KXMLBHITS','KXMLBPITCH','KXMLBHR','KXNRFI',
  'KXNFLGAME','KXNFLSPREAD','KXNFLTOTAL',
  'KXNHLGAME','KXNHLSPREAD','KXNHLTOTAL',
  'KXBTC','KXETH','KXSPX','KXNASD',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function hasExecutableTwoSidedAsk(m) {
  const yes = Number(m.yes_ask_dollars || 0);
  const no = Number(m.no_ask_dollars || 0);
  return yes > 0.02 && yes < 0.98 && no > 0.02 && no < 0.98;
}

async function fetchSeries(ticker) {
  try {
    const params = new URLSearchParams({ series_ticker: ticker, limit: '200' });
    const res = await fetch(`${BASE}/markets?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) return { markets: [], rateLimited: true };
    if (!res.ok) return { markets: [], error: res.status };
    const data = await res.json();
    const now = Date.now();
    const markets = (data.markets || []).filter(m =>
      !m.mve_collection_ticker &&
      m.market_type === 'binary' &&
      m.status === 'active' &&
      hasExecutableTwoSidedAsk(m) &&
      (!m.expected_expiration_time || new Date(m.expected_expiration_time).getTime() > now)
    );
    return { markets };
  } catch { return { markets: [] }; }
}

async function fetchOrderbook(ticker) {
  try {
    const res = await fetch(`${BASE}/markets/${encodeURIComponent(ticker)}/orderbook?depth=25`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 429) return { rateLimited: true };
    if (!res.ok) return { error: res.status };
    const data = await res.json();
    const book = data.orderbook_fp || data.orderbook || {};
    return { orderbook: book };
  } catch (err) {
    return { error: err.message || 'orderbook_error' };
  }
}

function bidsToAskLevels(oppositeBids) {
  return (oppositeBids || [])
    .map(([bid, size]) => ({
      price: Number((1 - Number(bid)).toFixed(4)),
      size: Number(size),
    }))
    .filter(level => level.price > 0 && level.price < 1 && level.size > 0)
    .sort((a, b) => a.price - b.price);
}

function needsOrderbookDepth(market) {
  return /^KX(?:NBA|MLB|NFL|NHL)(?:GAME|SPREAD|TOTAL)-/.test(market?.ticker || '');
}

async function enrichOrderbooks(markets, batchSize = 4, delayMs = 250) {
  const enriched = [];
  const targets = markets.filter(needsOrderbookDepth);
  const untouched = markets.filter(market => !needsOrderbookDepth(market));
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (market) => {
      const result = await fetchOrderbook(market.ticker);
      if (!result.orderbook) return market;
      return {
        ...market,
        kalshiYesAskLevels: bidsToAskLevels(result.orderbook.no_dollars),
        kalshiNoAskLevels: bidsToAskLevels(result.orderbook.yes_dollars),
      };
    }));
    enriched.push(...results);
    if (i + batchSize < targets.length) await sleep(delayMs);
  }
  return [...enriched, ...untouched];
}

async function fetchInBatches(series, batchSize = 5, delayMs = 300) {
  const all = [];
  for (let i = 0; i < series.length; i += batchSize) {
    const batch = series.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(fetchSeries));
    results.forEach(r => all.push(...r.markets));
    if (i + batchSize < series.length) await sleep(delayMs);
  }
  return all;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const allMarkets = await fetchInBatches(SERIES, 5, 300);

    // Deduplicate by ticker
    const seen = new Set();
    const unique = allMarkets.filter(m => {
      if (seen.has(m.ticker)) return false;
      seen.add(m.ticker);
      return true;
    });

    const enriched = await enrichOrderbooks(unique);

    return res.status(200).json({ markets: enriched, total: enriched.length });
  } catch (err) {
    return res.status(500).json({ error: err.message, platform: 'kalshi' });
  }
}
