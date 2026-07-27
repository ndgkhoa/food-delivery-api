import { randomUUID } from 'node:crypto';
import { Restaurant } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import {
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@catalog/domain/shared/tenant-context.port';
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
  ) {}

  async execute(command: CreateRestaurantCommand): Promise<Restaurant> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const restaurant = Restaurant.create({ id: randomUUID(), tenantId, ...command });
    const saved = await this.restaurantRepository.save(restaurant);

    await this.auditPort.record({
      action: AuditAction.CREATE,
      entity: 'restaurant',
      entityId: saved.id,
      after: saved.toSnapshot(),
    });

    return saved;
  }
}
