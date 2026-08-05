import { randomUUID } from 'node:crypto';
import { TENANT_A, TENANT_B } from './support/delivery-e2e-config';
import { getDelivery, pollUntil } from './support/delivery-http';
import { connectClient, waitForConnect } from './support/delivery-ws-client';
import { DeliveryJwksServer } from './support/jwks-server';
import { produceOrderConfirmed } from './support/order-events-producer';
import { flushTenantKeys } from './support/redis-cleanup';

interface NearbyDriver {
  driverId: string;
}
interface AssignmentBody {
  assigned: boolean;
  driverId: string | null;
}

describe('tenant isolation (compose e2e)', () => {
  const jwks = new DeliveryJwksServer();

  beforeAll(() => jwks.start());
  afterAll(async () => {
    await jwks.stop();
    await flushTenantKeys(TENANT_A, TENANT_B);
  });

  it('a tenant A driver is invisible to tenant B nearby + assignment', async () => {
    const driverId = randomUUID();
    const orderIdA = randomUUID();
    const orderIdB = randomUUID();
    const lat = 40.7128;
    const lng = -74.006;

    const token = await jwks.sign({ sub: driverId, tenantId: TENANT_A, roles: ['driver'] });
    const driver = connectClient(token);
    await waitForConnect(driver);
    driver.emit('location', { lat, lng });

    const inTenantA = await pollUntil(async () => {
      const res = await getDelivery<NearbyDriver[]>(
        `/delivery/orders/${orderIdA}/nearby-drivers?lat=${lat}&lng=${lng}&radius=2000`,
        { tenantId: TENANT_A, userId: driverId },
      );
      return res.body?.some((d) => d.driverId === driverId) ? res.body : undefined;
    });
    expect(inTenantA).toBeDefined();

    const nearbyB = await getDelivery<NearbyDriver[]>(
      `/delivery/orders/${orderIdB}/nearby-drivers?lat=${lat}&lng=${lng}&radius=2000`,
      { tenantId: TENANT_B, userId: randomUUID() },
    );
    expect(nearbyB.body).toEqual([]);

    await produceOrderConfirmed({
      orderId: orderIdB,
      tenantId: TENANT_B,
      userId: randomUUID(),
      totalCents: 1200,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const assignmentB = await getDelivery<AssignmentBody>(
      `/delivery/orders/${orderIdB}/assignment`,
      { tenantId: TENANT_B, userId: randomUUID() },
    );

    driver.disconnect();
    expect(assignmentB.body.assigned).toBe(false);
    expect(assignmentB.body.driverId).toBeNull();
  });
});
