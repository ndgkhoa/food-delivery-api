import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { Restaurant, UpdateRestaurantProps } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';
import { OUTBOX_PORT, type OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

export type UpdateRestaurantCommand = UpdateRestaurantProps;

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
    const before = await this.getRestaurant.execute(id);
    const updated = before.update(command);

    // Write + audit + outbox share one commit boundary: the update and its
    // emitted event commit or roll back together.
    return this.transaction.runInTransaction(async () => {
      const saved = await this.restaurantRepository.save(updated);

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
