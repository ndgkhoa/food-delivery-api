import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import type { Location } from '@delivery/domain/delivery/location';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class LocationUpdateHandler {
  constructor(
    @Inject(DRIVER_LOCATION_STORE) private readonly locations: DriverLocationStore,
    @Inject(ASSIGNMENT_STORE) private readonly assignments: AssignmentStore,
  ) {}

  async execute(tenantId: string, driverId: string, location: Location): Promise<string[]> {
    await this.locations.push(tenantId, driverId, location);
    return this.assignments.ordersForDriver(tenantId, driverId);
  }

  async goOffline(tenantId: string, driverId: string): Promise<void> {
    await this.locations.remove(tenantId, driverId);
  }
}
