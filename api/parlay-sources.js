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

const TARGETS = ['prophetx', 'prophet x', 'rebet', 'onyx'];

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

function matchesTarget(row) {
  const text = keyText(row);
  return TARGETS.some(t => text.includes(t));
}

function compactRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    key: row.key || row.exchange_key || row.bookmaker_key || row.id || null,
    title: row.title || row.name || row.display_name || null,
    sport_key: row.sport_key || row.sport || null,
    commence_time: row.commence_time || row.start_time || row.startTime || null,
    home_team: row.home_team || row.home || null,
    away_team: row.away_team || row.away || null,
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
  const targetRows = rows.filter(matchesTarget).slice(0, 10);

  return {
    endpoint: path,
    query: params,
    status: r.status,
    ok: r.ok,
    creditHeaders: interestingHeaders(r.headers),
    rowCount: rows.length,
    foundTargets: targetRows.map(compactRow),
    sampleRows: rows.slice(0, 3).map(compactRow),
    errorText: r.ok ? undefined : text.slice(0, 800)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!API_KEY) {
    return res.status(500).json({ error: 'PARLAY_API_KEY not set in Vercel' });
  }

  try {
    const checks = [];

    checks.push(await callParlay('/bookmakers'));

    for (const sport of SPORTS) {
      checks.push(await callParlay(`/sports/${sport}/odds`, {
        regions: 'us',
        markets: 'h2h,spreads,totals',
        oddsFormat: 'american'
      }));
      checks.push(await callParlay(`/sports/${sport}/props`, {
        regions: 'us',
        oddsFormat: 'american'
      }));
    }

    const exchanges = await callParlay('/exchanges');
    checks.push(exchanges);

    const exchangeKeys = exchanges.foundTargets
      .map(row => row.key)
      .filter(Boolean);

    for (const exchangeKey of exchangeKeys) {
      checks.push(await callParlay(`/exchange/${encodeURIComponent(exchangeKey)}/markets`));
    }

    const allFoundRows = checks.flatMap(c => c.foundTargets || []);
    const sourceSummary = {};
    for (const row of allFoundRows) {
      const text = `${row.key || ''} ${row.title || ''}`.toLowerCase();
      if (text.includes('prophet')) sourceSummary.prophetx = row.key || row.title;
      if (text.includes('rebet')) sourceSummary.rebet = row.key || row.title;
      if (text.includes('onyx')) sourceSummary.onyx = row.key || row.title;
    }

    return res.status(200).json({
      ok: true,
      pulledAt: new Date().toISOString(),
      checkedTargets: ['ProphetX', 'Rebet', 'Onyx'],
      sourceSummary,
      checks
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
