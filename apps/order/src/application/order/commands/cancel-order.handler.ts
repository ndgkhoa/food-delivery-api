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

/**
 * Cancels an order (PENDING/RESERVED → CANCELLED) and releases any inventory
 * hold. The state transition + optimistic-lock save happens first so the
 * order's terminal state is never in doubt; the inventory release follows and
 * is logged (not re-thrown) on failure — a downstream release fault must not
 * strand an already-cancelled order in an unrecoverable error response. This
 * best-effort gap is the same synchronous-coupling trade-off the phase plan
 * documents as the motivation for the future Saga (P3).
 */
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

    const saved = await this.orderRepository.save(order.cancel());

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
