const https = require('https');

const URL = process.argv[2] || `https://arb-finder-sooty.vercel.app/api/parlay?fresh=1&days=5&_renderAudit=${Date.now()}`;
const NEAR_ARB_BAND = 0.02;
const SPORTSBOOK = new Set([
  'draftkings', 'fanduel', 'betmgm', 'caesars', 'bovada', 'bet365',
  'fanatics', 'hardrock', 'betrivers', 'pinnacle', 'stake', 'sugarhouse', 'tipico'
]);
const CORE_ONLY = new Set(['novig', 'kalshi', 'polymarket', 'prophetx']);
const TEAM_ABBR = {
  'arizona diamondbacks':'ari','atlanta braves':'atl','baltimore orioles':'bal','boston red sox':'bos',
  'chicago cubs':'chc','chicago white sox':'cws','cincinnati reds':'cin','cleveland guardians':'cle',
  'colorado rockies':'col','detroit tigers':'det','houston astros':'hou','kansas city royals':'kc',
  'los angeles angels':'laa','los angeles dodgers':'lad','miami marlins':'mia','milwaukee brewers':'mil',
  'minnesota twins':'min','new york mets':'nym','new york yankees':'nyy','oakland athletics':'oak',
  'philadelphia phillies':'phi','pittsburgh pirates':'pit','san diego padres':'sd','san francisco giants':'sf',
  'seattle mariners':'sea','st louis cardinals':'stl','st. louis cardinals':'stl','tampa bay rays':'tb',
  'texas rangers':'tex','toronto blue jays':'tor','washington nationals':'wsh',
  'atlanta hawks':'atl','boston celtics':'bos','brooklyn nets':'bkn','charlotte hornets':'cha',
  'chicago bulls':'chi','cleveland cavaliers':'cle','dallas mavericks':'dal','denver nuggets':'den',
  'detroit pistons':'det','golden state warriors':'gsw','houston rockets':'hou','indiana pacers':'ind',
  'la clippers':'lac','los angeles clippers':'lac','los angeles lakers':'lal','memphis grizzlies':'mem',
  'miami heat':'mia','milwaukee bucks':'mil','minnesota timberwolves':'min','new orleans pelicans':'nop',
  'new york knicks':'nyk','oklahoma city thunder':'okc','orlando magic':'orl','philadelphia 76ers':'phi',
  'phoenix suns':'phx','portland trail blazers':'por','sacramento kings':'sac','san antonio spurs':'sas',
  'toronto raptors':'tor','utah jazz':'uta','washington wizards':'was'
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function teamAbbr(name) {
  const key = String(name || '').toLowerCase().trim();
  return TEAM_ABBR[key] || key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeMarket(m) {
  const startMs = new Date(m.startTime || '').getTime();
  const dateStr = Number.isFinite(startMs) ? new Date(startMs - 4 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
  const away = teamAbbr(m.away);
  const home = teamAbbr(m.home);
  const favoredMatch = String(m.rawTitle || '').match(/Spread:\s+(.+?)\s+\(/i);
  return {
    ...m,
    gameDate: m.gameDate || dateStr,
    gameKey: m.gameKey || `${m.sport}-${away}-${home}-${dateStr}`,
    favoredTeam: m.favoredTeam || (favoredMatch ? teamAbbr(favoredMatch[1]) : null),
    matchGroupKey: m.matchGroupKey || [m.sport, away, home, dateStr, m.marketType, m.line ?? ''].join('|')
  };
}

function probToAmerican(p) {
  if (!p || p <= 0 || p >= 1) return 'n/a';
  return p >= 0.5 ? `-${Math.round((p / (1 - p)) * 100)}` : `+${Math.round(((1 - p) / p) * 100)}`;
}

function cleanLabel(label) {
  return String(label || '').replace(/\s+wins\??$/i, '').replace(/\?+$/g, '').trim();
}

function displayBetLabel(leg) {
  const proof = leg.sourceProof || {};
  const marketType = proof.displayedMarketType || proof.normalizedMarketType || leg.marketType;
  const line = proof.displayedLine ?? proof.normalizedLine ?? leg.line ?? null;
  const side = proof.displayedSide || proof.normalizedSide || leg.rawTitle || '';
  if (marketType === 'moneyline') return `${cleanLabel(side)} moneyline`;
  if (marketType === 'total') {
    if (/^over\b/i.test(side)) return line != null ? `Over ${line}` : side;
    if (/^under\b/i.test(side)) return line != null ? `Under ${line}` : side;
    return `${leg.outcome === 'YES' ? 'Over' : 'Under'}${line != null ? ` ${line}` : ''}`;
  }
  if (marketType === 'spread') {
    const spread = String(side).match(/^(.+?)\s+([+-][\d.]+)$/);
    if (spread) return `${cleanLabel(spread[1])} ${spread[2]}`;
    const titleSpread = String(leg.rawTitle || '').match(/^Spread:\s+(.+?)\s+\(([+-]?[\d.]+)\)/i);
    if (titleSpread) return `${cleanLabel(titleSpread[1])} ${titleSpread[2]}`;
  }
  return cleanLabel(side);
}

function canonicalSideIdentity(leg) {
  const label = displayBetLabel(leg).toLowerCase().replace(/\s+/g, ' ').trim();
  const marketType = leg.sourceProof?.normalizedMarketType || leg.marketType || '';
  const sport = leg.sport || String(leg.sourceProof?.normalizedGameKey || '').split('-')[0] || '';
  const line = leg.sourceProof?.normalizedLine ?? leg.line ?? '';
  if (marketType === 'moneyline') {
    const teamText = label.replace(/\s+moneyline$/i, '').trim();
    return `moneyline:${teamAbbr(teamText) || teamText}`;
  }
  if (marketType === 'spread') {
    const side = label.replace(/\s+[+-]?[\d.]+$/i, '').trim();
    const sideLine = (label.match(/([+-]?[\d.]+)$/) || [null, line])[1];
    return `spread:${teamAbbr(side) || side}:${Number(sideLine)}`;
  }
  if (marketType === 'total') {
    const ou = /^over\b/i.test(label) ? 'over' : /^under\b/i.test(label) ? 'under' : label;
    return `total:${ou}:${Number(line)}`;
  }
  return `${sport}:${label}`;
}

function proofMarketFamily(m) {
  return m.sourceProof?.YES?.normalizedMarketType
    || m.sourceProof?.NO?.normalizedMarketType
    || m.sourceProof?.YES?.rawMarketKey
    || m.sourceProof?.NO?.rawMarketKey
    || m.marketType
    || null;
}

function validatePair(a, b) {
  if (!a.gameKey || !b.gameKey || a.gameKey !== b.gameKey) return 'different_event';
  if (!a.marketType || !b.marketType || a.marketType !== b.marketType) return 'mixed_market_type';
  if (!['moneyline', 'spread', 'total'].includes(a.marketType)) return 'unsupported_market_family';
  const proofA = proofMarketFamily(a);
  const proofB = proofMarketFamily(b);
  if (proofA && proofA !== a.marketType && !(proofA === 'h2h' && a.marketType === 'moneyline')) return 'leg_a_raw_market_mismatch';
  if (proofB && proofB !== b.marketType && !(proofB === 'h2h' && b.marketType === 'moneyline')) return 'leg_b_raw_market_mismatch';
  if (a.marketType === 'moneyline' && (a.line != null || b.line != null)) return 'moneyline_has_line';
  if (a.marketType === 'spread') {
    if (a.line == null || b.line == null) return 'spread_missing_line';
    if (Math.abs(Number(a.line) - Number(b.line)) > 0.001) return 'spread_line_mismatch';
    if (a.favoredTeam && b.favoredTeam && a.favoredTeam !== b.favoredTeam) return 'spread_side_mismatch';
  }
  if (a.marketType === 'total') {
    if (a.line == null || b.line == null) return 'total_missing_line';
    if (Math.abs(Number(a.line) - Number(b.line)) > 0.001) return 'total_line_mismatch';
  }
  return null;
}

function sourceProof(m, outcome, price) {
  return m.sourceProof?.[outcome] || {
    displayedMarketType: m.marketType,
    displayedSide: outcome === 'YES' ? (m.rawTitle || m.noTitle) : (m.noTitle || m.rawTitle),
    displayedLine: m.line ?? null,
    normalizedOdds: probToAmerican(price)
  };
}

function sideLeg(m, outcome) {
  const price = outcome === 'YES' ? m.yesPrice : m.noPrice;
  if (!price) return null;
  return {
    platform: m.platform,
    outcome,
    price,
    rawTitle: outcome === 'YES' ? (m.rawTitle || m.noTitle) : (m.noTitle || m.rawTitle),
    sport: m.sport,
    gameKey: m.gameKey,
    marketType: m.marketType,
    line: m.line ?? null,
    sourceProof: sourceProof(m, outcome, price)
  };
}

function calcPair(a, b) {
  const skip = validatePair(a, b);
  if (skip) return { skip };
  const combos = [
    { a: 'YES', b: 'NO', pa: a.yesPrice, pb: b.noPrice },
    { a: 'NO', b: 'YES', pa: a.noPrice, pb: b.yesPrice }
  ].filter(c => c.pa && c.pb).sort((x, y) => (x.pa + x.pb) - (y.pa + y.pb));
  if (!combos.length) return null;
  const best = combos[0];
  const sum = best.pa + best.pb;
  if (sum < 0.90 || sum > 1.18 || best.pa < 0.04 || best.pb < 0.04) return null;
  const margin = (1 - sum) * 100;
  const isArb = margin > 0;
  const isNear = !isArb && margin > -(NEAR_ARB_BAND * 100);
  if (!isArb && !isNear) return null;
  const title = `${a.away} vs ${a.home}${a.line != null ? ` ${a.marketType === 'spread' ? 'spread' : 'O/U'} ${a.line}` : ''}`;
  return {
    id: `${a.id}||${b.id}`,
    title,
    sport: a.sport,
    marketType: a.marketType,
    gameDate: a.gameDate,
    margin,
    isArb,
    isNear,
    matchValidation: {
      passed: true,
      legA: { gameKey: a.gameKey, line: a.line ?? null },
      legB: { gameKey: b.gameKey, line: b.line ?? null }
    },
    legA: sideLeg(a, best.a),
    legB: sideLeg(b, best.b)
  };
}

function marketMatchesOpp(m, opp) {
  const gameKey = opp.matchValidation?.legA?.gameKey || opp.matchValidation?.legB?.gameKey;
  const line = opp.matchValidation?.legA?.line ?? opp.matchValidation?.legB?.line ?? null;
  if (m.gameKey !== gameKey || m.marketType !== opp.marketType || m.sport !== opp.sport) return false;
  if (opp.marketType === 'moneyline') return m.line == null;
  return m.line != null && line != null && Math.abs(Number(m.line) - Number(line)) <= 0.001;
}

function collectBoard(markets, opp, leg) {
  const primarySide = canonicalSideIdentity(leg);
  const byPlatform = {};
  markets.filter(m => marketMatchesOpp(m, opp)).forEach(m => {
    ['YES', 'NO'].forEach(outcome => {
      const side = sideLeg(m, outcome);
      if (!side || canonicalSideIdentity(side) !== primarySide) return;
      const current = byPlatform[side.platform];
      if (!current || side.price < current.price) byPlatform[side.platform] = side;
    });
  });
  return Object.values(byPlatform)
    .sort((a, b) => a.price - b.price)
    .map(side => ({
      platform: side.platform,
      label: displayBetLabel(side),
      price: side.price,
      odds: probToAmerican(side.price)
    }));
}

function groupKey(opp) {
  const gameKey = opp.matchValidation?.legA?.gameKey || opp.matchValidation?.legB?.gameKey || '';
  const line = opp.matchValidation?.legA?.line ?? opp.matchValidation?.legB?.line ?? '';
  const sides = [canonicalSideIdentity(opp.legA), canonicalSideIdentity(opp.legB)].sort().join(' vs ');
  return [gameKey, opp.sport, opp.marketType, line, sides].join('|').toLowerCase();
}

function matchAndRender(markets) {
  const opportunities = [];
  const skipped = {};
  for (let i = 0; i < markets.length; i += 1) {
    for (let j = i + 1; j < markets.length; j += 1) {
      const a = markets[i];
      const b = markets[j];
      if (a.platform === b.platform) continue;
      if (a.sport !== b.sport || a.marketType !== b.marketType || a.gameKey !== b.gameKey) continue;
      if (a.marketType === 'spread') {
        if (a.line == null || b.line == null || Math.abs(Number(a.line) - Number(b.line)) > 0.5) continue;
        if (a.favoredTeam && b.favoredTeam && a.favoredTeam !== b.favoredTeam) continue;
      }
      if (a.marketType === 'total') {
        if (a.line == null || b.line == null || Math.abs(Number(a.line) - Number(b.line)) > 0) continue;
      }
      const opp = calcPair(a, b);
      if (opp?.skip) {
        skipped[opp.skip] = (skipped[opp.skip] || 0) + 1;
      } else if (opp) {
        opportunities.push(opp);
      }
    }
  }

  const groups = new Map();
  opportunities.forEach(opp => {
    const key = groupKey(opp);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(opp);
  });
  const cards = [...groups.values()].map(group => {
    const primary = [...group].sort((a, b) => b.margin - a.margin)[0];
    return {
      ...primary,
      groupedCount: group.length,
      sideBoards: {
        legA: collectBoard(markets, primary, primary.legA),
        legB: collectBoard(markets, primary, primary.legB)
      }
    };
  }).sort((a, b) => b.margin - a.margin);

  return { opportunities, cards, skipped };
}

function countBy(rows, fn) {
  return rows.reduce((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

(async () => {
  const data = await fetchJson(URL);
  const rawMarkets = data.markets || [];
  const markets = rawMarkets.map(normalizeMarket);
  const sportsbookMarkets = markets.filter(m => SPORTSBOOK.has(m.platform));
  const { opportunities, cards, skipped } = matchAndRender(markets);
  const renderedMainLegs = cards.flatMap(card => [card.legA, card.legB]);
  const alsoAvailable = cards.flatMap(card => [...(card.sideBoards.legA || []), ...(card.sideBoards.legB || [])]);
  const sportsbookInCards = renderedMainLegs.some(leg => SPORTSBOOK.has(leg.platform)) || alsoAvailable.some(row => SPORTSBOOK.has(row.platform));
  const onlyCoreRendered = renderedMainLegs.length > 0 && renderedMainLegs.every(leg => CORE_ONLY.has(leg.platform)) && alsoAvailable.every(row => CORE_ONLY.has(row.platform));

  const report = {
    rawParlayMarkets: rawMarkets.length,
    sportsbookMarkets: sportsbookMarkets.length,
    sportsbookMarketsByBook: countBy(sportsbookMarkets, m => m.platform),
    sportsbookValidatedOpportunities: opportunities.filter(o => [o.legA, o.legB].some(leg => SPORTSBOOK.has(leg.platform))).length,
    sportsbookGroupedCards: cards.filter(card => [card.legA, card.legB, ...(card.sideBoards.legA || []), ...(card.sideBoards.legB || [])].some(row => SPORTSBOOK.has(row.platform))).length,
    renderedCardLegsByBook: countBy(renderedMainLegs, leg => leg.platform),
    alsoAvailableBooksByBook: countBy(alsoAvailable, row => row.platform),
    groupedCardCount: cards.length,
    liveArbCount: cards.filter(card => card.isArb).length,
    nearArbCount: cards.filter(card => card.isNear).length,
    skippedReasons: skipped,
    first10RenderedCards: cards.slice(0, 10).map(card => ({
      title: card.title,
      marketType: card.marketType,
      margin: Number(card.margin.toFixed(2)),
      main: [
        `${card.legA.platform}: ${displayBetLabel(card.legA)} ${probToAmerican(card.legA.price)}`,
        `${card.legB.platform}: ${displayBetLabel(card.legB)} ${probToAmerican(card.legB.price)}`
      ]
    })),
    first10AlsoAvailable: cards.slice(0, 10).map(card => ({
      title: card.title,
      sideA: (card.sideBoards.legA || []).map(row => `${row.platform}: ${row.label} ${row.odds}`),
      sideB: (card.sideBoards.legB || []).map(row => `${row.platform}: ${row.label} ${row.odds}`)
    }))
  };

  console.log(JSON.stringify(report, null, 2));
  if (sportsbookMarkets.length > 0 && (!sportsbookInCards || onlyCoreRendered)) {
    console.error('FAIL: sportsbook markets exist but rendered cards/also-available do not expose sportsbook books.');
    process.exit(1);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
