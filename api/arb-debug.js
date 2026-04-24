// Debug: Find Kalshi fee structure - check exchange, series, and event level endpoints
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = {};

  // Check exchange-level fee info
  const endpoints = [
    '/exchange/status',
    '/exchange/schedule', 
    '/exchange/fees',
    '/fees',
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(`${KALSHI}${ep}`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
      });
      results[ep] = { status: r.status, data: r.ok ? await r.json() : null };
    } catch(e) {
      results[ep] = { error: e.message };
    }
  }

  // Check series level for fee info
  try {
    const r = await fetch(`${KALSHI}/series/KXNBASPREAD`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const d = await r.json();
      results['/series/KXNBASPREAD'] = {
        status: r.status,
        keys: Object.keys(d?.series || d || {}),
        data: d,
      };
    }
  } catch(e) {
    results['/series/KXNBASPREAD'] = { error: e.message };
  }

  // Check event level
  try {
    const r = await fetch(`${KALSHI}/events/KXNBASPREAD-26APR24SASPOR`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const d = await r.json();
      const event = d?.event || d;
      results['/events/KXNBASPREAD-26APR24SASPOR'] = {
        status: r.status,
        fee_fields: Object.entries(event).filter(([k]) => /fee|cost|rate|charge|tax/i.test(k)),
        keys: Object.keys(event),
      };
    }
  } catch(e) {
    results['/events/KXNBASPREAD-26APR24SASPOR'] = { error: e.message };
  }

  // Also reverse-engineer from known numbers
  // Kalshi shows: $9.04 stake → 18.53 contracts at 47¢
  // Pure math: $9.04 / 0.47 = 19.23 contracts
  // Difference = 0.70 contracts
  results.reverse_engineer = {
    stake: 9.04,
    no_ask: 0.47,
    our_contracts: (9.04 / 0.47).toFixed(4),
    kalshi_contracts: 18.53,
    contract_diff: (9.04 / 0.47 - 18.53).toFixed(4),
    implied_true_price: (9.04 / 18.53).toFixed(4),
    fee_on_notional: ((9.04 / 18.53 - 0.47) / 0.47 * 100).toFixed(2) + '%',
    fee_on_payout: ((9.04 - 18.53 * 0.47) / 18.53 * 100).toFixed(2) + '%',
  };

  return res.status(200).json(results);
}
