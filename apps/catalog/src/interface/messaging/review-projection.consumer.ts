import { applyReviewEvent } from '@catalog/application/projections/catalog-rating-projector';
import {
  READ_RESTAURANT_REPOSITORY,
  type ReadRestaurantRepository,
} from '@catalog/domain/read-model/read-restaurant.repository';
import { TRANSACTION_PORT, type TransactionPort } from '@catalog/domain/shared/transaction.port';
import { syncRestaurantCache } from '@catalog/interface/messaging/catalog-cache-sync';
import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { REDIS_CACHE, type RedisCache } from '@food-delivery-api/shared-cache';
import {
  IdempotentConsumer,
  KafkaConsumerSubscriber,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const REVIEW_EVENTS_TOPIC = 'review.events';
const PROJECTION_GROUP_ID = 'catalog-review-projection';

@Injectable()
export class ReviewProjectionConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReviewProjectionConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(READ_RESTAURANT_REPOSITORY)
    private readonly readRestaurants: ReadRestaurantRepository,
    @Inject(REDIS_CACHE) private readonly cache: RedisCache,
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
      handler: async ({ envelope, payload }) => {
        await this.transaction.runInTransaction(async () => {
          await IdempotentConsumer.runOnce(this.processedEvents, envelope.eventId, undefined, () =>
            applyReviewEvent(envelope, payload, this.readRestaurants),
          );
        });
        await syncRestaurantCache(
          envelope.eventType,
          envelope.aggregateId,
          envelope.tenantId,
          this.cache,
          this.readRestaurants,
        );
      },
    });
    this.logger.log(`Projecting ${REVIEW_EVENTS_TOPIC} into the catalog read model`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
