import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { RestaurantResponse } from '@catalog/interface/http/dto/restaurant.response';

export class RestaurantResponseMapper {
  static toResponse(restaurant: Restaurant): RestaurantResponse {
    return {
      id: restaurant.id,
      tenantId: restaurant.tenantId,
      name: restaurant.name,
      description: restaurant.description,
      isActive: restaurant.isActive,
      rating: restaurant.rating,
      reviewCount: restaurant.reviewCount,
      version: restaurant.version,
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt,
    };
  }
}
