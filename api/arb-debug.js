// Debug: Show raw Kalshi MLB tickers and what Polymarket MLB slugs look like
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA  = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get raw MLB tickers
  const r = await fetch(`${KALSHI}/markets?series_ticker=KXMLBGAME&limit=10`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const mlbRaw = (d.markets||[])
    .filter(m => !m.mve_collection_ticker && m.status==='active')
    .slice(0,5)
    .map(m => ({
      ticker: m.ticker,
      title: m.title,
      event_ticker: m.event_ticker,
      yes_ask: m.yes_ask_dollars,
      no_ask: m.no_ask_dollars,
    }));

  // Also check what Polymarket MLB slugs look like
  const pmRes = await fetch(`${GAMMA}/events?active=true&closed=false&limit=200&order=end_date_iso&ascending=true&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const pmData = await pmRes.json();
  const pmMlb = (Array.isArray(pmData) ? pmData : [])
    .filter(e => e.slug?.startsWith('mlb-'))
    .slice(0,10)
    .map(e => ({ slug: e.slug, title: e.title }));

  // Try a known MLB slug format
  const testSlugs = [
    'mlb-sf-hou-2026-04-30',
    'mlb-sfg-hou-2026-04-30',
    'mlb-was-sf-2026-04-30',
    'mlb-wsh-sf-2026-04-30',
  ];
  const slugTests = {};
  for (const slug of testSlugs) {
    const r2 = await fetch(`${GAMMA}/events?slug=${slug}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    const d2 = await r2.json();
    const e = Array.isArray(d2) ? d2[0] : d2;
    slugTests[slug] = e?.title || 'not found';
  }

  return res.status(200).json({
    kalshi_raw_tickers: mlbRaw,
    polymarket_mlb_slugs: pmMlb,
    slug_tests: slugTests,
  });
}
