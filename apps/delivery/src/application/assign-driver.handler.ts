import type { AssignmentClaim } from '@delivery/domain/delivery/assignment.store';
import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import { Inject, Injectable, Logger } from '@nestjs/common';

/**
 * Assigns the nearest available driver to a confirmed order, and releases the
 * assignment when the order is cancelled. Both are idempotent under
 * `order.events` redelivery: the store's atomic claim returns the incumbent
 * (not a second binding) for an already-assigned order, and picks the first
 * candidate that is not already busy — so two orders confirmed concurrently can
 * never grab the same driver.
 *
 * The order payload carries no pickup coordinate yet, so candidates are the
 * online roster in list order ("first available"); once the order exposes a
 * pickup location the roster is simply sorted by distance before the claim, with
 * no change to the atomic-claim contract.
 */
@Injectable()
export class AssignDriverHandler {
  private readonly logger = new Logger(AssignDriverHandler.name);

  constructor(
    @Inject(DRIVER_LOCATION_STORE) private readonly locations: DriverLocationStore,
    @Inject(ASSIGNMENT_STORE) private readonly assignments: AssignmentStore,
  ) {}

  async execute(tenantId: string, orderId: string): Promise<AssignmentClaim | undefined> {
    const candidates = await this.locations.onlineDriverIds(tenantId);
    const claim = await this.assignments.assign(tenantId, orderId, candidates);
    if (!claim) {
      // Every online driver is busy (or none online): leave the order
      // unassigned. A retry/reaper that re-attempts when a driver frees up is
      // future work.
      this.logger.warn(`No available driver for order ${orderId}; left unassigned`);
      return undefined;
    }
    return claim;
  }

  /** Releases the driver held by a cancelled order (idempotent no-op if unassigned). */
  async release(tenantId: string, orderId: string): Promise<void> {
    await this.assignments.unassign(tenantId, orderId);
  }
}
