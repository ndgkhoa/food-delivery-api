import { deliveryEnvSchema } from '@delivery/config/delivery-env-schema';

describe('deliveryEnvSchema', () => {
  it('applies delivery-specific defaults with an otherwise empty env', () => {
    const env = deliveryEnvSchema.parse({});

    expect(env.PORT).toBe(3005);
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.KAFKA_BROKERS).toBe('localhost:9092');
    expect(env.KAFKA_CLIENT_ID).toBe('delivery');
    expect(env.DRIVER_LOCATION_RATE_LIMIT_PER_SEC).toBe(5);
    expect(env.NEARBY_RADIUS_M).toBe(3000);
  });

  it('drops the DB_* block (delivery keeps no SQL — state lives in Redis)', () => {
    const env = deliveryEnvSchema.parse({}) as Record<string, unknown>;

    expect(env.DB_HOST).toBeUndefined();
    expect(env.DB_NAME).toBeUndefined();
  });

  it('rejects a non-URL Redis connection string', () => {
    expect(() => deliveryEnvSchema.parse({ REDIS_URL: 'not-a-url' })).toThrow();
  });

  it('coerces numeric envs from strings and honours overrides', () => {
    const env = deliveryEnvSchema.parse({
      PORT: '4200',
      DRIVER_LOCATION_RATE_LIMIT_PER_SEC: '10',
      NEARBY_RADIUS_M: '5000',
    });
    expect(env.PORT).toBe(4200);
    expect(env.DRIVER_LOCATION_RATE_LIMIT_PER_SEC).toBe(10);
    expect(env.NEARBY_RADIUS_M).toBe(5000);
  });

  it('rejects a non-positive rate limit', () => {
    expect(() => deliveryEnvSchema.parse({ DRIVER_LOCATION_RATE_LIMIT_PER_SEC: '0' })).toThrow();
  });
});
