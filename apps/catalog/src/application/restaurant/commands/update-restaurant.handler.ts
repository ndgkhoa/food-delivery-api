import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { Restaurant, UpdateRestaurantProps } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';
import { ConcurrencyConflictError } from '@catalog/domain/shared/errors';
import { OUTBOX_PORT, type OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

/**
 * `expectedVersion` is the client's optional `If-Match` value (the version it
 * last read) — distinct from the domain's own `update()` field changes, so
 * it's layered on here rather than polluting `UpdateRestaurantProps`.
 */
export type UpdateRestaurantCommand = UpdateRestaurantProps & { expectedVersion?: number };

@Injectable()
export class UpdateRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(OUTBOX_PORT) private readonly outboxWriter: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(id: string, command: UpdateRestaurantCommand): Promise<Restaurant> {
    const { expectedVersion, ...changes } = command;
    const before = await this.getRestaurant.execute(id);

    // Client sent a stale `If-Match`: fail fast before touching the DB. If
    // absent, only the save-time version guard below protects against a
    // concurrent in-flight write.
    if (expectedVersion !== undefined && expectedVersion !== before.version) {
      throw new ConcurrencyConflictError('Restaurant', id);
    }

    const updated = before.update(changes);

    // Write + audit + outbox share one commit boundary: the update and its
    // emitted event commit or roll back together. A version conflict thrown
    // by `updateVersioned` aborts before the audit/outbox writes, so a
    // rejected write never leaves a stray audit row.
    return this.transaction.runInTransaction(async () => {
      const saved = await this.restaurantRepository.updateVersioned(updated);

      await this.auditPort.record({
        action: AuditAction.UPDATE,
        entity: 'restaurant',
        entityId: id,
        before: before.toSnapshot(),
        after: saved.toSnapshot(),
      });
      await this.outboxWriter.write(CatalogEventFactory.restaurantUpdated(saved));

      return saved;
    });
  }
}
