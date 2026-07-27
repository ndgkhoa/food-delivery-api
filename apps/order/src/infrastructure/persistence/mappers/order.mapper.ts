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
      status: orm.status as OrderStatus,
      items: itemRows.map((item) =>
        OrderItem.reconstitute({
          itemId: item.itemId,
          qty: item.qty,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
        }),
      ),
      totalCents: orm.totalCents,
      version: orm.version,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  /**
   * Builds the brand-new order row for the FIRST insert. `version` is left
   * unset so the DB column default (1) applies and is read back after insert
   * — `Order.create()`'s transient `version: 0` is never written.
   */
  static toNewOrderOrm(order: Order): OrderOrmEntity {
    const orm = new OrderOrmEntity();
    orm.id = order.id;
    orm.tenantId = order.tenantId;
    orm.userId = order.userId;
    orm.status = order.status;
    orm.totalCents = order.totalCents;
    return orm;
  }

  /** Builds the (immutable, write-once) item rows for the FIRST insert of an order. */
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
