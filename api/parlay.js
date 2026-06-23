// api/parlay.js

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

const EXCHANGE_TITLES = {
  novig: 'Novig',
  prophetx: 'ProphetX'
};

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

function normalizeExchangeMarket(exchangeKey, m, sport, debug) {
  const home = m.home_team;
  const away = m.away_team;
  const startTime = m.commence_time;
  const line = m.strike;
  const overPrice = implied(m.over_price);
  const underPrice = implied(m.under_price);
  const marketType = String(m.market_type || '').toLowerCase();
  const platform = normalizeBookKey(exchangeKey || m.exchange);
  const bookTitle = EXCHANGE_TITLES[platform] || platform;

  if (!platform || !home || !away || !startTime) {
    noteSkip(debug, 'exchange_missing_event_fields');
    return null;
  }

  // Verified from /v1/exchange/{sport_key}/markets?exchange=prophetx:
  // market_type "Runs" has game teams, a strike, and over/under American odds.
  // Apply this same safe shape to any exchange row that exposes the same fields.
  if (marketType !== 'runs') {
    noteSkip(debug, 'exchange_unsupported_market_type');
    return null;
  }

  if (line == null || !overPrice || !underPrice) {
    noteSkip(debug, 'exchange_missing_prices_or_line');
    return null;
  }

  return {
    id: `${platform}-${sport}-${away}-${home}-${startTime}-total-${line}`,
    source: 'parlay',
    platform,
    bookTitle,
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
    url: googleUrl(bookTitle, away, home)
  };
}

function creditHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    if (/credit|request|usage|remaining|used|cost|quota|ratelimit/i.test(key)) {
      out[key] = value;
    }
  });
  return out;
}

async function fetchJson(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': API_KEY
    }
  });
  const text = await response.text();
  const json = response.ok ? JSON.parse(text) : null;
  return { response, text, json };
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.exchanges)) return payload.exchanges;
  if (Array.isArray(payload?.markets)) return payload.markets;
  if (Array.isArray(payload?.events)) return payload.events;
  return [];
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
    const exchangeTitles = {};
    const exchangesSeen = {};
    const exchangeList = await fetchJson('/exchanges');
    let exchangeKeys = [];

    if (exchangeList.response.ok) {
      exchangeKeys = listFromPayload(exchangeList.json)
        .map(e => {
          const key = normalizeBookKey(e.key || e.exchange_key || e.id);
          if (key) exchangeTitles[key] = e.title || e.name || EXCHANGE_TITLES[key] || key;
          return key;
        })
        .filter(Boolean);
      debug.push({
        endpoint: '/exchanges',
        ok: true,
        exchanges: exchangeKeys,
        creditHeaders: creditHeaders(exchangeList.response.headers)
      });
    } else {
      debug.push({
        endpoint: '/exchanges',
        ok: false,
        status: exchangeList.response.status,
        body: exchangeList.text.slice(0, 800),
        creditHeaders: creditHeaders(exchangeList.response.headers)
      });
    }

    for (const sport of SPORTS) {
      const oddsResult = await fetchJson(`/sports/${sport}/odds`, {
        regions: 'us',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'american'
      });

      const r = oddsResult.response;
      const text = oddsResult.text;

      if (!r.ok) {
        debug.push({
          sport,
          endpoint: `/sports/${sport}/odds`,
          ok: false,
          status: r.status,
          body: text.slice(0, 800),
          creditHeaders: creditHeaders(r.headers)
        });
        continue;
      }

      const json = oddsResult.json;
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

      debug.push({
        sport,
        endpoint: `/sports/${sport}/odds`,
        ok: true,
        events: events.length,
        creditHeaders: creditHeaders(r.headers)
      });

      for (const exchangeKey of exchangeKeys) {
        const exchangeResult = await fetchJson(`/exchange/${sport}/markets`, {
          exchange: exchangeKey
        });
        const xr = exchangeResult.response;
        const xText = exchangeResult.text;

        if (!xr.ok) {
          debug.push({
            sport,
            endpoint: `/exchange/${sport}/markets`,
            exchange: exchangeKey,
            ok: false,
            status: xr.status,
            body: xText.slice(0, 800),
            creditHeaders: creditHeaders(xr.headers)
          });
          continue;
        }

        const exchangeRows = listFromPayload(exchangeResult.json);
        const normalizedExchange = exchangeRows
          .map(m => normalizeExchangeMarket(exchangeKey, m, sport, { skipped }))
          .filter(Boolean);

        normalizedExchange.forEach(m => {
          booksSeen[m.platform] = m.bookTitle || exchangeTitles[m.platform] || m.platform;
          exchangesSeen[m.platform] = booksSeen[m.platform];
          countsByBook[m.platform] = (countsByBook[m.platform] || 0) + 1;
          countsBySport[m.sport] = (countsBySport[m.sport] || 0) + 1;
        });
        markets.push(...normalizedExchange);

        debug.push({
          sport,
          endpoint: `/exchange/${sport}/markets`,
          exchange: exchangeKey,
          ok: true,
          markets: exchangeRows.length,
          normalized: normalizedExchange.length,
          creditHeaders: creditHeaders(xr.headers)
        });
      }
    }

    return res.status(200).json({
      markets,
      count: markets.length,
      booksSeen,
      exchangesAvailable: exchangeTitles,
      exchangesSeen,
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
