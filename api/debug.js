// Diagnostic endpoint — visit /api/debug to see exactly what's happening
// Shows sample markets from each platform + attempts to find matches

const PM_BASE = 'https://gamma-api.polymarket.com';
const KA_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length > 2);
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const inter = [...sa].filter(x => sb.has(x)).length;
  return inter / new Set([...sa,...sb]).size;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const results = { polymarket: null, kalshi: null, sampleMatches: [], errors: [] };

  // Fetch Polymarket sample
  try {
    const r = await fetch(`${PM_BASE}/markets?active=true&closed=false&limit=10`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000)
    });
    const data = await r.json();
    const markets = Array.isArray(data) ? data : (data.data || data.markets || []);
    results.polymarket = {
      count: markets.length,
      sample: markets.slice(0,5).map(m => ({
        title: m.question || m.title,
        outcomePrices: m.outcomePrices,
        tokens: m.tokens?.map(t => ({outcome: t.outcome, price: t.price})),
        active: m.active,
        closed: m.closed,
      }))
    };
  } catch(e) { results.errors.push('polymarket: ' + e.message); }

  // Fetch Kalshi sample
  try {
    const r = await fetch(`${KA_BASE}/markets?limit=10`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000)
    });
    const data = await r.json();
    const markets = data.markets || [];
    const filtered = markets.filter(m => !m.mve_collection_ticker);
    results.kalshi = {
      totalFetched: markets.length,
      afterParlayFilter: filtered.length,
      sample: filtered.slice(0,5).map(m => ({
        title: m.title,
        status: m.status,
        yes_ask_dollars: m.yes_ask_dollars,
        yes_bid_dollars: m.yes_bid_dollars,
        no_ask_dollars: m.no_ask_dollars,
        no_bid_dollars: m.no_bid_dollars,
        mve_collection_ticker: m.mve_collection_ticker || null,
        market_type: m.market_type,
      }))
    };
  } catch(e) { results.errors.push('kalshi: ' + e.message); }

  // Try to find matches between the samples
  if (results.polymarket?.sample && results.kalshi?.sample) {
    for (const pm of results.polymarket.sample) {
      for (const ka of results.kalshi.sample) {
        const pmToks = tokenize(pm.title);
        const kaToks = tokenize(ka.title);
        const sim = jaccard(pmToks, kaToks);
        if (sim > 0.05) {
          results.sampleMatches.push({
            similarity: sim.toFixed(3),
            pm: pm.title,
            ka: ka.title,
          });
        }
      }
    }
    results.sampleMatches.sort((a,b) => b.similarity - a.similarity);
  }

  return res.status(200).json(results);
}
