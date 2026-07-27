import { Inject, Injectable } from '@nestjs/common';
import { assertOrderOwnership } from '@order/application/shared/assert-order-ownership';
import type { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import { OrderNotFoundError } from '@order/domain/shared/errors';

export interface ConfirmOrderCommand {
  tenantId: string;
  userId: string;
  roles: string[];
  orderId: string;
}

/** Confirms a reserved order (RESERVED → CONFIRMED) via an optimistic-lock save. */
@Injectable()
export class ConfirmOrderHandler {
  constructor(@Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository) {}

  async execute(command: ConfirmOrderCommand): Promise<Order> {
    const order = await this.orderRepository.findById(command.tenantId, command.orderId);
    if (!order) {
      throw new OrderNotFoundError(command.orderId);
    }
    assertOrderOwnership(order, command.userId, command.roles);

    return this.orderRepository.updateStatus(order.confirm());
  }
}
