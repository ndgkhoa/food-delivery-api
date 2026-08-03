import type { estypes } from '@elastic/elasticsearch';
import { Client, errors } from '@elastic/elasticsearch';
import { Inject, Injectable } from '@nestjs/common';
import type { RestaurantSearchRepository } from '@search/domain/restaurant-search/restaurant-search.repository';
import type {
  RestaurantAutocompleteQuery,
  RestaurantAutocompleteSuggestion,
  RestaurantSearchDocument,
  RestaurantSearchHit,
  RestaurantSearchQuery,
  RestaurantSearchResult,
} from '@search/domain/restaurant-search/restaurant-search-document';
import {
  ELASTICSEARCH_CLIENT,
  RESTAURANTS_INDEX,
} from '@search/infrastructure/elasticsearch/elasticsearch.tokens';
import {
  buildRestaurantAutocompleteBody,
  buildRestaurantSearchBody,
} from '@search/infrastructure/elasticsearch/restaurant-search-query-builder';

/** The `_source` stored per restaurant (id is the document `_id`; version is ES metadata). */
interface RestaurantIndexSource {
  tenantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;

/**
 * Elasticsearch adapter for the restaurant search read model. Writes use
 * `external_gte` versioning (`version` = event occurrence time in epoch millis):
 * ES rejects a write whose version is strictly OLDER than the stored one, so a
 * redelivered or out-of-order event can't overwrite fresher state nor resurrect
 * a delete — while an EQUAL version (two writes in the same millisecond, or a
 * genuine redelivery) is still accepted, so a legitimate same-ms update is not
 * silently dropped. Epoch-millis (logical event time) is chosen over the Kafka
 * offset so the guard survives a topic re-creation (offsets reset to 0, the
 * clock does not). Per-aggregate Kafka ordering (key = restaurant id → one
 * partition) makes conflicts near-impossible anyway; this is belt-and-suspenders.
 * Writes are idempotent by id, so no dedupe ledger is needed.
 */
@Injectable()
export class ElasticsearchRestaurantSearchRepository implements RestaurantSearchRepository {
  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  /**
   * Projects a `catalog.events` restaurant create/update. catalog.events owns
   * every field EXCEPT `rating`, which is owned by `review.events` (see
   * `updateRating`). A full `index` would REPLACE the whole document and wipe a
   * review-sourced rating on an ordinary edit (name/description change), so this
   * is a partial update: `doc` (no `rating`) merges into an existing document —
   * preserving its rating — while `upsert` seeds a brand-new document with
   * `rating: 0`. The Update API has no external-version support, so this path
   * drops the `external_gte` guard and relies on per-restaurant Kafka ordering
   * (key = restaurant id → one partition), the same primary guard `updateRating`
   * already relies on; `retry_on_conflict` covers the rare internal-version race.
   */
  async upsert(document: RestaurantSearchDocument): Promise<void> {
    const details = {
      tenantId: document.tenantId,
      name: document.name,
      description: document.description,
      isActive: document.isActive,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
    await this.client.update({
      index: RESTAURANTS_INDEX,
      id: document.id,
      retry_on_conflict: 3,
      doc: details,
      upsert: { ...details, rating: 0 } satisfies RestaurantIndexSource,
    });
  }

  /**
   * Partial update of the `rating` field only (see the port doc). Uses the ES
   * `update` API (`doc` merge), not `index` + external versioning like
   * `upsert`/`remove` — the Update API has no external-version support, and
   * this event's payload never carries the full document anyway. Recompute-
   * from-source on the publisher side plus this being an unconditional
   * last-write-wins overwrite make a redelivered or slightly out-of-order
   * event a safe (if occasionally stale-for-a-moment) no-op — an accepted,
   * documented eventual-consistency trade-off.
   */
  async updateRating(id: string, _tenantId: string, rating: number): Promise<void> {
    try {
      await this.client.update({
        index: RESTAURANTS_INDEX,
        id,
        doc: { rating } satisfies Partial<RestaurantIndexSource>,
      });
    } catch (error) {
      // Restaurant not yet indexed (race with the catalog projection): no
      // permanent effect to apply — this is a genuine no-op, not a failure.
      if (this.isStatus(error, HTTP_NOT_FOUND)) {
        return;
      }
      throw error;
    }
  }

  async remove(id: string, _tenantId: string, version: number): Promise<void> {
    try {
      await this.client.delete({
        index: RESTAURANTS_INDEX,
        id,
        version,
        version_type: 'external_gte',
      });
    } catch (error) {
      // Already gone (404) or superseded by a newer event (409): both terminal,
      // both idempotent no-ops. Delete is the terminal state for an aggregate.
      if (this.isStatus(error, HTTP_NOT_FOUND) || this.isStatus(error, HTTP_CONFLICT)) {
        return;
      }
      throw error;
    }
  }

  async search(query: RestaurantSearchQuery): Promise<RestaurantSearchResult> {
    let response: estypes.SearchResponse<RestaurantIndexSource>;
    try {
      response = await this.client.search<RestaurantIndexSource>({
        index: RESTAURANTS_INDEX,
        ...buildRestaurantSearchBody(query),
      });
    } catch (error) {
      // Index not yet bootstrapped (service just started, nothing projected):
      // an empty page is the correct answer, not a 500.
      if (this.isStatus(error, HTTP_NOT_FOUND)) {
        return { data: [], total: 0, page: query.page, limit: query.limit };
      }
      throw error;
    }

    return {
      data: response.hits.hits.map((hit) => this.toHit(hit)),
      total: this.totalHits(response),
      page: query.page,
      limit: query.limit,
    };
  }

  async autocomplete(
    query: RestaurantAutocompleteQuery,
  ): Promise<RestaurantAutocompleteSuggestion[]> {
    let response: estypes.SearchResponse<RestaurantIndexSource>;
    try {
      response = await this.client.search<RestaurantIndexSource>({
        index: RESTAURANTS_INDEX,
        ...buildRestaurantAutocompleteBody(query),
      });
    } catch (error) {
      if (this.isStatus(error, HTTP_NOT_FOUND)) {
        return [];
      }
      throw error;
    }

    return response.hits.hits
      .filter((hit): hit is typeof hit & { _source: RestaurantIndexSource } => hit._source != null)
      .map((hit) => ({ id: hit._id as string, name: hit._source.name }));
  }

  private toHit(hit: estypes.SearchHit<RestaurantIndexSource>): RestaurantSearchHit {
    const source = hit._source;
    return {
      id: hit._id as string,
      name: source?.name ?? '',
      description: source?.description ?? null,
      isActive: source?.isActive ?? false,
      rating: source?.rating ?? 0,
      score: hit._score ?? 0,
    };
  }

  private totalHits(response: estypes.SearchResponse<RestaurantIndexSource>): number {
    const total = response.hits.total;
    if (typeof total === 'number') {
      return total;
    }
    return total?.value ?? 0;
  }

  private isStatus(error: unknown, statusCode: number): boolean {
    return error instanceof errors.ResponseError && error.statusCode === statusCode;
  }
}
