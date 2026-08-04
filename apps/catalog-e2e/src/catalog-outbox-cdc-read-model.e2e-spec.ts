import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  createKafkaClient,
  type DecodedKafkaMessage,
  type KafkaClient,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import { AlsTenantContextAdapter } from '@food-delivery-api/shared-tenancy';

const BASE_URL = process.env.CATALOG_BASE_URL ?? 'http://localhost:3001/api/v1';
const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const CATALOG_EVENTS_TOPIC = 'catalog.events';

const tenantId = '55555555-5555-4555-8555-555555555555';
const otherTenantId = '66666666-6666-4666-8666-666666666666';
const ownerHeaders = {
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-user-id': 'owner-cdc',
  'x-roles': 'restaurant-owner',
};

async function waitUntil<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== undefined) {
      return result;
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Catalog outbox → Debezium CDC → read model (e2e, compose)', () => {
  let client: KafkaClient;
  let consumer: KafkaJS.Consumer;
  const received: DecodedKafkaMessage[] = [];

  beforeAll(async () => {
    client = createKafkaClient({ clientId: `catalog-cdc-e2e-${randomUUID()}`, brokers: BROKERS });
    const subscriber = new KafkaConsumerSubscriber(client, new AlsTenantContextAdapter());
    consumer = await subscriber.subscribe({
      groupId: `catalog-cdc-e2e-${randomUUID()}`,
      topics: [CATALOG_EVENTS_TOPIC],
      fromBeginning: false,
      handler: async (message) => {
        received.push(message);
      },
    });
  }, 60_000);

  afterAll(async () => {
    await consumer?.disconnect();
  });

  it('publishes an enveloped event and projects the write into the read model', async () => {
    const createRes = await fetch(`${BASE_URL}/restaurants`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ name: 'CDC Diner' }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    const restaurantId = created.id;

    const event = await waitUntil(async () =>
      received.find(
        (m) =>
          m.envelope.eventType === 'RestaurantCreated' && m.envelope.aggregateId === restaurantId,
      ),
    );
    expect(event.envelope.tenantId).toBe(tenantId);
    expect(event.envelope.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.topic).toBe(CATALOG_EVENTS_TOPIC);

    const view = await waitUntil(async () => {
      const res = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, { headers: ownerHeaders });
      return res.status === 200 ? ((await res.json()) as { id: string; name: string }) : undefined;
    });
    expect(view).toMatchObject({ id: restaurantId, name: 'CDC Diner' });

    const otherRes = await fetch(`${BASE_URL}/restaurants/${restaurantId}`, {
      headers: { ...ownerHeaders, 'x-tenant-id': otherTenantId },
    });
    expect(otherRes.status).toBe(404);
  }, 60_000);
});
