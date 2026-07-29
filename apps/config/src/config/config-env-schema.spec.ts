import { configEnvSchema } from '@config/config/config-env-schema';

describe('configEnvSchema', () => {
  const dbEnv = {
    DB_HOST: 'localhost',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
  };

  it('applies config-specific defaults with an otherwise minimal env', () => {
    const env = configEnvSchema.parse(dbEnv);

    expect(env.PORT).toBe(3008);
    expect(env.DB_NAME).toBe('config');
    expect(env.KAFKA_BROKERS).toBe('localhost:9092');
    expect(env.KAFKA_CLIENT_ID).toBe('config');
  });

  it('coerces PORT from a string and honours an override', () => {
    expect(configEnvSchema.parse({ ...dbEnv, PORT: '4200' }).PORT).toBe(4200);
  });

  it('honours an overridden KAFKA_CLIENT_ID', () => {
    expect(configEnvSchema.parse({ ...dbEnv, KAFKA_CLIENT_ID: 'config-2' }).KAFKA_CLIENT_ID).toBe(
      'config-2',
    );
  });
});
