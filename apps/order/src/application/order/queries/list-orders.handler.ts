import { Inject, Injectable } from '@nestjs/common';
import type { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';

export interface ListOrdersQuery {
  tenantId: string;
  userId: string;
  limit: number;
}

/**
 * The caller's own order history, newest first. Lag-tolerant by nature (it
 * never surfaces a row the caller might have just written in this same
 * request), so the repository is free to serve it from a read replica — see
 * `TypeOrmOrderRepository.findRecentByTenant`.
 */
@Injectable()
export class ListOrdersHandler {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository) {}

  execute(query: ListOrdersQuery): Promise<Order[]> {
    return this.orderRepository.findRecentByTenant(query.tenantId, query.userId, query.limit);
  }
}
