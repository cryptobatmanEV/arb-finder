// Debug: Check exact date fields for SAS-POR game
const GAMMA = 'https://gamma-api.polymarket.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const r = await fetch(`${GAMMA}/events?slug=nba-sas-por-2026-04-24&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const data = await r.json();
  const event = Array.isArray(data) ? data[0] : data;
  const mkt = (event?.markets||[])[0];

  return res.status(200).json({
    event_endDate: event?.endDate,
    event_startDate: event?.startDate,
    market_endDate: mkt?.endDate,
    market_endDateIso: mkt?.endDateIso,
    market_end: mkt?.end,
    slug: event?.slug,
    note: 'Game is Apr 25 but slug says Apr 24 — check which date field to use'
  });
}
