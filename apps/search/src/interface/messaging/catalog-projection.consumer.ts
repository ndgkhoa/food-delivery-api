import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaConsumerSubscriber } from '@food-delivery-api/shared-messaging';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { applyRestaurantSearchEvent } from '@search/application/restaurant-search/apply-restaurant-search-event';
import {
  RESTAURANT_SEARCH_REPOSITORY,
  type RestaurantSearchRepository,
} from '@search/domain/restaurant-search/restaurant-search.repository';

const CATALOG_EVENTS_TOPIC = 'catalog.events';
/**
 * A dedicated consumer group, independent of catalog's own `catalog-projection`
 * group — search tails the same topic with its own offsets so the two read
 * models advance separately.
 */
const PROJECTION_GROUP_ID = 'search-catalog-projection';

/**
 * Consumes `catalog.events` and projects each restaurant event into the ES
 * search index. The subscriber runs the handler inside the tenant scope the
 * envelope carries. No dedupe ledger: ES upserts are idempotent by document id,
 * and per-aggregate ordering (Kafka key = restaurant id → one partition) plus
 * external versioning (see the repository adapter) make a redelivered or
 * out-of-order event a safe no-op — Delete is the terminal state.
 */
@Injectable()
export class CatalogProjectionConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CatalogProjectionConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    @Inject(RESTAURANT_SEARCH_REPOSITORY)
    private readonly repository: RestaurantSearchRepository,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // In-process integration tests boot the module graph without a broker; the
    // compose-based e2e (and real runtime) run outside NODE_ENV=test. Logged
    // (not silent) so a mis-set NODE_ENV in a real env is visible.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Search projection disabled (NODE_ENV=test): ${CATALOG_EVENTS_TOPIC} not consumed`,
      );
      return;
    }

    this.consumer = await this.subscriber.subscribe({
      groupId: PROJECTION_GROUP_ID,
      topics: [CATALOG_EVENTS_TOPIC],
      handler: ({ envelope, payload }) =>
        applyRestaurantSearchEvent(envelope, payload, this.repository),
    });
    this.logger.log(`Projecting ${CATALOG_EVENTS_TOPIC} into the restaurant search index`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
