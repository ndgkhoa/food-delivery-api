import { applyCatalogEvent } from '@catalog/application/projections/catalog-read-model-projector';
import {
  READ_MENU_ITEM_REPOSITORY,
  type ReadMenuItemRepository,
} from '@catalog/domain/read-model/read-menu-item.repository';
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

const CATALOG_EVENTS_TOPIC = 'catalog.events';
const PROJECTION_GROUP_ID = 'catalog-projection';

/**
 * Consumes `catalog.events` and projects each event into the read model. The
 * subscriber already runs the handler inside the tenant scope carried by the
 * envelope. Per message we open one transaction and, inside it, dedupe by event
 * id (`processed_events`) before applying the effect — so "processed" and the
 * read-model change commit or roll back together, making re-delivery a no-op.
 */
@Injectable()
export class CatalogProjectionConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CatalogProjectionConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(READ_RESTAURANT_REPOSITORY)
    private readonly readRestaurants: ReadRestaurantRepository,
    @Inject(READ_MENU_ITEM_REPOSITORY) private readonly readMenuItems: ReadMenuItemRepository,
    @Inject(REDIS_CACHE) private readonly cache: RedisCache,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // In-process integration tests boot the module graph without a broker; the
    // compose-based e2e (and real runtime) run outside NODE_ENV=test. Logged
    // (not silent) so a mis-set NODE_ENV in a real env is visible, not a ghost.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Read-model projection disabled (NODE_ENV=test): ${CATALOG_EVENTS_TOPIC} not consumed`,
      );
      return;
    }

    this.consumer = await this.subscriber.subscribe({
      groupId: PROJECTION_GROUP_ID,
      topics: [CATALOG_EVENTS_TOPIC],
      handler: async ({ envelope, payload }) => {
        await this.transaction.runInTransaction(async () => {
          await IdempotentConsumer.runOnce(this.processedEvents, envelope.eventId, undefined, () =>
            applyCatalogEvent(envelope, payload, {
              restaurants: this.readRestaurants,
              menuItems: this.readMenuItems,
            }),
          );
        });
        // Write-through/evict AFTER the commit — Redis has no transactional tie
        // to Postgres, so syncing before commit could warm the cache with a
        // value a rollback then makes wrong.
        await syncRestaurantCache(
          envelope.eventType,
          envelope.aggregateId,
          envelope.tenantId,
          this.cache,
          this.readRestaurants,
        );
      },
    });
    this.logger.log(`Projecting ${CATALOG_EVENTS_TOPIC} into the catalog read model`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
