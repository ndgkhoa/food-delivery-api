import { Inject, Injectable } from '@nestjs/common';
import type { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';

export interface ListOrdersQuery {
  tenantId: string;
  userId: string;
  limit: number;
}

@Injectable()
export class ListOrdersHandler {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository) {}

  execute(query: ListOrdersQuery): Promise<Order[]> {
    return this.orderRepository.findRecentByTenant(query.tenantId, query.userId, query.limit);
  }
}
