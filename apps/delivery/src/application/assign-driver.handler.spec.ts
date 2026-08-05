import { AssignDriverHandler } from '@delivery/application/assign-driver.handler';
import {
  FakeAssignmentStore,
  FakeDriverLocationStore,
  TENANT_A,
  TENANT_B,
} from '@delivery/testing/delivery-test-doubles';

function buildHandler() {
  const locations = new FakeDriverLocationStore();
  const assignments = new FakeAssignmentStore();
  const handler = new AssignDriverHandler(locations, assignments);
  return { locations, assignments, handler };
}

const ORDER_ID = 'order-1';

describe('AssignDriverHandler', () => {
  it('assigns the first available online driver to an unassigned order', async () => {
    const { locations, handler } = buildHandler();
    locations.seedOnline(TENANT_A, ['driver-1', 'driver-2']);

    const claim = await handler.execute(TENANT_A, ORDER_ID);

    expect(claim?.assignment).toEqual({ orderId: ORDER_ID, driverId: 'driver-1' });
    expect(claim?.created).toBe(true);
  });

  it('is idempotent — a redelivered confirm returns the incumbent, not a second binding', async () => {
    const { locations, assignments, handler } = buildHandler();
    locations.seedOnline(TENANT_A, ['driver-1', 'driver-2']);

    const first = await handler.execute(TENANT_A, ORDER_ID);
    const second = await handler.execute(TENANT_A, ORDER_ID);

    expect(second?.assignment).toEqual(first?.assignment);
    expect(second?.created).toBe(false);
    expect(await assignments.get(TENANT_A, ORDER_ID)).toEqual(first?.assignment);
  });

  it('never gives the same driver to two orders (one order per driver)', async () => {
    const { locations, handler } = buildHandler();
    locations.seedOnline(TENANT_A, ['driver-1', 'driver-2']);

    const a = await handler.execute(TENANT_A, 'order-a');
    const b = await handler.execute(TENANT_A, 'order-b');

    expect(a?.assignment.driverId).toBe('driver-1');
    expect(b?.assignment.driverId).toBe('driver-2');
  });

  it('releases a cancelled order so its driver becomes assignable again', async () => {
    const { locations, handler } = buildHandler();
    locations.seedOnline(TENANT_A, ['driver-1']);

    await handler.execute(TENANT_A, 'order-a');
    expect(await handler.execute(TENANT_A, 'order-b')).toBeUndefined();

    await handler.release(TENANT_A, 'order-a');
    const reassigned = await handler.execute(TENANT_A, 'order-b');
    expect(reassigned?.assignment.driverId).toBe('driver-1');
  });

  it('returns undefined when no driver is available', async () => {
    const { handler } = buildHandler();
    expect(await handler.execute(TENANT_A, ORDER_ID)).toBeUndefined();
  });

  it('never assigns a driver from another tenant', async () => {
    const { locations, handler } = buildHandler();
    locations.seedOnline(TENANT_B, ['driver-b']);

    expect(await handler.execute(TENANT_A, ORDER_ID)).toBeUndefined();
  });
});
