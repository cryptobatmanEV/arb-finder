// Debug: Verify Kalshi fee rate across multiple markets at different prices
// We know: stake / true_cost = contracts shown
// So: true_cost = stake / contracts, fee = true_cost - ask_price
// fee_multiplier = fee / (p * (1-p))
// If multiplier is consistent across prices → 7% confirmed app-wide

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

async function getMarketFeeMultiplier(ticker, askPrice, series) {
  // We can't directly get "contracts for $X" from the API
  // But we can check different series for their fee_multiplier field
  try {
    const r = await fetch(`${KALSHI}/series/${series}`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      series,
      fee_multiplier: d.series?.fee_multiplier,
      fee_type: d.series?.fee_type,
    };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Check fee_multiplier across ALL sports series
  const series = [
    'KXNBAGAME', 'KXNBASPREAD', 'KXNBATOTAL',
    'KXNBAPTS',  'KXNBAREB',   'KXNBAAST', 'KXNBA3PT',
    'KXMLBGAME', 'KXMLBSPREAD','KXMLBTOTAL',
    'KXNHLGAME', 'KXNHLSPREAD','KXNHLTOTAL',
    'KXNFLGAME', 'KXNFLSPREAD','KXNFLTOTAL',
  ];

  const results = await Promise.all(series.map(s => getMarketFeeMultiplier(null, null, s)));

  // Also verify our 7% against the known data point
  const p = 0.47;
  const stake = 9.04;
  const kalshi_contracts = 18.53;
  const true_cost = stake / kalshi_contracts;
  const fee = true_cost - p;
  const empirical_multiplier = fee / (p * (1-p));

  return res.status(200).json({
    series_fee_info: results.filter(Boolean),
    empirical_check: {
      known_p: p,
      known_stake: stake,
      known_contracts: kalshi_contracts,
      reverse_engineered_multiplier: parseFloat(empirical_multiplier.toFixed(4)),
      note: 'If all series show same fee_multiplier AND matches empirical → confirmed app-wide'
    }
  });
}
