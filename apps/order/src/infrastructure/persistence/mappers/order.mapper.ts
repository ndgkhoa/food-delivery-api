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
      // A NULL column means this row predates the restaurantId invariant — the
      // aggregate's field is a required `string`, so it reconstitutes as ''
      // rather than null. Such a straggler order is never newly reviewable
      // (review eligibility only starts from a post-migration OrderConfirmed
      // event), so this placeholder never leaks into a real feature.
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
    orm.restaurantId = order.restaurantId;
    orm.status = order.status;
    orm.subtotalCents = order.subtotalCents;
    orm.deliveryFeeCents = order.deliveryFeeCents;
    orm.vatCents = order.vatCents;
    orm.discountCents = order.discountCents;
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
