import type { Assignment } from '@delivery/domain/delivery/assignment';

/** Result of a claim attempt: the effective assignment + whether it was newly made this call. */
export interface AssignmentClaim {
  assignment: Assignment;
  /** `true` when this call bound the driver; `false` when it returned an incumbent (redelivery). */
  created: boolean;
}

/**
 * Port for order→driver assignments. The adapter persists them in tenant-scoped
 * Redis structures; the domain only knows this contract. The claim MUST be
 * atomic on BOTH invariants — one driver per order AND one order per driver —
 * even when two `order.events` are processed concurrently.
 */
export interface AssignmentStore {
  /**
   * Atomically binds the FIRST candidate driver that is not already busy to
   * `orderId` (candidates passed nearest-first). Returns the incumbent (with
   * `created:false`) if the order is already assigned, the new binding (with
   * `created:true`) on success, or `undefined` if every candidate is busy. The
   * whole check-and-claim runs in one Redis operation, so two orders can never
   * both grab the same free driver.
   */
  assign(
    tenantId: string,
    orderId: string,
    candidateDriverIdsNearestFirst: string[],
  ): Promise<AssignmentClaim | undefined>;
  /** Frees an order's assignment — removes the binding and clears the driver's busy flag when it holds no other orders. */
  unassign(tenantId: string, orderId: string): Promise<void>;
  /** The current assignment for an order, or `undefined` if unassigned. */
  get(tenantId: string, orderId: string): Promise<Assignment | undefined>;
  /** Order ids currently assigned to a driver — the rooms its location updates fan out to. */
  ordersForDriver(tenantId: string, driverId: string): Promise<string[]>;
}

export const ASSIGNMENT_STORE = Symbol('AssignmentStore');
