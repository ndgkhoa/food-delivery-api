import type { Restaurant } from '../../../domain/restaurant/restaurant';
import type { RestaurantResponse } from '../dto/restaurant.response';

export class RestaurantResponseMapper {
  static toResponse(restaurant: Restaurant): RestaurantResponse {
    return {
      id: restaurant.id,
      tenantId: restaurant.tenantId,
      name: restaurant.name,
      description: restaurant.description,
      isActive: restaurant.isActive,
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
    };
  }
}
