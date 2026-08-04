import { randomUUID } from 'node:crypto';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { CatalogEventFactory } from '@catalog/domain/shared/catalog-event.factory';
import { OUTBOX_PORT, type OutboxWriter } from '@catalog/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import { Inject, Injectable } from '@nestjs/common';

export interface CreateRestaurantCommand {
  name: string;
  description?: string;
  isActive?: boolean;
}

@Injectable()
export class CreateRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    @Inject(OUTBOX_PORT) private readonly outboxWriter: OutboxWriter,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(command: CreateRestaurantCommand): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const restaurant = Restaurant.create({ id: randomUUID(), tenantId, ...command });

    return this.transaction.runInTransaction(async () => {
      const saved = await this.restaurantRepository.save(restaurant);

      await this.auditPort.record({
        action: AuditAction.CREATE,
        entity: 'restaurant',
        entityId: saved.id,
        after: saved.toSnapshot(),
      });
      await this.outboxWriter.write(CatalogEventFactory.restaurantCreated(saved));

      return saved;
    });
  }
}
