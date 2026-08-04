export interface OrderConfirmedPayload {
  orderId?: string;
  userId?: string;
  restaurantId?: string;
}

export interface EligibleOrderInput {
  orderId: string;
  userId: string;
  restaurantId: string;
}

export function parseEligibleOrder(payload: OrderConfirmedPayload): EligibleOrderInput | null {
  if (!payload.orderId || !payload.userId || !payload.restaurantId) {
    return null;
  }
  return { orderId: payload.orderId, userId: payload.userId, restaurantId: payload.restaurantId };
}
