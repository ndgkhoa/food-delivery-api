import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { Restaurant, UpdateRestaurantProps } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { Inject, Injectable } from '@nestjs/common';

export type UpdateRestaurantCommand = UpdateRestaurantProps;

@Injectable()
export class UpdateRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(id: string, command: UpdateRestaurantCommand): Promise<Restaurant> {
    const before = await this.getRestaurant.execute(id);
    const updated = before.update(command);

    // Write + audit share one commit boundary: if the audit insert fails, the update is rolled back.
    return this.transaction.runInTransaction(async () => {
      const saved = await this.restaurantRepository.save(updated);

      await this.auditPort.record({
        action: AuditAction.UPDATE,
        entity: 'restaurant',
        entityId: id,
        before: before.toSnapshot(),
        after: saved.toSnapshot(),
      });

      return saved;
    });
  }
}
