import { randomUUID } from 'node:crypto';
import { TENANT_A } from './support/delivery-e2e-config';
import { getDelivery, pollUntil } from './support/delivery-http';
import { connectClient, waitForConnect } from './support/delivery-ws-client';
import { DeliveryJwksServer } from './support/jwks-server';
import { produceOrderConfirmed } from './support/order-events-producer';
import { flushTenantKeys } from './support/redis-cleanup';

interface AssignmentBody {
  orderId: string;
  assigned: boolean;
  driverId: string | null;
}

/**
 * Compose e2e — needs `core` + `messaging` + the `delivery` service running.
 * Produces an `OrderConfirmed` to `order.events` and asserts the delivery
 * consumer assigns the online driver, queryable over HTTP.
 */
describe('order.events OrderConfirmed → assignment (compose e2e)', () => {
  const jwks = new DeliveryJwksServer();

  beforeAll(() => jwks.start());
  afterAll(async () => {
    await jwks.stop();
    await flushTenantKeys(TENANT_A);
  });

  it('assigns the online driver when an order is confirmed, and is idempotent under redelivery', async () => {
    const driverId = randomUUID();
    const orderId = randomUUID();

    // A driver must be online (reporting a position) to be assignable.
    const token = await jwks.sign({ sub: driverId, tenantId: TENANT_A, roles: ['driver'] });
    const socket = connectClient(token);
    await waitForConnect(socket);
    socket.emit('location', { lat: 37.77, lng: -122.42 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    await produceOrderConfirmed({
      orderId,
      tenantId: TENANT_A,
      userId: randomUUID(),
      totalCents: 1500,
    });
    // Redelivery: the same order confirmed twice must still yield ONE assignment.
    await produceOrderConfirmed({
      orderId,
      tenantId: TENANT_A,
      userId: randomUUID(),
      totalCents: 1500,
    });

    const assignment = await pollUntil(async () => {
      const res = await getDelivery<AssignmentBody>(`/delivery/orders/${orderId}/assignment`, {
        tenantId: TENANT_A,
        userId: driverId,
      });
      return res.body?.assigned ? res.body : undefined;
    });

    socket.disconnect();
    expect(assignment?.assigned).toBe(true);
    expect(assignment?.driverId).toBe(driverId);
  });
});
