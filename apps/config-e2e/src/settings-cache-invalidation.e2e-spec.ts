import 'reflect-metadata';
import {
  ConfigEventsConsumer,
  SettingsCache,
  SettingsClient,
} from '@food-delivery-api/shared-settings';

const CONFIG_SERVICE_URL = (process.env.CONFIG_BASE_URL ?? 'http://localhost:3008/api/v1').replace(
  /\/api\/v1$/,
  '',
);
const CONFIG_HTTP_BASE = `${CONFIG_SERVICE_URL}/api/v1`;
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');

const tenantA = 'aaaaaaaa-1111-4111-8111-111111111111';

function headersFor(tenantId: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': `user-${tenantId.slice(0, 8)}`,
    'x-roles': 'admin',
  };
}

async function waitUntil(probe: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the cache to reflect the change event');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const gatedDescribe = process.env.RUN_CONFIG_E2E === '1' ? describe : describe.skip;

gatedDescribe('settings-client cache invalidation via config.events (e2e, compose)', () => {
  let consumer: ConfigEventsConsumer;
  let client: SettingsClient;

  beforeAll(async () => {
    const valueCache = new SettingsCache<number>();
    const flagCache = new SettingsCache<boolean>();
    client = new SettingsClient(
      { configServiceUrl: CONFIG_SERVICE_URL, ttlMs: 30_000 },
      valueCache,
      flagCache,
      console,
    );
    consumer = new ConfigEventsConsumer(
      { kafkaBrokers: KAFKA_BROKERS },
      valueCache,
      flagCache,
      console,
    );
    await consumer.start();
  });

  afterAll(async () => {
    await consumer.stop();
  });

  it('fetches on a cold miss, then evicts + refetches the new value after a config.events change', async () => {
    const key = `e2e.client-cache.${Date.now()}`;

    await fetch(`${CONFIG_HTTP_BASE}/config/${key}`, {
      method: 'PUT',
      headers: headersFor(tenantA),
      body: JSON.stringify({ value: 1000 }),
    });

    await expect(client.getInt(key, tenantA, -1)).resolves.toBe(1000);

    await fetch(`${CONFIG_HTTP_BASE}/config/${key}`, {
      method: 'PUT',
      headers: headersFor(tenantA),
      body: JSON.stringify({ value: 2000 }),
    });

    await waitUntil(async () => (await client.getInt(key, tenantA, -1)) === 2000);
  }, 30_000);
});
