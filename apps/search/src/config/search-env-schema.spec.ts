import { searchEnvSchema } from '@search/config/search-env-schema';

describe('searchEnvSchema', () => {
  it('applies search-specific defaults with an otherwise empty env', () => {
    const env = searchEnvSchema.parse({});

    expect(env.PORT).toBe(3004);
    expect(env.ELASTICSEARCH_NODE).toBe('http://localhost:9200');
    expect(env.KAFKA_BROKERS).toBe('localhost:9092');
    expect(env.KAFKA_CLIENT_ID).toBe('search');
  });

  it('drops the DB_* block (the read model lives in Elasticsearch, not SQL)', () => {
    const env = searchEnvSchema.parse({}) as Record<string, unknown>;

    expect(env.DB_HOST).toBeUndefined();
    expect(env.DB_NAME).toBeUndefined();
  });

  it('rejects a non-URL Elasticsearch node', () => {
    expect(() => searchEnvSchema.parse({ ELASTICSEARCH_NODE: 'not-a-url' })).toThrow();
  });

  it('coerces PORT from a string and honours overrides', () => {
    const env = searchEnvSchema.parse({ PORT: '4100', KAFKA_CLIENT_ID: 'search-1' });
    expect(env.PORT).toBe(4100);
    expect(env.KAFKA_CLIENT_ID).toBe('search-1');
  });
});
