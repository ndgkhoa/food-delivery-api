import { Restaurant } from '@catalog/domain/restaurant/restaurant';

export interface RestaurantCacheSnapshot {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  rating: number;
  reviewCount: number;
  version: number;
}

export function toRestaurantCacheSnapshot(restaurant: Restaurant): RestaurantCacheSnapshot {
  return {
    id: restaurant.id,
    tenantId: restaurant.tenantId,
    name: restaurant.name,
    description: restaurant.description,
    isActive: restaurant.isActive,
    createdAt: restaurant.createdAt.toISOString(),
    updatedAt: restaurant.updatedAt.toISOString(),
    rating: restaurant.rating,
    reviewCount: restaurant.reviewCount,
    version: restaurant.version,
  };
}

export function fromRestaurantCacheSnapshot(snapshot: RestaurantCacheSnapshot): Restaurant {
  return Restaurant.reconstitute({
    id: snapshot.id,
    tenantId: snapshot.tenantId,
    name: snapshot.name,
    description: snapshot.description,
    isActive: snapshot.isActive,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: null,
    rating: snapshot.rating,
    reviewCount: snapshot.reviewCount,
    version: snapshot.version,
  });
}
