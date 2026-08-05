import type { Assignment } from '@delivery/domain/delivery/assignment';

export interface AssignmentClaim {
  assignment: Assignment;
  created: boolean;
}

export interface AssignmentStore {
  assign(
    tenantId: string,
    orderId: string,
    candidateDriverIdsNearestFirst: string[],
  ): Promise<AssignmentClaim | undefined>;
  unassign(tenantId: string, orderId: string): Promise<void>;
  get(tenantId: string, orderId: string): Promise<Assignment | undefined>;
  ordersForDriver(tenantId: string, driverId: string): Promise<string[]>;
}

export const ASSIGNMENT_STORE = Symbol('AssignmentStore');
