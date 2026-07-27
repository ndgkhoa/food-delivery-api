import { Inject, Injectable } from '@nestjs/common';
import { assertOrderOwnership } from '@order/application/shared/assert-order-ownership';
import type { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import { OrderNotFoundError } from '@order/domain/shared/errors';

export interface GetOrderQuery {
  tenantId: string;
  userId: string;
  roles: string[];
  orderId: string;
}

/** Tenant-scoped order lookup, restricted to the order's owner or an admin. */
@Injectable()
export class GetOrderHandler {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository) {}

  async execute(query: GetOrderQuery): Promise<Order> {
    const order = await this.orderRepository.findById(query.tenantId, query.orderId);
    if (!order) {
      throw new OrderNotFoundError(query.orderId);
    }
    assertOrderOwnership(order, query.userId, query.roles);
    return order;
  }
}
