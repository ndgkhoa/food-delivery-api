import type { estypes } from '@elastic/elasticsearch';

const VN_SYNONYMS = ['phở, pho', 'bún, bun', 'bánh mì, banh mi, banhmi'];

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
