// api/fliff.js — Fliff odds proxy via odds-api.io
// Free tier: 100 req/hour. Multi-event endpoint = 1 req per 10 events.

const BASE = 'https://api.odds-api.io/v3';

function decToAmerican(dec) {
  dec = parseFloat(dec);
  if (!dec || dec <= 1) return null;
  if (dec >= 2.0) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const API_KEY = process.env.FLIFF_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'FLIFF_API_KEY not set' });

  try {
    // Step 1: Fetch events for active US sports in parallel
    const sports = ['basketball', 'baseball', 'american-football', 'ice-hockey'];

    const sportFetches = sports.map(sport =>
      fetch(`${BASE}/events?sport=${sport}&apiKey=${API_KEY}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    );

    const sportResults = await Promise.all(sportFetches);

    // Collect event IDs for events starting within 48 hours
    const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    let eventIds = [];

    for (const result of sportResults) {
      const events = Array.isArray(result) ? result : (result.data || []);
      const upcoming = events.filter(e =>
        e.status !== 'completed' &&
        e.id &&
        (!e.date || e.date <= cutoff)
      );
      eventIds.push(...upcoming.map(e => e.id));
    }

    // Deduplicate and cap at 50 events (5 batch requests)
    eventIds = [...new Set(eventIds)].slice(0, 50);

    if (!eventIds.length) return res.json([]);

    // Step 2: Fetch Fliff odds in batches of 10 (all in parallel)
    const BATCH = 10;
    const batchFetches = [];

    for (let i = 0; i < eventIds.length; i += BATCH) {
      const batch = eventIds.slice(i, i + BATCH).join(',');
      batchFetches.push(
        fetch(`${BASE}/odds/multi?eventIds=${batch}&bookmakers=Fliff&apiKey=${API_KEY}`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      );
    }

    const batchResults = await Promise.all(batchFetches);

    // Step 3: Normalize to arb-scanner format
    const markets = [];

    for (const result of batchResults) {
      const events = Array.isArray(result) ? result : (result.data || []);

      for (const ev of events) {
        if (!ev.home || !ev.away) continue;

        // Support both "Fliff" and "fliff" key casing
        const bookmakers = ev.bookmakers || {};
        const fliff = bookmakers.Fliff || bookmakers.fliff;
        if (!fliff || !Array.isArray(fliff)) continue;

        // Moneyline market (ML, Moneyline, or 1X2)
        const ml = fliff.find(m =>
          m.name === 'ML' || m.name === 'Moneyline' || m.name === '1X2'
        );
        if (!ml?.odds?.[0]) continue;

        const o = ml.odds[0];
        if (!o.home || !o.away) continue;

        const homeOdds = decToAmerican(o.home);
        const awayOdds = decToAmerican(o.away);
        if (!homeOdds || !awayOdds) continue;

        markets.push({
          id: String(ev.id),
          title: `${ev.home} vs ${ev.away}`,
          home: ev.home,
          away: ev.away,
          homeOdds,                           // American odds
          awayOdds,
          homeImplied: 1 / parseFloat(o.home), // true decimal implied prob
          awayImplied: 1 / parseFloat(o.away),
          sport: (typeof ev.sport === 'object' ? ev.sport?.name : ev.sport) || '',
          league: (typeof ev.league === 'object' ? ev.league?.name : ev.league) || '',
          startTime: ev.date || '',
          source: 'fliff',
          url: 'https://sports.getfliff.com/'
        });
      }
    }

    res.json(markets);
  } catch (err) {
    console.error('Fliff proxy error:', err);
    res.status(500).json({ error: err.message });
  }
};
