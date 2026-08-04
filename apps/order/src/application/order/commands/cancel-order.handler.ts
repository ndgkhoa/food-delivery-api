import { Inject, Injectable, Logger } from '@nestjs/common';
import { assertOrderOwnership } from '@order/application/shared/assert-order-ownership';
import type { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import { OrderNotFoundError } from '@order/domain/shared/errors';
import {
  INVENTORY_GATEWAY_PORT,
  type InventoryGatewayPort,
} from '@order/domain/shared/inventory-gateway.port';

export interface CancelOrderCommand {
  tenantId: string;
  userId: string;
  roles: string[];
  orderId: string;
}

@Injectable()
export class CancelOrderHandler {
  private readonly logger = new Logger(CancelOrderHandler.name);

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(INVENTORY_GATEWAY_PORT) private readonly inventoryGateway: InventoryGatewayPort,
  ) {}

  async execute(command: CancelOrderCommand): Promise<Order> {
    const order = await this.orderRepository.findById(command.tenantId, command.orderId);
    if (!order) {
      throw new OrderNotFoundError(command.orderId);
    }
    assertOrderOwnership(order, command.userId, command.roles);

    const saved = await this.orderRepository.updateStatus(order.cancel());

    try {
      await this.inventoryGateway.release(command.tenantId, command.orderId);
    } catch (error) {
      this.logger.error(
        `inventory release failed for cancelled order "${command.orderId}" — stock may remain held until manually reconciled`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return saved;
  }
}
