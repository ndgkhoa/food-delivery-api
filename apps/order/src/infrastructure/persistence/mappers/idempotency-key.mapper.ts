import { IdempotencyKeyOrmEntity } from '@order/infrastructure/persistence/entities/idempotency-key.orm-entity';

export class IdempotencyKeyMapper {
  static toOrm(
    tenantId: string,
    userId: string,
    key: string,
    orderId: string,
  ): IdempotencyKeyOrmEntity {
    const orm = new IdempotencyKeyOrmEntity();
    orm.tenantId = tenantId;
    orm.userId = userId;
    orm.key = key;
    orm.orderId = orderId;
    return orm;
  }
}
