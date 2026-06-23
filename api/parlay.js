// api/parlay.js — ParlayAPI sportsbook odds proxy
//
// Credit-saving setup:
// - Frontend calls this ONLY when user clicks "Pull Sportsbooks".
// - This response is cached by Vercel for 5 minutes.
// - Frontend also keeps a 5-minute localStorage cache.
//
// Required Vercel env var:
//   PARLAY_API_KEY
// Optional if ParlayAPI gives you a different base URL:
//   PARLAY_API_BASE

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = (process.env.PARLAY_API_BASE || 'https://api.parlayapi.com/v4').replace(/\/$/, '');

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl',
];

// Keep these as provider keys. The normalizer below aliases common variants.
const BOOKMAKERS = [
  'draftkings',
  'fanduel',
  'betmgm',
  'caesars',
  'espnbet',
  'fanatics',
  'betrivers',
  'pointsbetus',
  'hardrockbet',
  'bet365',
  'rebet',
  'onyx',
  'prophetx',
  'prophet_x',
  'bovada',
  'mybookie',
  'mybookieag',
];

const BOOK_ALIASES = {
  espn_bet: 'espnbet',
  espn: 'espnbet',
  pointsbet: 'pointsbetus',
  hard_rock: 'hardrockbet',
  hardrock: 'hardrockbet',
  onyxodds: 'onyx',
  onyx_odds: 'onyx',
  prophet_x: 'prophetx',
  prophets: 'prophetx',
  prophets_exchange: 'prophetx',
  prophetsexchange: 'prophetx',
  mybookieag: 'mybookie',
  my_bookie: 'mybookie',
};

function cleanPlatform(value) {
  const raw = String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const compact = raw.replace(/_/g, '');
  return BOOK_ALIASES[raw] || BOOK_ALIASES[compact] || compact;
}

function sportOut(sportKey) {
  const s = String(sportKey || '').toLowerCase();
  if (s.includes('mlb') || s.includes('baseball')) return 'mlb';
  if (s.includes('nba') || s.includes('basketball')) return 'nba';
  if (s.includes('nfl') || s.includes('football')) return 'nfl';
  if (s.includes('nhl') || s.includes('hockey')) return 'nhl';
  return 'other';
}

function implied(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;

  // Decimal odds, e.g. 1.91
  if (n > 1 && n < 100) return 1 / n;

  // American odds, e.g. -110 or +150
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function bookTitle(book, platform) {
  return book.title || book.name || book.bookmaker || book.key || platform;
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function normalizeEventsPayload(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.events)) return json.events;
  if (Array.isArray(json?.markets)) return json.markets;
  return [];
}

function marketKey(market) {
  return String(market.key || market.market_key || market.type || market.name || '').toLowerCase();
}

function outcomesOf(market) {
  return Array.isArray(market.outcomes) ? market.outcomes : [];
}

function outcomeName(out) {
  return out?.name || out?.team || out?.label || out?.description || '';
}

function outcomePrice(out) {
  return out?.price ?? out?.odds ?? out?.decimal ?? out?.american;
}

function outcomePoint(out, market) {
  return out?.point ?? out?.line ?? out?.spread ?? market?.point ?? market?.line;
}

function eventHome(ev) {
  return ev.home_team || ev.home || ev.homeTeam || ev.home_name || ev.teams?.home;
}

function eventAway(ev) {
  return ev.away_team || ev.away || ev.awayTeam || ev.away_name || ev.teams?.away;
}

function eventStart(ev) {
  return ev.commence_time || ev.start_time || ev.startTime || ev.date || ev.scheduled || ev.event_time || '';
}

function googleUrl(book, away, home) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(`${book} ${away} ${home} odds`);
}

