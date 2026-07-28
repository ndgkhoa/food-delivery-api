import type { Assignment } from '@delivery/domain/delivery/assignment';

/**
 * Port for order→driver assignments. The adapter persists them in tenant-scoped
 * Redis structures; the domain only knows this contract. `assign` MUST be
 * idempotent — one driver per order, even under `order.events` redelivery.
 */
export interface AssignmentStore {
  /**
   * Assigns `driverId` to `orderId` iff the order has none yet (idempotent).
   * Returns the effective assignment: the newly-written one, or the pre-existing
   * one when the order was already assigned (a redelivered event is a no-op).
   */
  assign(tenantId: string, orderId: string, driverId: string): Promise<Assignment>;
  /** The current assignment for an order, or `undefined` if unassigned. */
  get(tenantId: string, orderId: string): Promise<Assignment | undefined>;
  /** Driver ids currently holding at least one active assignment (the busy roster). */
  busyDriverIds(tenantId: string): Promise<string[]>;
  /** Order ids currently assigned to a driver — the rooms its location updates fan out to. */
  ordersForDriver(tenantId: string, driverId: string): Promise<string[]>;
}

export const ASSIGNMENT_STORE = Symbol('AssignmentStore');
