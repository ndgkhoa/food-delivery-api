import { notificationEnvSchema } from '@notification/config/notification-env-schema';

describe('notificationEnvSchema', () => {
  const dbEnv = {
    DB_HOST: 'localhost',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'postgres',
  };

  it('applies notification-specific defaults with an otherwise minimal env', () => {
    const env = notificationEnvSchema.parse(dbEnv);

    expect(env.DB_NAME).toBe('notification');
    expect(env.KAFKA_BROKERS).toBe('localhost:9092');
    expect(env.KAFKA_CLIENT_ID).toBe('notification');
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.SMTP_HOST).toBe('localhost');
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.MAIL_FROM).toBe('notifications@food-delivery.test');
    expect(env.NOTIFY_MAX_ATTEMPTS).toBe(5);
    expect(env.NOTIFY_BACKOFF_MS).toBe(2_000);
    expect(env.NOTIFY_EMAIL_ENABLED).toBe(true);
    expect(env.NOTIFY_SMS_ENABLED).toBe(true);
    expect(env.NOTIFY_PUSH_ENABLED).toBe(true);
  });

  it('treats the string "false" as a real boolean false for the channel flags', () => {
    const env = notificationEnvSchema.parse({ ...dbEnv, NOTIFY_SMS_ENABLED: 'false' });
    expect(env.NOTIFY_SMS_ENABLED).toBe(false);
    expect(env.NOTIFY_EMAIL_ENABLED).toBe(true);
  });

  it('coerces numeric envs from strings and honours overrides', () => {
    const env = notificationEnvSchema.parse({
      ...dbEnv,
      SMTP_PORT: '2525',
      NOTIFY_MAX_ATTEMPTS: '3',
      NOTIFY_BACKOFF_MS: '500',
    });
    expect(env.SMTP_PORT).toBe(2525);
    expect(env.NOTIFY_MAX_ATTEMPTS).toBe(3);
    expect(env.NOTIFY_BACKOFF_MS).toBe(500);
  });

  it('rejects a non-URL Redis connection string', () => {
    expect(() => notificationEnvSchema.parse({ ...dbEnv, REDIS_URL: 'not-a-url' })).toThrow();
  });

  it('rejects an unrecognised channel flag value', () => {
    expect(() => notificationEnvSchema.parse({ ...dbEnv, NOTIFY_PUSH_ENABLED: 'yes' })).toThrow();
  });
});
