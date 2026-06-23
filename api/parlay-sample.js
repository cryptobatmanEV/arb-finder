module.exports = async function handler(req, res) {
  const r = await fetch(
    `${req.headers.origin || 'https://arb-finder-sooty.vercel.app'}/api/parlay`
  );

  const data = await r.json();

  return res.status(200).json({
    count: data.markets?.length || 0,
    first20: (data.markets || []).slice(0, 20).map(m => ({
      platform: m.platform,
      sport: m.sport,
      marketType: m.marketType,
      away: m.away,
      home: m.home,
      startTime: m.startTime
    }))
  });
};
