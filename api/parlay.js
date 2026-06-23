// api/parlay.js

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

function implied(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
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

function noteSkip(debug, reason) {
  if (!debug) return;
  debug.skipped[reason] = (debug.skipped[reason] || 0) + 1;
}

function normalizeBookKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeEvent(ev, sport, debug) {
  const out = [];
  const home = ev.home_team;
  const away = ev.away_team;
  const startTime = ev.commence_time;

  if (!home || !away) {
    noteSkip(debug, 'missing_teams');
    return out;
  }

  for (const book of ev.bookmakers || []) {
    const platform = normalizeBookKey(book.key);
    const bookTitle = book.title || book.key;
    if (!platform) {
      noteSkip(debug, 'missing_book_key');
      continue;
    }

    for (const market of book.markets || []) {
      const key = market.key;
      const outcomes = market.outcomes || [];

      if (key === 'h2h') {
        const awayOut = outcomes.find(o => o.name === away);
        const homeOut = outcomes.find(o => o.name === home);

        const yesPrice = implied(awayOut?.price);
        const noPrice = implied(homeOut?.price);

        if (!yesPrice || !noPrice) {
          noteSkip(debug, 'h2h_missing_prices');
          continue;
        }

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

        if (!yesPrice || !noPrice || point == null) {
          noteSkip(debug, 'total_missing_prices_or_line');
          continue;
        }

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

          if (!team || point == null || !yesPrice) {
            noteSkip(debug, 'spread_missing_team_price_or_line');
            continue;
          }

          const other = outcomes.find(o => o.name !== team);
          const noPrice = implied(other?.price);

          if (!noPrice) {
            noteSkip(debug, 'spread_missing_other_price');
            continue;
          }

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

function normalizeProphetXMarket(m, sport, debug) {
  const home = m.home_team;
  const away = m.away_team;
  const startTime = m.commence_time;
  const line = m.strike;
  const overPrice = implied(m.over_price);
  const underPrice = implied(m.under_price);
  const marketType = String(m.market_type || '').toLowerCase();

  if (!home || !away || !startTime) {
    noteSkip(debug, 'prophetx_missing_event_fields');
    return null;
  }

  // Verified from /v1/exchange/{sport_key}/markets?exchange=prophetx:
  // market_type "Runs" has game teams, a strike, and over/under American odds.
  if (marketType !== 'runs') {
    noteSkip(debug, 'prophetx_unsupported_market_type');
    return null;
  }

  if (line == null || !overPrice || !underPrice) {
    noteSkip(debug, 'prophetx_missing_prices_or_line');
    return null;
  }

  return {
    id: `prophetx-${sport}-${away}-${home}-${startTime}-total-${line}`,
    source: 'parlay',
    platform: 'prophetx',
    bookTitle: 'ProphetX',
    sport: sportShort(sport),
    marketType: 'total',
    home,
    away,
    startTime,
    line: Number(line),
    yesPrice: overPrice,
    noPrice: underPrice,
    rawTitle: `${away} vs ${home}: O/U ${line}`,
    noTitle: `${away} vs ${home}: O/U ${line}`,
    url: googleUrl('ProphetX', away, home)
  };
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
    const booksSeen = {};
    const skipped = {};
    const countsByBook = {};
    const countsBySport = {};

    for (const sport of SPORTS) {
      const url = new URL(`${BASE}/sports/${sport}/odds`);
      url.searchParams.set('regions', 'us');
      url.searchParams.set('markets', 'h2h,spreads,totals');
      url.searchParams.set('oddsFormat', 'american');

      const r = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'X-API-Key': API_KEY
        }
      });

      const text = await r.text();

      if (!r.ok) {
        debug.push({ sport, ok: false, status: r.status, body: text.slice(0, 800) });
        continue;
      }

      const json = JSON.parse(text);
      const events = Array.isArray(json) ? json : (json.data || json.events || []);

      for (const ev of events) {
        for (const b of ev.bookmakers || []) {
          const key = normalizeBookKey(b.key);
          if (key) booksSeen[key] = b.title || b.key;
        }
        const normalized = normalizeEvent(ev, sport, { skipped });
        normalized.forEach(m => {
          countsByBook[m.platform] = (countsByBook[m.platform] || 0) + 1;
          countsBySport[m.sport] = (countsBySport[m.sport] || 0) + 1;
        });
        markets.push(...normalized);
      }

      debug.push({ sport, ok: true, events: events.length });

      const exchangeUrl = new URL(`${BASE}/exchange/${sport}/markets`);
      exchangeUrl.searchParams.set('exchange', 'prophetx');

      const xr = await fetch(exchangeUrl.toString(), {
        headers: {
          Accept: 'application/json',
          'X-API-Key': API_KEY
        }
      });

      const xText = await xr.text();

      if (!xr.ok) {
        debug.push({ sport, exchange: 'prophetx', ok: false, status: xr.status, body: xText.slice(0, 800) });
        continue;
      }

      const xJson = JSON.parse(xText);
      const exchangeRows = Array.isArray(xJson) ? xJson : (xJson.data || xJson.markets || []);
      const normalizedExchange = exchangeRows
        .map(m => normalizeProphetXMarket(m, sport, { skipped }))
        .filter(Boolean);

      normalizedExchange.forEach(m => {
        booksSeen[m.platform] = m.bookTitle;
        countsByBook[m.platform] = (countsByBook[m.platform] || 0) + 1;
        countsBySport[m.sport] = (countsBySport[m.sport] || 0) + 1;
      });
      markets.push(...normalizedExchange);

      debug.push({
        sport,
        exchange: 'prophetx',
        ok: true,
        markets: exchangeRows.length,
        normalized: normalizedExchange.length
      });
    }

    return res.status(200).json({
      markets,
      count: markets.length,
      booksSeen,
      countsByBook,
      countsBySport,
      skipped,
      pulledAt: new Date().toISOString(),
      debug
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
