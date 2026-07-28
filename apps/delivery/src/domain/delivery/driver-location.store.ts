import type { Location } from '@delivery/domain/delivery/location';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';

/**
 * Port for live driver positions. The adapter keeps them in a tenant-scoped
 * Redis GEO set; the domain only knows this contract, never Redis. Every method
 * is tenant-scoped so a driver in one tenant can never surface in another's
 * search or online roster.
 */
export interface DriverLocationStore {
  /** Upserts the driver's current position (last write wins). */
  push(tenantId: string, driverId: string, location: Location): Promise<void>;
  /** Drivers within `radiusMeters` of the origin, nearest first. */
  nearby(tenantId: string, origin: Location, radiusMeters: number): Promise<NearbyDriver[]>;
  /** All driver ids currently reporting a position for the tenant (the online roster). */
  onlineDriverIds(tenantId: string): Promise<string[]>;
}

export const DRIVER_LOCATION_STORE = Symbol('DriverLocationStore');
