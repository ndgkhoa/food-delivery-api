import { Inject, Injectable } from '@nestjs/common';
import type { Restaurant, UpdateRestaurantProps } from '../../../domain/restaurant/restaurant';
import {
  RESTAURANT_REPOSITORY,
  type RestaurantRepository,
} from '../../../domain/restaurant/restaurant.repository';
import { AUDIT_PORT, type AuditPort } from '../../../domain/shared/audit.port';
import { AuditAction } from '../../../domain/shared/audit-action';
import { GetRestaurantHandler } from '../queries/get-restaurant.handler';

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
