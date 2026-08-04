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
const PROJECTION_GROUP_ID = 'search-catalog-projection';

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
