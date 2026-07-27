import { GetRestaurantHandler } from '@catalog/application/restaurant/queries/get-restaurant.handler';
import type { Restaurant, UpdateRestaurantProps } from '@catalog/domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '@catalog/domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '@catalog/domain/shared/audit.port';
import { AuditAction } from '@catalog/domain/shared/audit-action';
import { Inject, Injectable } from '@nestjs/common';

export type UpdateRestaurantCommand = UpdateRestaurantProps;

@Injectable()
export class UpdateRestaurantHandler {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(AUDIT_PORT) private readonly auditPort: AuditPort,
    private readonly getRestaurant: GetRestaurantHandler,
  ) {}

  async execute(id: string, command: UpdateRestaurantCommand): Promise<Restaurant> {
    const before = await this.getRestaurant.execute(id);
    const updated = before.update(command);
    const saved = await this.restaurantRepository.save(updated);

    await this.auditPort.record({
      action: AuditAction.UPDATE,
      entity: 'restaurant',
      entityId: id,
      before: before.toSnapshot(),
      after: saved.toSnapshot(),
    });

    return saved;
  }
}
