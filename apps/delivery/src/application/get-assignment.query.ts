import type { Assignment } from '@delivery/domain/delivery/assignment';
import { ASSIGNMENT_STORE, type AssignmentStore } from '@delivery/domain/delivery/assignment.store';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class GetAssignmentQuery {
  constructor(@Inject(ASSIGNMENT_STORE) private readonly assignments: AssignmentStore) {}

  execute(tenantId: string, orderId: string): Promise<Assignment | undefined> {
    return this.assignments.get(tenantId, orderId);
  }
}
