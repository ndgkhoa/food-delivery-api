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

  async upsert(document: RestaurantSearchDocument): Promise<void> {
    const source: RestaurantIndexSource = {
      tenantId: document.tenantId,
      name: document.name,
      description: document.description,
      isActive: document.isActive,
      rating: document.rating,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
    try {
      await this.client.index({
        index: RESTAURANTS_INDEX,
        id: document.id,
        document: source,
        version: document.version,
        version_type: 'external_gte',
      });
    } catch (error) {
      // A version conflict means a strictly newer state already applied — the
      // stale event is a safe no-op, not a failure.
      if (this.isStatus(error, HTTP_CONFLICT)) {
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
