import { randomUUID } from 'node:crypto';
import { TENANT_A } from './support/delivery-e2e-config';
import { getDelivery, pollUntil } from './support/delivery-http';
import { connectClient, waitForConnect } from './support/delivery-ws-client';
import { DeliveryJwksServer } from './support/jwks-server';
import { flushTenantKeys } from './support/redis-cleanup';

interface NearbyDriver {
  driverId: string;
  distanceMeters: number;
}

describe('driver location → nearby query (compose e2e)', () => {
  const jwks = new DeliveryJwksServer();

  beforeAll(() => jwks.start());
  afterAll(async () => {
    await jwks.stop();
    await flushTenantKeys(TENANT_A);
  });

  it('a driver that pushes its location is discoverable within the radius', async () => {
    const driverId = randomUUID();
    const orderId = randomUUID();
    const lat = 37.7749;
    const lng = -122.4194;

    const token = await jwks.sign({ sub: driverId, tenantId: TENANT_A, roles: ['driver'] });
    const socket = connectClient(token);
    await waitForConnect(socket);
    socket.emit('location', { lat, lng });

    const nearby = await pollUntil(async () => {
      const res = await getDelivery<NearbyDriver[]>(
        `/delivery/orders/${orderId}/nearby-drivers?lat=${lat}&lng=${lng}&radius=1000`,
        { tenantId: TENANT_A, userId: driverId, roles: ['driver'] },
      );
      return res.body?.some((driver) => driver.driverId === driverId) ? res.body : undefined;
    });

    socket.disconnect();
    expect(nearby?.some((driver) => driver.driverId === driverId)).toBe(true);
  });
});
