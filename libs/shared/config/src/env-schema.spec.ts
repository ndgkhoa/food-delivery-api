import { z } from 'zod';
import { baseEnvSchema, validateEnv } from './env-schema';

describe('validateEnv', () => {
  const validRawEnv = {
    NODE_ENV: 'test',
    PORT: '4000',
    LOG_LEVEL: 'debug',
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'secret',
    DB_NAME: 'catalog',
  };

  it('parses and coerces a valid raw env object', () => {
    const result = validateEnv(baseEnvSchema, validRawEnv);

    expect(result).toEqual({
      NODE_ENV: 'test',
      PORT: 4000,
      LOG_LEVEL: 'debug',
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_USERNAME: 'postgres',
      DB_PASSWORD: 'secret',
      DB_NAME: 'catalog',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      TELEMETRY_ENABLED: 'true',
      INTERNAL_IDENTITY_MAX_SKEW_MS: 60_000,
    });
  });

  it('applies defaults for optional vars', () => {
    const { NODE_ENV, PORT, LOG_LEVEL, DB_PORT, ...required } = validRawEnv;
    const result = validateEnv(baseEnvSchema, required);

    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.LOG_LEVEL).toBe('info');
    expect(result.DB_PORT).toBe(5432);
    expect(result.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:4318');
    expect(result.TELEMETRY_ENABLED).toBe('true');
  });

  it('throws a readable error when required vars are missing', () => {
    expect(() => validateEnv(baseEnvSchema, {})).toThrow(/DB_HOST/);
  });

  it('throws when an enum value is invalid', () => {
    expect(() => validateEnv(baseEnvSchema, { ...validRawEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('supports schemas extended with service-specific fields', () => {
    const catalogEnvSchema = baseEnvSchema.extend({
      DB_SCHEMA: z.string().default('public'),
    });

    const result = validateEnv(catalogEnvSchema, validRawEnv);
    expect(result.DB_SCHEMA).toBe('public');
  });
});
