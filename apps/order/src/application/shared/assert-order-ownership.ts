import type { Order } from '@order/domain/order/order';
import { OrderForbiddenError } from '@order/domain/shared/errors';

/** Role that bypasses ownership — an admin may act on any tenant's order. */
const ADMIN_ROLE = 'admin';

/**
 * Enforces "any authenticated user may act on their OWN orders" — the owner
 * is the token subject that placed the order, or a caller with the `admin`
 * role. Throws `OrderForbiddenError` (mapped to HTTP 403) otherwise.
 */
export function assertOrderOwnership(order: Order, userId: string, roles: string[]): void {
  if (roles.includes(ADMIN_ROLE) || order.isOwnedBy(userId)) {
    return;
  }
  throw new OrderForbiddenError(order.id);
}
