import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';

/**
 * Picks the nearest driver that is NOT already busy with another order. Pure —
 * given the candidate list (as returned by a radius search) and the set of busy
 * driver ids, it deterministically returns the closest free driver, or
 * `undefined` when every candidate is busy (or the list is empty). Defensively
 * re-sorts by distance so correctness never depends on the store's ordering.
 */
export function selectNearestAvailableDriver(
  candidates: readonly NearbyDriver[],
  busyDriverIds: ReadonlySet<string>,
): NearbyDriver | undefined {
  return [...candidates]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .find((candidate) => !busyDriverIds.has(candidate.driverId));
}
