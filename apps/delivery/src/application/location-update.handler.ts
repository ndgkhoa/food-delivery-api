import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import type { Location } from '@delivery/domain/delivery/location';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Records a driver's live position and reports which order rooms should receive
 * the update. Pure orchestration over the two ports: writes the position to the
 * GEO store, then returns the order ids the driver is currently assigned to so
 * the caller (WS gateway) can fan the position out to those rooms. No socket or
 * Redis types leak in here.
 */
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

  /** Drops a disconnected driver from the online roster so it stops being assignable/searchable. */
  async goOffline(tenantId: string, driverId: string): Promise<void> {
    await this.locations.remove(tenantId, driverId);
  }
}
