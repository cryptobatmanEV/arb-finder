// api/parlay-sources.js
// Manual ParlayAPI source audit. Not used by the scanner UI.

const API_KEY = process.env.PARLAY_API_KEY;
const BASE = 'https://parlay-api.com/v1';

const SPORTS = [
  'baseball_mlb',
  'basketball_nba',
  'americanfootball_nfl',
  'icehockey_nhl'
];

function interestingHeaders(headers) {
  const out = {};
  headers.forEach((value, key) => {
    if (/credit|request|usage|remaining|used|cost|quota/i.test(key)) {
      out[key] = value;
    }
  });
  return out;
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.bookmakers)) return payload.bookmakers;
  if (Array.isArray(payload?.exchanges)) return payload.exchanges;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.markets)) return payload.markets;
  return [];
}

function keyText(row) {
  return [
    row?.key,
    row?.exchange_key,
    row?.bookmaker_key,
    row?.id,
    row?.name,
    row?.title,
    row?.display_name
  ].filter(Boolean).join(' ').toLowerCase();
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row?.[field] == null ? 'null' : String(row[field]);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function compactRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    rawKeys: Object.keys(row),
    id: row.id || row.event_id || row.market_id || null,
    key: row.key || row.exchange_key || row.bookmaker_key || row.id || null,
    title: row.title || row.name || row.display_name || null,
    rawTitle: row.rawTitle || row.raw_title || row.question || row.description || null,
    source: row.source || row.exchange || row.bookmaker || null,
    sport_key: row.sport_key || row.sport || null,
    market_type: row.market_type || row.marketType || row.type || null,
    market_key: row.market_key || null,
    line: row.line ?? row.point ?? row.strike ?? null,
    yesPrice: row.yesPrice ?? row.yes_price ?? row.yes ?? row.best_yes_price ?? null,
    noPrice: row.noPrice ?? row.no_price ?? row.no ?? row.best_no_price ?? null,
    over_price: row.over_price ?? null,
    under_price: row.under_price ?? null,
    price: row.price ?? row.odds ?? null,
    volume: row.volume ?? row.volume24h ?? row.liquidity ?? null,
    volume_usd: row.volume_usd ?? null,
    last_update: row.last_update || null,
    commence_time: row.commence_time || row.start_time || row.startTime || null,
    home_team: row.home_team || row.home || null,
    away_team: row.away_team || row.away || null,
    outcomes: Array.isArray(row.outcomes)
      ? row.outcomes.slice(0, 4)
      : undefined,
    bookmakers: Array.isArray(row.bookmakers)
      ? row.bookmakers.slice(0, 5).map(b => ({ key: b.key, title: b.title }))
      : undefined,
    markets: Array.isArray(row.markets)
      ? row.markets.slice(0, 3).map(m => ({ key: m.key, outcomes: (m.outcomes || []).slice(0, 2) }))
      : undefined
  };
}

async function callParlay(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });

  const r = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-API-Key': API_KEY
    },
    signal: AbortSignal.timeout(20000)
  });

  const text = await r.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) {}

  const rows = listFromPayload(payload);

  return {
    endpoint: path,
    query: params,
    status: r.status,
    ok: r.ok,
    creditHeaders: interestingHeaders(r.headers),
    rowCount: rows.length,
    countsByMarketKey: countBy(rows, 'market_key'),
    countsByMarketType: countBy(rows, 'market_type'),
    rows,
    sampleRows: rows.slice(0, 3).map(compactRow),
    errorText: r.ok ? undefined : text.slice(0, 800)
  };
}

function sourceKey(row) {
  return String(row?.key || row?.exchange_key || row?.bookmaker_key || row?.id || row?.exchange || '').toLowerCase();
}

function sourceTitle(row) {
  return row?.title || row?.name || row?.display_name || row?.exchange || sourceKey(row);
}

function sourceList(rows) {
  return rows
    .map(row => ({ key: sourceKey(row), title: sourceTitle(row) }))
    .filter(row => row.key)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function setDiff(allRows, seenRows) {
  const seen = new Set(seenRows.map(row => row.key));
  return allRows.filter(row => !seen.has(row.key));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  try {
    const checks = [];
    const bookmakerSeen = {};
    const exchangeSeen = {};

    const bookmakers = await callParlay('/bookmakers');
    checks.push(bookmakers);
    const bookmakersAvailable = sourceList(bookmakers.rows);

    for (const sport of SPORTS) {
      const odds = await callParlay(`/sports/${sport}/odds`, {
        regions: 'us',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'american'
      });
      checks.push(odds);
      for (const ev of odds.rows) {
        for (const book of ev.bookmakers || []) {
          const key = sourceKey(book);
          if (key) bookmakerSeen[key] = book.title || book.name || key;
        }
      }

      const props = await callParlay(`/sports/${sport}/props`, {
        regions: 'us',
        oddsFormat: 'american'
      });
      checks.push(props);
      for (const ev of props.rows) {
        for (const book of ev.bookmakers || []) {
          const key = sourceKey(book);
          if (key) bookmakerSeen[key] = book.title || book.name || key;
        }
      }
    }

    const exchanges = await callParlay('/exchanges');
    checks.push(exchanges);
    const exchangesAvailable = sourceList(exchanges.rows);

    const exchangeKeys = exchangesAvailable.map(row => row.key);
    const exchangeMarketCounts = {};

    for (const exchangeKey of exchangeKeys) {
      for (const sport of SPORTS) {
        const exchangeMarkets = await callParlay(`/exchange/${sport}/markets`, {
          exchange: exchangeKey
        });
        checks.push(exchangeMarkets);
        if (!exchangeMarketCounts[exchangeKey]) exchangeMarketCounts[exchangeKey] = {};
        exchangeMarketCounts[exchangeKey][sport] = exchangeMarkets.rowCount;
        if (exchangeMarkets.rowCount > 0) {
          const exchangeMeta = exchangesAvailable.find(e => e.key === exchangeKey);
          exchangeSeen[exchangeKey] = exchangeMeta?.title || exchangeKey;
        }
      }
    }

    const sports = await callParlay('/sports');
    checks.push(sports);

    const bookmakersCurrentlySeen = Object.entries(bookmakerSeen)
      .map(([key, title]) => ({ key, title }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const exchangesCurrentlySeen = Object.entries(exchangeSeen)
      .map(([key, title]) => ({ key, title }))
      .sort((a, b) => a.key.localeCompare(b.key));

    const cleanChecks = checks.map(({ rows, ...check }) => check);

    return res.status(200).json({
      ok: true,
      pulledAt: new Date().toISOString(),
      bookmakersAvailable,
      exchangesAvailable,
      sportsAvailable: sports.rows.map(compactRow),
      bookmakersCurrentlySeen,
      exchangesCurrentlySeen,
      bookmakersMissing: setDiff(bookmakersAvailable, bookmakersCurrentlySeen),
      exchangesMissing: setDiff(exchangesAvailable, exchangesCurrentlySeen),
      exchangeMarketCounts,
      checks: cleanChecks
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
