import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import { applyReviewRatingEvent } from '@search/application/restaurant-search/apply-review-rating-event';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';
import type {
  RestaurantAutocompleteQuery,
  RestaurantAutocompleteSuggestion,
  RestaurantSearchDocument,
  RestaurantSearchQuery,
  RestaurantSearchResult,
} from '@search/domain/restaurant-search/restaurant-search-document';

class RecordingRepository implements RestaurantSearchRepository {
  ratingUpdates: Array<{ id: string; tenantId: string; rating: number }> = [];

  async upsert(_document: RestaurantSearchDocument): Promise<void> {}
  async remove(_id: string, _tenantId: string, _version: number): Promise<void> {}
  async search(_query: RestaurantSearchQuery): Promise<RestaurantSearchResult> {
    throw new Error('not used');
  }
  async autocomplete(
    _query: RestaurantAutocompleteQuery,
  ): Promise<RestaurantAutocompleteSuggestion[]> {
    throw new Error('not used');
  }
  async updateRating(id: string, tenantId: string, rating: number): Promise<void> {
    this.ratingUpdates.push({ id, tenantId, rating });
  }
}

function envelope(eventType: string): EventEnvelopeHeaders {
  return {
    eventId: 'evt-1',
    eventType,
    aggregateId: 'rest-1',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    occurredAt: '2026-07-28T10:00:00.000Z',
  };
}

describe('applyReviewRatingEvent', () => {
  let repo: RecordingRepository;

  beforeEach(() => {
    repo = new RecordingRepository();
  });

  it('updates the rating field on RestaurantRatingChanged', async () => {
    await applyReviewRatingEvent(
      envelope('RestaurantRatingChanged'),
      { avgRating: 4.5, reviewCount: 2 },
      repo,
    );

    expect(repo.ratingUpdates).toEqual([{ id: 'rest-1', tenantId: 'tenant-1', rating: 4.5 }]);
  });

  it('ignores an unknown event type without touching the repository', async () => {
    await applyReviewRatingEvent(
      envelope('SomethingElse'),
      { avgRating: 4.5, reviewCount: 2 },
      repo,
    );

    expect(repo.ratingUpdates).toHaveLength(0);
  });
});
