/**
 * Maps a client-supplied idempotency key (scoped per tenant + user, matching
 * the DB's `UNIQUE(tenant_id, user_id, key)` constraint) to the order id it
 * produced, so a retried "place order" request replays the original result
 * instead of creating a duplicate order.
 */
export interface IdempotencyRepository {
  findOrderId(tenantId: string, userId: string, key: string): Promise<string | undefined>;
  /**
   * Inserts the mapping. Throws on a unique-constraint violation (Postgres
   * SQLSTATE 23505) when a concurrent request already claimed this
   * tenant+user+key — the caller re-reads `findOrderId` to resolve the winner.
   */
  save(tenantId: string, userId: string, key: string, orderId: string): Promise<void>;
}

export const IDEMPOTENCY_REPOSITORY = Symbol('IdempotencyRepository');
