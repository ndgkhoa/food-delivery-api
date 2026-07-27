import type { Order } from '@order/domain/order/order';
import type { OrderResponse } from '@order/interface/http/dto/order.response';

export class OrderResponseMapper {
  static toResponse(order: Order): OrderResponse {
    return {
      id: order.id,
      tenantId: order.tenantId,
      userId: order.userId,
      status: order.status,
      items: order.items.map((item) => ({
        itemId: item.itemId,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
      })),
      totalCents: order.totalCents,
      version: order.version,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
