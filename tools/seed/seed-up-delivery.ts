import { DEMO_CITY_ORIGIN } from './demo-data-fixtures';
import { pushDriverLocation, withRedis } from './redis-driver-geo';
import type { SeedConfig } from './seed-config';
import type { SeedState } from './seed-state-store';
import type { ProvisionedUser } from './seed-up-provisioning';

function jitteredCoordinate(base: number, tenantIndex: number, axisSign: 1 | -1): number {
  return base + (tenantIndex + 1) * 0.006 * axisSign;
}

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
