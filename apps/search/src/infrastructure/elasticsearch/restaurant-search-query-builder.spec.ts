import {
  buildRestaurantAutocompleteBody,
  buildRestaurantSearchBody,
} from '@search/infrastructure/elasticsearch/restaurant-search-query-builder';

/** Narrow shape of the bool query the builders produce (avoids `estypes` optionality noise in asserts). */
interface BoolQuery {
  bool: {
    filter: Array<{ term: { tenantId: string } }>;
    must: Array<Record<string, unknown>>;
  };
}

const boolOf = (query: unknown): BoolQuery['bool'] => (query as BoolQuery).bool;

describe('buildRestaurantSearchBody', () => {
  it('builds a tenant-filtered function_score multi_match with paging', () => {
    const body = buildRestaurantSearchBody({
      tenantId: 'tenant-1',
      q: 'pho',
      page: 3,
      limit: 20,
    });

    // page 3 of 20 → skip the first 40 hits.
    expect(body.from).toBe(40);
    expect(body.size).toBe(20);

    const bool = boolOf(body.query);
    expect(bool.filter).toEqual([{ term: { tenantId: 'tenant-1' } }]);

    const functionScore = bool.must[0].function_score as {
      query: { multi_match: { query: string; fields: string[] } };
      functions: Array<{ field_value_factor: { field: string; modifier: string } }>;
      boost_mode: string;
    };
    expect(functionScore.query.multi_match.query).toBe('pho');
    // name weighted 3x over description.
    expect(functionScore.query.multi_match.fields).toEqual(['name^3', 'description']);
    // rating boost is additive on top of relevance.
    expect(functionScore.functions[0].field_value_factor.field).toBe('rating');
    expect(functionScore.functions[0].field_value_factor.modifier).toBe('ln1p');
    expect(functionScore.boost_mode).toBe('sum');
  });

  it('starts at from=0 on the first page', () => {
    const body = buildRestaurantSearchBody({ tenantId: 't', q: 'x', page: 1, limit: 10 });
    expect(body.from).toBe(0);
    expect(body.size).toBe(10);
  });
});

describe('buildRestaurantAutocompleteBody', () => {
  it('matches the name.autocomplete edge-ngram field, tenant-filtered + capped', () => {
    const body = buildRestaurantAutocompleteBody({ tenantId: 'tenant-1', q: 'ph', limit: 5 });

    expect(body.size).toBe(5);
    const bool = boolOf(body.query);
    expect(bool.filter).toEqual([{ term: { tenantId: 'tenant-1' } }]);

    const match = bool.must[0].match as Record<string, { query: string }>;
    expect(match['name.autocomplete'].query).toBe('ph');
  });
});
