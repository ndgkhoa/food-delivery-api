import type { IdempotencyRepository } from '@order/domain/idempotency/idempotency.repository';
import type { OrderRepository } from '@order/domain/order/order.repository';
import { IdempotencyConflictError } from '@order/domain/shared/errors';

/** Postgres SQLSTATE for unique_violation — a concurrent duplicate idempotency key. */
const PG_UNIQUE_VIOLATION = '23505';

/** True for a Postgres unique_violation, however TypeORM wraps the driver error. */
function isUniqueViolation(error: unknown): boolean {
  const wrapped = error as { code?: string; driverError?: { code?: string } };
  return (wrapped?.driverError?.code ?? wrapped?.code) === PG_UNIQUE_VIOLATION;
}

/**
 * Claims the (tenant, user, key) → orderId mapping via a real unique
 * constraint. A concurrent duplicate claim resolves to a typed conflict
 * error (never silently overwritten, never a double reserve) by re-reading
 * whichever request actually won the insert.
 */
export async function claimIdempotencyKey(
  idempotencyRepository: IdempotencyRepository,
  orderRepository: OrderRepository,
  tenantId: string,
  userId: string,
  idempotencyKey: string,
  orderId: string,
): Promise<void> {
  try {
    await idempotencyRepository.save(tenantId, userId, idempotencyKey, orderId);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const winningOrderId = await idempotencyRepository.findOrderId(
      tenantId,
      userId,
      idempotencyKey,
    );
    if (!winningOrderId) {
      throw new IdempotencyConflictError(`key "${idempotencyKey}" claim conflict`);
    }
    const winning = await orderRepository.findById(tenantId, winningOrderId);
    if (winning) {
      // Surface the winner's order id via a typed replay conflict — the caller
      // (interface layer / a client retry) resolves this via GET or a fresh retry.
      throw new IdempotencyConflictError(
        `order already placed for this key as "${winningOrderId}"`,
      );
    }
    throw new IdempotencyConflictError(
      `order for key "${idempotencyKey}" is still being created — retry shortly`,
    );
  }
}
