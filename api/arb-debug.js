// Debug: Simulate exact match calculation for KD Assists O/U 4.5
const GAMMA  = 'https://gamma-api.polymarket.com';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Get Polymarket KD assists
  const pmRes = await fetch(`${GAMMA}/events?slug=nba-lal-hou-2026-04-24&_t=${Date.now()}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const pmData = await pmRes.json();
  const event  = Array.isArray(pmData) ? pmData[0] : pmData;
  const pmKD   = (event?.markets||[]).filter(m => /kevin durant.*assists/i.test(m.question||''));

  // Get Kalshi KD assists
  const kaRes = await fetch(`${KALSHI}/markets?series_ticker=KXNBAAST&limit=200`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000)
  });
  const kaData = await kaRes.json();
  const kaKD   = (kaData.markets||[]).filter(m => /kevin durant/i.test(m.title||''));

  // Simulate exact arb calculation
  const pairs = [];
  pmKD.forEach(pm => {
    const pmBestAsk = parseFloat(pm.bestAsk||0);
    const pmBestBid = parseFloat(pm.bestBid||0);
    const pmYes = pmBestAsk > 0.01 ? pmBestAsk : parseFloat((JSON.parse(pm.outcomePrices||'[]'))[0]||0);
    const pmNo  = pmBestBid > 0.01 ? 1 - pmBestBid : parseFloat((JSON.parse(pm.outcomePrices||'[]'))[1]||0);
    const pmLine = parseFloat((pm.question||'').match(/O\/U\s*([\d.]+)/i)?.[1]||0);

    kaKD.forEach(ka => {
      const kaYes = parseFloat(ka.yes_ask_dollars||0);
      const kaNo  = parseFloat(ka.no_ask_dollars||0);
      const kaLineRaw = parseFloat((ka.title||'').match(/([\d.]+)\+/)?.[1]||0);
      const kaLine = kaLineRaw - 0.5; // normalized
      const lineDiff = Math.abs(pmLine - kaLine);

      if (lineDiff <= 0.25) {
        const sumA = pmYes + kaNo;  // PM YES + KA NO
        const sumB = pmNo  + kaYes; // PM NO  + KA YES
        const bestSum = Math.min(sumA, sumB);
        pairs.push({
          pm_question: pm.question,
          pm_yes_price: pmYes,
          pm_no_price: pmNo,
          pm_line: pmLine,
          ka_title: ka.title,
          ka_yes: kaYes,
          ka_no: kaNo,
          ka_line_raw: kaLineRaw,
          ka_line_normalized: kaLine,
          line_diff: lineDiff,
          sumA_pmYES_kaNO: sumA.toFixed(3),
          sumB_pmNO_kaYES: sumB.toFixed(3),
          best_sum: bestSum.toFixed(3),
          is_arb: bestSum < 1.0,
          margin: bestSum < 1.0 ? ((1-bestSum)*100).toFixed(2)+'%' : 'none',
          kalshi_no_real: kaNo > 0.05 && kaNo < 0.95,
          kalshi_sum_check: (kaYes + kaNo).toFixed(3),
        });
      }
    });
  });

  return res.status(200).json({
    pm_kd_assists_count: pmKD.length,
    ka_kd_assists_count: kaKD.length,
    matched_pairs: pairs,
    real_arbs: pairs.filter(p => p.is_arb && p.kalshi_no_real),
  });
}
