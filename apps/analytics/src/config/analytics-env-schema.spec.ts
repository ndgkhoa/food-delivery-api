import { analyticsEnvSchema } from '@analytics/config/analytics-env-schema';

describe('analyticsEnvSchema', () => {
  it('applies analytics-specific defaults with a minimal env (no DB_* required)', () => {
    const env = analyticsEnvSchema.parse({});

    expect(env.PORT).toBe(3010);
    expect(env.CLICKHOUSE_URL).toBe('http://localhost:8123');
    expect(env.CLICKHOUSE_USER).toBe('default');
    expect(env.CLICKHOUSE_PASSWORD).toBe('');
    expect(env.CLICKHOUSE_DATABASE).toBe('analytics');
    expect(env.KAFKA_BROKERS).toBe('localhost:9092');
    expect(env.KAFKA_CLIENT_ID).toBe('analytics');
  });

  it('honours overrides for ClickHouse coordinates and port', () => {
    const env = analyticsEnvSchema.parse({
      PORT: '3999',
      CLICKHOUSE_URL: 'http://clickhouse.internal:8123',
      CLICKHOUSE_USER: 'analytics_rw',
      CLICKHOUSE_PASSWORD: 'secret',
      CLICKHOUSE_DATABASE: 'analytics_prod',
    });

    expect(env.PORT).toBe(3999);
    expect(env.CLICKHOUSE_URL).toBe('http://clickhouse.internal:8123');
    expect(env.CLICKHOUSE_USER).toBe('analytics_rw');
    expect(env.CLICKHOUSE_PASSWORD).toBe('secret');
    expect(env.CLICKHOUSE_DATABASE).toBe('analytics_prod');
  });

  it('rejects a malformed ClickHouse URL', () => {
    expect(() => analyticsEnvSchema.parse({ CLICKHOUSE_URL: 'not-a-url' })).toThrow();
  });
});
