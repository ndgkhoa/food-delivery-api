import type { estypes } from '@elastic/elasticsearch';
import type {
  RestaurantAutocompleteQuery,
  RestaurantSearchQuery,
} from '@search/domain/restaurant-search/restaurant-search-document';

/**
 * Pure builders for the two Elasticsearch request bodies. Kept free of the
 * client so the exact query shape (tenant filter, field weights, function_score,
 * pagination) is unit-testable without a live node.
 */

/**
 * Full-text search body: a `multi_match` over `name^3, description` (analyzed by
 * `vn_text`, so accent-folded + synonym-expanded) wrapped in a `function_score`
 * that adds a modest boost from `rating` (log1p so a few high ratings don't
 * dominate relevance). The tenant term is a `filter` clause — it constrains
 * without affecting score, and one tenant can never see another's rows.
 */
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

/**
 * Autocomplete body: a `match` on the `name.autocomplete` edge-ngram sub-field
 * (indexed with ngrams, searched WITHOUT them) so a typed prefix hits stored
 * prefixes. Tenant-filtered like search; capped to `limit` suggestions.
 */
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
