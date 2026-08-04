import type { Order } from '@order/domain/order/order';
import { OrderForbiddenError } from '@order/domain/shared/errors';

const ADMIN_ROLE = 'admin';

export function assertOrderOwnership(order: Order, userId: string, roles: string[]): void {
  if (roles.includes(ADMIN_ROLE) || order.isOwnedBy(userId)) {
    return;
  }
  throw new OrderForbiddenError(order.id);
}
