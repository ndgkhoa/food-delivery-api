/** One row per CONFIRMED order carrying a restaurantId — the record submit-review validates against. */
export interface EligibleOrderRow {
  orderId: string;
  tenantId: string;
  userId: string;
  restaurantId: string;
}

export interface ReviewEligibleOrderRepository {
  /** Idempotent upsert by `orderId` — a redelivered `OrderConfirmed` overwrites with the same values. */
  upsertEligible(row: EligibleOrderRow): Promise<void>;
  /** Tenant-scoped lookup: a cross-tenant order id simply returns `null`, never leaking its existence. */
  findEligible(tenantId: string, orderId: string): Promise<EligibleOrderRow | null>;
}

export const REVIEW_ELIGIBLE_ORDER_REPOSITORY = Symbol('ReviewEligibleOrderRepository');
