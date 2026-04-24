// Find actual daily game markets on Polymarket
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch a large batch and look for game-specific markets
  const r = await fetch('https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=500&_t=' + Date.now());
  const data = await r.json();
  const markets = Array.isArray(data) ? data : (data.markets || []);

  // Find markets ending within 5 days that mention sports
  const now = Date.now();
  const cut = now + 5 * 24 * 60 * 60 * 1000;

  const daily = markets.filter(m => {
    const end = m.endDateIso || m.endDate;
    if (!end) return false;
    const endMs = new Date(end).getTime();
    if (endMs > cut || endMs < now) return false;
    return true; // show ALL near-term markets
  }).map(m => ({
    question: m.question,
    endDateIso: m.endDateIso,
    prices: m.outcomePrices,
    tags: m.tags,
    slug: m.slug,
  }));

  return res.status(200).json({
    total_fetched: markets.length,
    expiring_within_5_days: daily.length,
    markets: daily,
  });
}
