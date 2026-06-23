// api/parlay.js

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

const BOOKMAKERS = [
  'draftkings',
  'fanduel',
  'caesars',
  'bovada',
  'betmgm',
  'fanatics',
  'pinnacle',
  'fliff',
  'bet365',
  'betrivers',
  'hardrock',
  'pointsbet',
  'novig',
  'prophetx',
  'kalshi'
];

function impliedFromAmerican(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function impliedFromDecimal(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 1) return null;
  return 1 / n;
}

function implied(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  if (n > 1 && n < 100) return impliedFromDecimal(n);
  return impliedFromAmerican(n);
}

function sportShort(sport) {
  if (sport === 'baseball_mlb') return 'mlb';
  if (sport === 'basketball_nba') return 'nba';
  if (sport === 'americanfootball_nfl') return 'nfl';
  if (sport === 'icehockey_nhl') return 'nhl';
  return sport;
}

function googleUrl(book, away, home) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(`${book} ${away} ${home} odds`);
}

function normalizeEvent(ev, sport) {
  const out = [];

  const home = ev.home_team;
  const away = ev.away_team;
  const startTime = ev.commence_time;

  if (!home || !away) return out;

  for (const book of ev.bookmakers || []) {
    const platform = book.key;
    const bookTitle = book.title || book.key;

    for (const market of book.markets || []) {
      const key = market.key;
      const outcomes = market.outcomes || [];

      if (key === 'h2h') {
        const awayOut = outcomes.find(o => o.name === away);
        const homeOut = outcomes.find(o => o.name === home);

        const yesPrice = implied(awayOut?.price);
        const noPrice = implied(homeOut?.price);

        if (!yesPrice || !noPrice) continue;

        out.push({
          id: `${ev.id}-${platform}-h2h`,
          source: 'parlay',
          platform,
          bookTitle,
          sport: sportShort(sport),
          marketType: 'moneyline',
          home,
          away,
          startTime,
          yesPrice,
          noPrice,
          rawTitle: `${away} vs ${home}`,
          noTitle: `${away} vs ${home}`,
          url: googleUrl(bookTitle, away, home)
        });
      }

      if (key === 'totals') {
        const over = outcomes.find(o => /over/i.test(o.name));
        const under = outcomes.find(o => /under/i.test(o.name));

        const yesPrice = implied(over?.price);
        const noPrice = implied(under?.price);
        const point = over?.point ?? under?.point;

        if (!yesPrice || !noPrice || point == null) continue;

        out.push({
          id: `${ev.id}-${platform}-total-${point}`,
          source: 'parlay',
          platform,
          bookTitle,
          sport: sportShort(sport),
          marketType: 'total',
          home,
          away,
          startTime,
          line: Number(point),
          yesPrice,
          noPrice,
          rawTitle: `${away} vs ${home}: O/U ${point}`,
          noTitle: `${away} vs ${home}: O/U ${point}`,
          url: googleUrl(bookTitle, away, home)
        });
      }

      if (key === 'spreads') {
        for (const side of outcomes) {
          const team = side.name;
          const point = side.point;
          const yesPrice = implied(side.price);

          if (!team || point == null || !yesPrice) continue;

          const other = outcomes.find(o => o.name !== team);
          const noPrice = implied(other?.price);

          if (!noPrice) continue;

          out.push({
            id: `${ev.id}-${platform}-spread-${team}-${point}`,
            source: 'parlay',
            platform,
            bookTitle,
            sport: sportShort(sport),
            marketType: 'spread',
            home,
            away,
            startTime,
            line: Math.abs(Number(point)),
            yesPrice,
            noPrice,
            favoredTeamName: team,
            rawTitle: `Spread: ${team} (${Number(point) > 0 ? '+' : ''}${point})`,
            noTitle: `Spread: ${team} (${Number(point) > 0 ? '+' : ''}${point})`,
            url: googleUrl(bookTitle, away, home)
          });
        }
      }
    }
  }

  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  try {
    const markets = [];
    const debug = [];

    for (const sport of SPORTS) {
      const url = new URL(`${BASE}/sports/${sport}/odds`);
      url.searchParams.set('regions', 'us');
      url.searchParams.set('markets', 'h2h,spreads,totals');
      url.searchParams.set('bookmakers', BOOKMAKERS.join(','));
      url.searchParams.set('oddsFormat', 'american');

      const r = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'X-API-Key': API_KEY
        }
      });

      const text = await r.text();

      if (!r.ok) {
        debug.push({
          sport,
          ok: false,
          status: r.status,
          body: text.slice(0, 500)
        });
        continue;
      }

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        debug.push({
          sport,
          ok: false,
          status: r.status,
          body: text.slice(0, 500)
        });
        continue;
      }

      const events = Array.isArray(json) ? json : (json.data || json.events || []);

      debug.push({
        sport,
        ok: true,
        events: events.length
      });

      for (const ev of events) {
        markets.push(...normalizeEvent(ev, sport));
      }
    }

    return res.status(200).json({
      markets,
      count: markets.length,
      bookmakers: BOOKMAKERS,
      pulledAt: new Date().toISOString(),
      debug
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || 'ParlayAPI fetch failed'
    });
  }
};
