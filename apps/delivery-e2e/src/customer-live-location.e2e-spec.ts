import { randomUUID } from 'node:crypto';
import { TENANT_A } from './support/delivery-e2e-config';
import { getDelivery, pollUntil } from './support/delivery-http';
import { connectClient, waitForConnect, waitForEvent } from './support/delivery-ws-client';
import { DeliveryJwksServer } from './support/jwks-server';
import { produceOrderConfirmed } from './support/order-events-producer';
import { flushTenantKeys } from './support/redis-cleanup';

interface AssignmentBody {
  assigned: boolean;
}
interface LocationEvent {
  driverId: string;
  lat: number;
  lng: number;
}

/**
 * Compose e2e — a customer subscribed to their order's room receives the
 * assigned driver's live position as it moves.
 */
describe('customer receives live driver location (compose e2e)', () => {
  const jwks = new DeliveryJwksServer();

  beforeAll(() => jwks.start());
  afterAll(async () => {
    await jwks.stop();
    await flushTenantKeys(TENANT_A);
  });

  it('fans a driver position update to the customer watching the order room', async () => {
    const driverId = randomUUID();
    const customerId = randomUUID();
    const orderId = randomUUID();

    // Driver online + order confirmed → an assignment exists so the customer may join.
    const driverToken = await jwks.sign({ sub: driverId, tenantId: TENANT_A, roles: ['driver'] });
    const driver = connectClient(driverToken);
    await waitForConnect(driver);
    driver.emit('location', { lat: 37.77, lng: -122.42 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await produceOrderConfirmed({
      orderId,
      tenantId: TENANT_A,
      userId: customerId,
      totalCents: 900,
    });
    await pollUntil(async () => {
      const res = await getDelivery<AssignmentBody>(`/delivery/orders/${orderId}/assignment`, {
        tenantId: TENANT_A,
        userId: customerId,
      });
      return res.body?.assigned ? res.body : undefined;
    });

    // Customer joins the order room, then the driver moves.
    const customerToken = await jwks.sign({
      sub: customerId,
      tenantId: TENANT_A,
      roles: ['customer'],
    });
    const customer = connectClient(customerToken);
    await waitForConnect(customer);
    customer.emit('join-order', { orderId });
    await waitForEvent(customer, 'joined');

    const received = waitForEvent<LocationEvent>(customer, 'location');
    driver.emit('location', { lat: 37.78, lng: -122.41 });
    const event = await received;

    driver.disconnect();
    customer.disconnect();
    expect(event.driverId).toBe(driverId);
    expect(event.lat).toBeCloseTo(37.78, 2);
    expect(event.lng).toBeCloseTo(-122.41, 2);
  });
});
