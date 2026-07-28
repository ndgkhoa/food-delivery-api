import type { estypes } from '@elastic/elasticsearch';

/**
 * Small curated Vietnamese synonym set. Accent folding (`asciifolding`) already
 * collapses "phở" → "pho", so these mainly bridge spacing/spelling variants that
 * folding alone cannot (e.g. "banh mi" ↔ "banhmi"). Kept deliberately tiny —
 * grows with real query-log evidence, not speculation.
 */
const VN_SYNONYMS = ['phở, pho', 'bún, bun', 'bánh mì, banh mi, banhmi'];

/**
 * Index settings for the restaurant read model. `vn_text` lowercases + folds VN
 * diacritics + expands synonyms so accent-insensitive and synonym queries hit.
 * The autocomplete sub-field indexes edge-ngrams (2–15) but SEARCHES with the
 * non-ngram analyzer, so a prefix query matches stored prefixes without the
 * query itself being ngram-exploded.
 */
export const RESTAURANT_INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  analysis: {
    filter: {
      vn_synonym: { type: 'synonym', synonyms: VN_SYNONYMS },
      autocomplete_edge_ngram: { type: 'edge_ngram', min_gram: 2, max_gram: 15 },
    },
    analyzer: {
      vn_text: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'vn_synonym'],
      },
      vn_autocomplete_index: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'autocomplete_edge_ngram'],
      },
      vn_autocomplete_search: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding'],
      },
    },
  },
};

/**
 * Field mappings. `name` is full-text (`vn_text`) with an `autocomplete`
 * edge-ngram sub-field and a `keyword` sub-field for exact/sort use. `rating`
 * is a float defaulting to 0 that the search `function_score` weights (review
 * data lands later). `tenantId` is a keyword filter term for tenant isolation.
 */
export const RESTAURANT_INDEX_MAPPINGS: estypes.MappingTypeMapping = {
  properties: {
    tenantId: { type: 'keyword' },
    name: {
      type: 'text',
      analyzer: 'vn_text',
      fields: {
        autocomplete: {
          type: 'text',
          analyzer: 'vn_autocomplete_index',
          search_analyzer: 'vn_autocomplete_search',
        },
        keyword: { type: 'keyword' },
      },
    },
    description: { type: 'text', analyzer: 'vn_text' },
    isActive: { type: 'boolean' },
    rating: { type: 'float' },
    createdAt: { type: 'date' },
    updatedAt: { type: 'date' },
  },
};
