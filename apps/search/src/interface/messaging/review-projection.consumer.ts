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
import { applyReviewRatingEvent } from '@search/application/restaurant-search/apply-review-rating-event';
import {
  RESTAURANT_SEARCH_REPOSITORY,
  type RestaurantSearchRepository,
} from '@search/domain/restaurant-search/restaurant-search.repository';

const REVIEW_EVENTS_TOPIC = 'review.events';
/** Independent of `search-catalog-projection`'s group — a different topic with its own offsets. */
const PROJECTION_GROUP_ID = 'search-review-projection';

/**
 * Consumes `review.events` and updates the ES doc's `rating` field, alongside
 * (not replacing) `CatalogProjectionConsumer`'s `catalog.events` projection.
 * No dedupe ledger, same rationale as that consumer: the ES partial update is
 * idempotent by document id and a redelivery just re-applies the same value.
 */
@Injectable()
export class ReviewProjectionConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReviewProjectionConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    @Inject(RESTAURANT_SEARCH_REPOSITORY)
    private readonly repository: RestaurantSearchRepository,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Rating projection disabled (NODE_ENV=test): ${REVIEW_EVENTS_TOPIC} not consumed`,
      );
      return;
    }

    this.consumer = await this.subscriber.subscribe({
      groupId: PROJECTION_GROUP_ID,
      topics: [REVIEW_EVENTS_TOPIC],
      handler: ({ envelope, payload }) =>
        applyReviewRatingEvent(envelope, payload, this.repository),
    });
    this.logger.log(`Projecting ${REVIEW_EVENTS_TOPIC} into the restaurant search index`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
