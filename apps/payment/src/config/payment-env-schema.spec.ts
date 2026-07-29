import { paymentEnvSchema } from './payment-env-schema';

const MINIMAL = {
  DB_HOST: 'localhost',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'secret',
};

describe('paymentEnvSchema', () => {
  it('applies Temporal + webhook + port defaults when unset', () => {
    const env = paymentEnvSchema.parse(MINIMAL);
    expect(env.PORT).toBe(3007);
    expect(env.TEMPORAL_ADDRESS).toBe('localhost:7233');
    expect(env.TEMPORAL_NAMESPACE).toBe('default');
    expect(env.TEMPORAL_TASK_QUEUE).toBe('payment-charges');
    expect(env.PAYMENT_STUB_FAIL_AT_CENTS).toBe(66600);
    expect(env.PAYMENT_WEBHOOK_SECRET).toBe('dev-payment-webhook-secret');
    expect(env.TEMPORAL_WORKFLOWS_PATH).toBeUndefined();
  });

  it('coerces numeric env strings for PORT and the stub trigger', () => {
    const env = paymentEnvSchema.parse({
      ...MINIMAL,
      PORT: '4000',
      PAYMENT_STUB_FAIL_AT_CENTS: '999',
    });
    expect(env.PORT).toBe(4000);
    expect(env.PAYMENT_STUB_FAIL_AT_CENTS).toBe(999);
  });

  it('honours an explicit Temporal address + workflows path override', () => {
    const env = paymentEnvSchema.parse({
      ...MINIMAL,
      TEMPORAL_ADDRESS: 'temporal:7233',
      TEMPORAL_WORKFLOWS_PATH: '/srv/workflows',
    });
    expect(env.TEMPORAL_ADDRESS).toBe('temporal:7233');
    expect(env.TEMPORAL_WORKFLOWS_PATH).toBe('/srv/workflows');
  });

  it('rejects an empty webhook secret', () => {
    expect(() => paymentEnvSchema.parse({ ...MINIMAL, PAYMENT_WEBHOOK_SECRET: '' })).toThrow();
  });
});
