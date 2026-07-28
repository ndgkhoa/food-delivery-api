import type { Assignment } from '@delivery/domain/delivery/assignment';
import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Reads the current driver assignment for an order, scoped to the caller's
 * tenant. Returns `undefined` when the order has no assignment yet (e.g. it has
 * not been confirmed, or no driver was available).
 */
@Injectable()
export class GetAssignmentQuery {
  constructor(@Inject(ASSIGNMENT_STORE) private readonly assignments: AssignmentStore) {}

  execute(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    return this.assignments.get(tenantId, orderId);
  }
}
