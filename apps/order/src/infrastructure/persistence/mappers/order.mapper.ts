import { Order, type OrderStatus } from '@order/domain/order/order';
import { OrderItem } from '@order/domain/order/order-item';
import { OrderOrmEntity } from '@order/infrastructure/persistence/entities/order.orm-entity';
import { OrderItemOrmEntity } from '@order/infrastructure/persistence/entities/order-item.orm-entity';

export class OrderMapper {
  static toDomain(orm: OrderOrmEntity, itemRows: OrderItemOrmEntity[]): Order {
    return Order.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      userId: orm.userId,
      restaurantId: orm.restaurantId ?? '',
      status: orm.status as OrderStatus,
      items: itemRows.map((item) =>
        OrderItem.reconstitute({
          itemId: item.itemId,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
        }),
      ),
      subtotalCents: orm.subtotalCents,
      deliveryFeeCents: orm.deliveryFeeCents,
      vatCents: orm.vatCents,
      discountCents: orm.discountCents,
      totalCents: orm.totalCents,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  static toNewOrderOrm(order: Order): OrderOrmEntity {
    const orm = new OrderOrmEntity();
    orm.id = order.id;
    orm.tenantId = order.tenantId;
    orm.userId = order.userId;
    orm.restaurantId = order.restaurantId;
    orm.status = order.status;
    orm.subtotalCents = order.subtotalCents;
    orm.deliveryFeeCents = order.deliveryFeeCents;
    orm.vatCents = order.vatCents;
    orm.discountCents = order.discountCents;
    orm.totalCents = order.totalCents;
    return orm;
  }

  static toNewOrderItemOrms(order: Order): OrderItemOrmEntity[] {
    return order.items.map((item) => {
      const orm = new OrderItemOrmEntity();
      orm.orderId = order.id;
      orm.itemId = item.itemId;
      orm.qty = item.qty;
      orm.unitPriceCents = item.unitPriceCents;
      orm.lineTotalCents = item.lineTotalCents;
      return orm;
    });
  }
}
