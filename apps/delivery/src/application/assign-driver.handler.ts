import type { Assignment } from '@delivery/domain/delivery/assignment';
import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import type { NearbyDriver } from '@delivery/domain/delivery/nearby-driver';
import { selectNearestAvailableDriver } from '@delivery/domain/delivery/select-nearest-driver';
import { Inject, Injectable, Logger } from '@nestjs/common';

/**
 * Assigns the nearest available driver to a confirmed order — idempotent under
 * `order.events` redelivery. If the order is already assigned it returns that
 * assignment unchanged. Otherwise it picks the nearest free driver from the
 * online roster and stores the assignment via the store's compare-and-set
 * (`HSETNX`), so two concurrent deliveries can never double-assign an order.
 *
 * The order payload carries no pickup coordinate yet, so "nearest" ranks over
 * the online roster at distance 0 and degrades to "first available driver". Once
 * the order exposes its pickup location (future refinement), the same pure
 * selector ranks candidates by real distance with no change here.
 */
@Injectable()
export class AssignDriverHandler {
  private readonly logger = new Logger(AssignDriverHandler.name);

  constructor(
    @Inject(DRIVER_LOCATION_STORE) private readonly locations: DriverLocationStore,
    @Inject(ASSIGNMENT_STORE) private readonly assignments: AssignmentStore,
  ) {}

  async execute(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    const existing = await this.assignments.get(tenantId, orderId);
    if (existing) {
      return existing;
    }

    const [onlineDriverIds, busyDriverIds] = await Promise.all([
      this.locations.onlineDriverIds(tenantId),
      this.assignments.busyDriverIds(tenantId),
    ]);
    const candidates: NearbyDriver[] = onlineDriverIds.map((driverId) => ({
      driverId,
      distanceMeters: 0,
    }));

    const selected = selectNearestAvailableDriver(candidates, new Set(busyDriverIds));
    if (!selected) {
      // No free driver online: leave the order unassigned. A retry/reaper sweep
      // that re-attempts assignment when a driver frees up is future work.
      this.logger.warn(`No available driver for order ${orderId}; left unassigned`);
      return undefined;
    }

    // HSETNX makes this the single winner even if two events race — the returned
    // assignment reflects whoever actually won the slot.
    return this.assignments.assign(tenantId, orderId, selected.driverId);
  }
}
