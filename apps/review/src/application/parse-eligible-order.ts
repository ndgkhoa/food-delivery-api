/** The `order.events` `OrderConfirmed` payload fields review eligibility needs. */
export interface OrderConfirmedPayload {
  orderId?: string;
  userId?: string;
  /** Absent for a straggler order placed before the restaurantId invariant — never review-eligible. */
  restaurantId?: string;
}

export interface EligibleOrderInput {
  orderId: string;
  userId: string;
  restaurantId: string;
}

/**
 * Extracts the fields needed to record review eligibility from an
 * `OrderConfirmed` payload, or returns `null` when the event can't (or
 * shouldn't) make an order review-eligible: a malformed payload, or a
 * straggler order confirmed without a `restaurantId`. Pure so the skip rule
 * is unit-testable without Kafka or a database.
 */
export function parseEligibleOrder(payload: OrderConfirmedPayload): EligibleOrderInput | null {
  if (!payload.orderId || !payload.userId || !payload.restaurantId) {
    return null;
  }
  return { orderId: payload.orderId, userId: payload.userId, restaurantId: payload.restaurantId };
}
