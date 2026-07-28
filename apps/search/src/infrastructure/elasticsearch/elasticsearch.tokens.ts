/** DI token for the shared `@elastic/elasticsearch` Client (bound in the ES client module). */
export const ELASTICSEARCH_CLIENT = Symbol('ElasticsearchClient');

/** Name of the restaurant read-model index. Single index, one document per restaurant. */
export const RESTAURANTS_INDEX = 'restaurants';
