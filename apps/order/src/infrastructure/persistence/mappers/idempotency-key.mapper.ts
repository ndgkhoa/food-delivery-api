import { IdempotencyKeyOrmEntity } from '@order/infrastructure/persistence/entities/idempotency-key.orm-entity';

/** Trivial by design — the domain has no aggregate for this mapping, only a repository port. */
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
