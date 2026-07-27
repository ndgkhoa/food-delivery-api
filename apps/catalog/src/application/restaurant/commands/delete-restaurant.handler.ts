import { Inject, Injectable } from '@nestjs/common';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '../../../domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '../../../domain/shared/audit.port';
import { AuditAction } from '../../../domain/shared/audit-action';
import { GetRestaurantHandler } from '../queries/get-restaurant.handler';

@Injectable()
export class DeleteRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(id: string): Promise<void> {
    const before = await this.getRestaurant.execute(id);
    await this.restaurantRepository.softDelete(before.id, before.tenantId);

    await this.auditPort.record({
      action: AuditAction.DELETE,
      entity: 'restaurant',
      entityId: id,
      before: before.toSnapshot(),
    });
  }
}
