import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import { createLocation } from '@delivery/domain/delivery/location';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';
import { Inject, Injectable } from '@nestjs/common';

export interface NearbyDriversParams {
  lat: number;
  lng: number;
  radiusMeters: number;
}

@Injectable()
export class NearbyDriversQuery {
  constructor(
    @Inject(DRIVER_LOCATION_STORE) private readonly locations: DriverLocationStore,
    private readonly maxRadiusMeters: number,
  ) {}

  execute(tenantId: string, params: NearbyDriversParams): Promise<NearbyDriver[]> {
    const origin = createLocation(params.lat, params.lng);
    const radiusMeters = Math.min(Math.max(params.radiusMeters, 1), this.maxRadiusMeters);
    return this.locations.nearby(tenantId, origin, radiusMeters);
  }
}