function normalizeEvent(ev, sportKey) {
  const home = eventHome(ev);
  const away = eventAway(ev);
  const startTime = eventStart(ev);
  const sport = sportOut(sportKey || ev.sport_key || ev.sport || ev.league);
  const out = [];

  if (!home || !away || sport === 'other') return out;

  for (const book of ev.bookmakers || ev.books || []) {
    const platform = cleanPlatform(book.key || book.bookmaker || book.name || book.title);
    if (!platform) continue;

    const title = bookTitle(book, platform);
    const markets = Array.isArray(book.markets) ? book.markets : [];

    for (const market of markets) {
      const key = marketKey(market);
      const outcomes = outcomesOf(market);

      if (key === 'h2h' || key === 'moneyline' || key === 'ml') {
        const awayOut = outcomes.find(o => sameName(outcomeName(o), away));
        const homeOut = outcomes.find(o => sameName(outcomeName(o), home));
        const yesPrice = implied(outcomePrice(awayOut));
        const noPrice = implied(outcomePrice(homeOut));
        if (!yesPrice || !noPrice) continue;

        out.push({
          id: `${ev.id || ev.event_id || `${away}-${home}-${startTime}`}-${platform}-ml`,
          source: 'parlay',
          platform,
          bookTitle: title,
          sport,
          marketType: 'moneyline',
          home,
          away,
          startTime,
          yesPrice: Number(yesPrice.toFixed(4)),
          noPrice: Number(noPrice.toFixed(4)),
          rawYesPrice: yesPrice,
          rawNoPrice: noPrice,
          rawTitle: `${away} vs ${home}`,
          noTitle: `${away} vs ${home}`,
          url: googleUrl(title, away, home),
        });
      }

      if (key === 'totals' || key === 'total') {
        const over = outcomes.find(o => /over/i.test(outcomeName(o)));
        const under = outcomes.find(o => /under/i.test(outcomeName(o)));
        const yesPrice = implied(outcomePrice(over));
        const noPrice = implied(outcomePrice(under));
        const point = outcomePoint(over, market) ?? outcomePoint(under, market);
        if (!yesPrice || !noPrice || point == null) continue;

        out.push({
          id: `${ev.id || ev.event_id || `${away}-${home}-${startTime}`}-${platform}-total-${point}`,
          source: 'parlay',
          platform,
          bookTitle: title,
          sport,
          marketType: 'total',
          home,
          away,
          startTime,
          line: Number(point),
          yesPrice: Number(yesPrice.toFixed(4)),
          noPrice: Number(noPrice.toFixed(4)),
          rawYesPrice: yesPrice,
          rawNoPrice: noPrice,
          rawTitle: `${away} vs ${home}: O/U ${point}`,
          noTitle: `${away} vs ${home}: O/U ${point}`,
          url: googleUrl(title, away, home),
        });
      }

      if (key === 'spreads' || key === 'spread') {
        // Create one binary market per spread side: YES = selected team covers; NO = opposite team covers.
        for (const side of outcomes) {
          const team = outcomeName(side);
          const point = outcomePoint(side, market);
          const yesPrice = implied(outcomePrice(side));
          if (!team || point == null || !yesPrice) continue;

          const other = outcomes.find(o => !sameName(outcomeName(o), team));
          const noPrice = implied(outcomePrice(other));
          if (!noPrice) continue;

          out.push({
            id: `${ev.id || ev.event_id || `${away}-${home}-${startTime}`}-${platform}-spread-${team}-${point}`,
            source: 'parlay',
            platform,
            bookTitle: title,
            sport,
            marketType: 'spread',
            home,
            away,
            startTime,
            line: Math.abs(Number(point)),
            yesPrice: Number(yesPrice.toFixed(4)),
            noPrice: Number(noPrice.toFixed(4)),
            rawYesPrice: yesPrice,
            rawNoPrice: noPrice,
            rawTitle: `Spread: ${team} (${Number(point) > 0 ? '+' : ''}${point})`,
            noTitle: `Spread: ${team} (${Number(point) > 0 ? '+' : ''}${point})`,
            url: googleUrl(title, away, home),
          });
        }
      }
    }
  }

  return out;
}

async function fetchSport(sport) {
  const url = new URL(`${BASE}/sports/${sport}/odds`);

  // Include multiple common auth styles because ParlayAPI-compatible providers vary.
  url.searchParams.set('apiKey', API_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'decimal');
  url.searchParams.set('bookmakers', BOOKMAKERS.join(','));

  const r = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'x-api-key': API_KEY,
      Authorization: `Bearer ${API_KEY}`,
    },
  });

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    return { sport, ok: false, status: r.status, body: body.slice(0, 500), events: [], markets: [] };
  }

  const json = await r.json();
  const events = normalizeEventsPayload(json);
  const markets = events.flatMap(ev => normalizeEvent(ev, sport));
  return { sport, ok: true, status: r.status, eventCount: events.length, marketCount: markets.length, markets };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  try {
    const results = await Promise.all(SPORTS.map(fetchSport));
    const markets = results.flatMap(r => r.markets || []);
    const debug = results.map(({ markets, ...rest }) => rest);

    return res.status(200).json({
      markets,
      count: markets.length,
      bookmakers: BOOKMAKERS,
      pulledAt: new Date().toISOString(),
      debug,
    });
  } catch (err) {
    console.error('ParlayAPI proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
};
