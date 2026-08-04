import type { estypes } from '@elastic/elasticsearch';
import type {
  RestaurantAutocompleteQuery,
  RestaurantSearchQuery,
} from '@search/domain/restaurant-search/restaurant-search-document';

export function buildRestaurantSearchBody(query: RestaurantSearchQuery): estypes.SearchRequest {
  const from = (query.page - 1) * query.limit;
  return {
    from,
    size: query.limit,
    query: {
      bool: {
        filter: [{ term: { tenantId: query.tenantId } }],
        must: [
          {
            function_score: {
              query: {
                multi_match: {
                  query: query.q,
                  fields: ['name^3', 'description'],
                  type: 'best_fields',
                },
              },
              functions: [
                {
                  field_value_factor: {
                    field: 'rating',
                    factor: 1,
                    modifier: 'ln1p',
                    missing: 0,
                  },
                },
              ],
              boost_mode: 'sum',
              score_mode: 'sum',
            },
          },
        ],
      },
    },
  };
}

export function buildRestaurantAutocompleteBody(
  query: RestaurantAutocompleteQuery,
): estypes.SearchRequest {
  return {
    size: query.limit,
    query: {
      bool: {
        filter: [{ term: { tenantId: query.tenantId } }],
        must: [{ match: { 'name.autocomplete': { query: query.q } } }],
      },
    },
  };
}
