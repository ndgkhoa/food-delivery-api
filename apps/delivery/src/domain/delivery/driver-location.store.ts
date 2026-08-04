import type { Location } from '@delivery/domain/delivery/location';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';

export interface DriverLocationStore {
  push(tenantId: string, driverId: string, location: Location): Promise<void>;
  remove(tenantId: string, driverId: string): Promise<void>;
  nearby(tenantId: string, origin: Location, radiusMeters: number): Promise<NearbyDriver[]>;
  onlineDriverIds(tenantId: string): Promise<string[]>;
}

export const DRIVER_LOCATION_STORE = Symbol('DriverLocationStore');
