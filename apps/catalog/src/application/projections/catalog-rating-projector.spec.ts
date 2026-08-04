import { applyReviewEvent } from '@catalog/application/projections/catalog-rating-projector';
import type {
  ReadRestaurantRepository,
  ReadRestaurantRow,
} from '@catalog/domain/read-model/read-restaurant.repository';
import type { Restaurant } from '@catalog/domain/restaurant/restaurant';
import type { PageResult } from '@catalog/domain/shared/pagination';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';

class FakeReadRestaurantRepository implements ReadRestaurantRepository {
  readonly ratingUpdates: Array<{
    id: string;
    tenantId: string;
    rating: number;
    reviewCount: number;
  }> = [];

  async findById(): Promise<Restaurant | null> {
    return null;
  }
  async findAndCount(): Promise<PageResult<Restaurant>> {
    return { data: [], total: 0 };
  }
  async upsert(_row: ReadRestaurantRow): Promise<void> {}
  async remove(): Promise<void> {}
  async updateRating(
    id: string,
    tenantId: string,
    rating: number,
    reviewCount: number,
  ): Promise<void> {
    this.ratingUpdates.push({ id, tenantId, rating, reviewCount });
  }
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';

function envelope(eventType: string): EventEnvelopeHeaders {
  return {
    eventId: '33333333-3333-4333-8333-333333333333',
    eventType,
    aggregateId: restaurantId,
    tenantId,
    correlationId: '44444444-4444-4444-8444-444444444444',
    occurredAt: new Date().toISOString(),
  };
}

describe('applyReviewEvent', () => {
  let repository: FakeReadRestaurantRepository;

  beforeEach(() => {
    repository = new FakeReadRestaurantRepository();
  });

  it('writes the recomputed aggregate on RestaurantRatingChanged', async () => {
    await applyReviewEvent(
      envelope('RestaurantRatingChanged'),
      { avgRating: 4.33, reviewCount: 3 },
      repository,
    );

    expect(repository.ratingUpdates).toEqual([
      { id: restaurantId, tenantId, rating: 4.33, reviewCount: 3 },
    ]);
  });

  it('ignores an unknown event type without touching the repository', async () => {
    await applyReviewEvent(envelope('SomethingElse'), { avgRating: 5, reviewCount: 1 }, repository);

    expect(repository.ratingUpdates).toHaveLength(0);
  });
});
