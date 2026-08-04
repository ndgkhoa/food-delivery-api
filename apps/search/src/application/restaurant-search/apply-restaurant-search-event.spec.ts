import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import { applyRestaurantSearchEvent } from '@search/application/restaurant-search/apply-restaurant-search-event';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';
import type {
  RestaurantAutocompleteQuery,
  RestaurantAutocompleteSuggestion,
  RestaurantSearchDocument,
  RestaurantSearchQuery,
  RestaurantSearchResult,
} from '@search/domain/restaurant-search/restaurant-search-document';

class RecordingRepository implements RestaurantSearchRepository {
  upserts: RestaurantSearchDocument[] = [];
  removals: Array<{ id: string; tenantId: string; version: number }> = [];

  async upsert(document: RestaurantSearchDocument): Promise<void> {
    this.upserts.push(document);
  }
  async remove(id: string, tenantId: string, version: number): Promise<void> {
    this.removals.push({ id, tenantId, version });
  }
  async search(_query: RestaurantSearchQuery): Promise<RestaurantSearchResult> {
    throw new Error('not used');
  }
  async autocomplete(
    _query: RestaurantAutocompleteQuery,
  ): Promise<RestaurantAutocompleteSuggestion[]> {
    throw new Error('not used');
  }
  async updateRating(): Promise<void> {}
}

const OCCURRED_AT = '2026-07-28T10:00:00.000Z';
const EXPECTED_VERSION = Date.parse(OCCURRED_AT);

function envelope(eventType: string): EventEnvelopeHeaders {
  return {
    eventId: 'evt-1',
    eventType,
    aggregateId: 'rest-1',
    tenantId: 'tenant-1',
    correlationId: 'corr-1',
    occurredAt: OCCURRED_AT,
  };
}

const snapshot = {
  name: 'Phở Hà Nội',
  description: 'Authentic',
  isActive: true,
  createdAt: '2026-07-28T09:00:00.000Z',
  updatedAt: '2026-07-28T09:30:00.000Z',
};

describe('applyRestaurantSearchEvent', () => {
  let repo: RecordingRepository;

  beforeEach(() => {
    repo = new RecordingRepository();
  });

  it.each(['RestaurantCreated', 'RestaurantUpdated'])(
    'upserts a doc for %s with tenant + id from the envelope and rating 0',
    async (eventType) => {
      await applyRestaurantSearchEvent(envelope(eventType), snapshot, repo);

      expect(repo.removals).toHaveLength(0);
      expect(repo.upserts).toEqual([
        {
          id: 'rest-1',
          tenantId: 'tenant-1',
          name: 'Phở Hà Nội',
          description: 'Authentic',
          isActive: true,
          rating: 0,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.updatedAt,
          version: EXPECTED_VERSION,
        },
      ]);
    },
  );

  it('removes the doc on RestaurantDeleted using envelope id + tenant + version', async () => {
    await applyRestaurantSearchEvent(envelope('RestaurantDeleted'), snapshot, repo);

    expect(repo.upserts).toHaveLength(0);
    expect(repo.removals).toEqual([
      { id: 'rest-1', tenantId: 'tenant-1', version: EXPECTED_VERSION },
    ]);
  });

  it.each(['MenuItemCreated', 'MenuItemUpdated', 'MenuItemDeleted', 'SomethingUnknown'])(
    'ignores %s (restaurants-only slice) without touching the repository',
    async (eventType) => {
      await applyRestaurantSearchEvent(envelope(eventType), snapshot, repo);

      expect(repo.upserts).toHaveLength(0);
      expect(repo.removals).toHaveLength(0);
    },
  );

  it('derives a monotonic version from occurredAt for ordering guards', async () => {
    await applyRestaurantSearchEvent(envelope('RestaurantCreated'), snapshot, repo);
    expect(repo.upserts[0].version).toBe(EXPECTED_VERSION);
  });
});
