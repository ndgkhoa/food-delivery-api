import { AssignDriverHandler } from '@delivery/application/assign-driver.handler';
import {
  FakeAssignmentStore,
  FakeDriverLocationStore,
  TENANT_A,
  TENANT_B,
} from '@delivery/application/delivery-test-doubles';

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

    const assignment = await handler.execute(TENANT_A, ORDER_ID);

    expect(assignment).toEqual({ orderId: ORDER_ID, driverId: 'driver-1' });
  });

  it('is idempotent — a redelivered confirm returns the same driver, never a second one', async () => {
    const { locations, assignments, handler } = buildHandler();
    locations.seedOnline(TENANT_A, ['driver-1', 'driver-2']);

    const first = await handler.execute(TENANT_A, ORDER_ID);
    const second = await handler.execute(TENANT_A, ORDER_ID);

    expect(second).toEqual(first);
    expect(await assignments.get(TENANT_A, ORDER_ID)).toEqual(first);
  });

  it('skips a driver already busy with another order', async () => {
    const { locations, handler } = buildHandler();
    locations.seedOnline(TENANT_A, ['driver-1', 'driver-2']);

    await handler.execute(TENANT_A, 'order-a'); // takes driver-1
    const second = await handler.execute(TENANT_A, 'order-b');

    expect(second?.driverId).toBe('driver-2');
  });

  it('returns undefined when no driver is available', async () => {
    const { handler } = buildHandler();
    // No online drivers seeded.
    expect(await handler.execute(TENANT_A, ORDER_ID)).toBeUndefined();
  });

  it('never assigns a driver from another tenant', async () => {
    const { locations, handler } = buildHandler();
    locations.seedOnline(TENANT_B, ['driver-b']); // only tenant B has drivers online

    expect(await handler.execute(TENANT_A, ORDER_ID)).toBeUndefined();
  });
});
