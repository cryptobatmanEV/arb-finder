// Debug: Check Kalshi fee structure for sports markets
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Fetch the SAS-POR spread market we've been testing
  const r = await fetch(`${KALSHI}/markets?series_ticker=KXNBASPREAD&limit=50`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  const sasMkt = (d.markets||[]).find(m => /SASPO/i.test(m.ticker||'') || /san antonio/i.test(m.title||''));

  // Also fetch a specific market by ticker to get full fee details
  const r2 = await fetch(`${KALSHI}/markets/KXNBASPREAD-26APR24SASPOR-SAS1`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const specific = r2.ok ? await r2.json() : null;

  // Get all fee-related fields from both
  const feeFields = (m) => m ? {
    ticker: m.ticker,
    title: m.title,
    fee_rate: m.fee_rate,
    maker_fee: m.maker_fee,
    taker_fee: m.taker_fee,
    yes_ask: m.yes_ask_dollars,
    no_ask: m.no_ask_dollars,
    all_keys: Object.keys(m).filter(k =>
      /fee|cost|charge|rate|tax|commission/i.test(k)
    ),
  } : null;

  return res.status(200).json({
    sas_market_from_list: feeFields(sasMkt),
    specific_market: feeFields(specific?.market || specific),
    raw_sample_keys: sasMkt ? Object.keys(sasMkt) : [],
  });
}
