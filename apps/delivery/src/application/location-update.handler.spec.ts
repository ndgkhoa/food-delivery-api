import {
  FakeAssignmentStore,
  FakeDriverLocationStore,
  TENANT_A,
} from '@delivery/application/delivery-test-doubles';
import { LocationUpdateHandler } from '@delivery/application/location-update.handler';

function buildHandler() {
  const locations = new FakeDriverLocationStore();
  const assignments = new FakeAssignmentStore();
  const handler = new LocationUpdateHandler(locations, assignments);
  return { locations, assignments, handler };
}

describe('LocationUpdateHandler', () => {
  it('pushes the position and returns the driver’s assigned order rooms', async () => {
    const { locations, assignments, handler } = buildHandler();
    await assignments.assign(TENANT_A, 'order-1', ['driver-1']);

    const orderIds = await handler.execute(TENANT_A, 'driver-1', { lat: 10, lng: 20 });

    expect(locations.pushed).toEqual([
      { tenantId: TENANT_A, driverId: 'driver-1', location: { lat: 10, lng: 20 } },
    ]);
    expect(orderIds).toEqual(['order-1']);
  });

  it('returns no rooms for a driver with no assignment', async () => {
    const { handler } = buildHandler();
    expect(await handler.execute(TENANT_A, 'driver-x', { lat: 0, lng: 0 })).toEqual([]);
  });
});
