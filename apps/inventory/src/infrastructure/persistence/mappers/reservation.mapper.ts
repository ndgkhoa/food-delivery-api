import { Reservation, type ReservationStatus } from '@inventory/domain/reservation/reservation';
import { ReservationOrmEntity } from '@inventory/infrastructure/persistence/entities/reservation.orm-entity';

export class ReservationMapper {
  static toDomain(orm: ReservationOrmEntity): Reservation {
    return Reservation.reconstitute({
      id: orm.id,
      tenantId: orm.tenantId,
      orderId: orm.orderId,
      itemId: orm.itemId,
      qty: orm.qty,
      status: orm.status as ReservationStatus,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  static toOrm(domain: Reservation): ReservationOrmEntity {
    const orm = new ReservationOrmEntity();
    orm.id = domain.id;
    orm.tenantId = domain.tenantId;
    orm.orderId = domain.orderId;
    orm.itemId = domain.itemId;
    orm.qty = domain.qty;
    orm.status = domain.status;
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.updatedAt;
    return orm;
  }
}
