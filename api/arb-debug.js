// Debug V4: Introspect exact field names for event, market, game, outcome
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.NOVIG_BEARER_TOKEN || '';
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const gql = async (query) => {
    const r = await fetch('https://api.novig.us/v1/graphql', {
      method: 'POST', headers,
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    return r.json();
  };

  const getFields = (typeName) => gql(`{
    __type(name: "${typeName}") {
      fields { name type { name kind ofType { name kind } } }
    }
  }`);

  const [eventFields, marketFields, gameFields, outcomeFields] = await Promise.all([
    getFields('event'),
    getFields('market'),
    getFields('game'),
    getFields('outcome'),
  ]);

  const fields = (r) => r?.data?.__type?.fields?.map(f => f.name) || r?.errors;

  return res.status(200).json({
    event_fields:   fields(eventFields),
    market_fields:  fields(marketFields),
    game_fields:    fields(gameFields),
    outcome_fields: fields(outcomeFields),
  });
}
