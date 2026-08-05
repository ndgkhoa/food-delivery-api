export interface EligibleOrderRow {
  orderId: string;
  tenantId: string;
  userId: string;
  restaurantId: string;
}

export interface ReviewEligibleOrderRepository {
  upsertEligible(row: EligibleOrderRow): Promise<void>;
  findEligible(tenantId: string, orderId: string): Promise<EligibleOrderRow | null>;
}

export const REVIEW_ELIGIBLE_ORDER_REPOSITORY = Symbol('ReviewEligibleOrderRepository');
