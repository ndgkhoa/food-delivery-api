import { DEMO_CITY_ORIGIN } from './demo-data-fixtures';
import { pushDriverLocation, withRedis } from './redis-driver-geo';
import type { SeedConfig } from './seed-config';
import type { SeedState } from './seed-state-store';
import type { ProvisionedUser } from './seed-up-provisioning';

/** Small deterministic per-tenant offset so each tenant's driver lands at a distinct-but-plausible point near the demo city center — no real restaurant geo exists yet to anchor against. */
function jitteredCoordinate(base: number, tenantIndex: number, axisSign: 1 | -1): number {
  return base + (tenantIndex + 1) * 0.006 * axisSign;
}

/**
 * Pushes one online driver GEO position per tenant, BEFORE any order is
 * placed, so `AssignDriverHandler.execute()`'s `onlineDriverIds()` roster
 * already has a candidate the moment the order saga confirms an order (see
 * `apps/delivery/src/application/assign-driver.handler.ts`). The GEO member
 * is the driver's Keycloak user id — the same value the delivery WebSocket
 * gateway uses as `driverId` off the verified handshake token's `sub` claim
 * (`apps/delivery/src/interface/ws/delivery.gateway.ts`), so a real driver
 * connecting later would just overwrite this same GEO member.
 */
export async function seedDriverLocation(
  config: SeedConfig,
  driver: ProvisionedUser,
  tenantId: string,
  tenantIndex: number,
  state: SeedState,
): Promise<void> {
  console.log(`  pushing driver GEO location for "${driver.username}"...`);
  const lat = jitteredCoordinate(DEMO_CITY_ORIGIN.lat, tenantIndex, 1);
  const lng = jitteredCoordinate(DEMO_CITY_ORIGIN.lng, tenantIndex, -1);
  await withRedis(config, (redis) =>
    pushDriverLocation(redis, { tenantId, driverId: driver.keycloakUserId, lat, lng }),
  );
  state.driverLocations.push({ tenantId, driverId: driver.keycloakUserId });
}
