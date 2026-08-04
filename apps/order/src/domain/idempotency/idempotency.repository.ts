export interface IdempotencyRepository {
  findOrderId(tenantId: string, userId: string, key: string): Promise<string | undefined>;
  save(tenantId: string, userId: string, key: string, orderId: string): Promise<void>;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('IdempotencyRepository');
