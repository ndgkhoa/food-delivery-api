import type { AssignmentClaim } from '@delivery/domain/delivery/assignment.store';
import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '@delivery/domain/delivery/driver-location.store';
import { Inject, Injectable, Logger } from '@nestjs/common';

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
      this.logger.warn(`No available driver for order ${orderId}; left unassigned`);
      return undefined;
    }
    return claim;
  }

  async release(tenantId: string, orderId: string): Promise<void> {
    await this.assignments.unassign(tenantId, orderId);
  }
}
