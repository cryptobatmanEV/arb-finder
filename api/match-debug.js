export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch what our proxies actually return and show extracted structure
  const [pmRes, kaRes] = await Promise.all([
    fetch('https://' + req.headers.host + '/api/polymarket?_t=' + Date.now()),
    fetch('https://' + req.headers.host + '/api/kalshi?_t=' + Date.now()),
  ]);

  const pmData = await pmRes.json();
  const kaData = await kaRes.json();

  const pmMarkets = pmData.markets || [];
  const kaMarkets = (kaData.markets || []).filter(m =>
    !m.mve_collection_ticker && m.market_type === 'binary' && m.status === 'active'
  );

  // Show first 20 Polymarket markets with key fields
  const pmSample = pmMarkets.slice(0, 20).map(m => ({
    question: m.question,
    end: m.end || m.endDateIso,
    eventSlug: m.eventSlug,
    prices: m.outcomePrices,
  }));

  // Show OKC-PHX Kalshi markets specifically
  const okc = kaMarkets.filter(m => m.ticker.includes('OKCPHX') || m.ticker.includes('PHXOKC')).map(m => ({
    ticker: m.ticker,
    title: m.title,
    yes_ask: m.yes_ask_dollars,
    no_ask: m.no_ask_dollars,
  }));

  return res.status(200).json({
    pm_total: pmMarkets.length,
    ka_total: kaMarkets.length,
    pm_sample: pmSample,
    okc_phx_kalshi: okc,
  });
}
