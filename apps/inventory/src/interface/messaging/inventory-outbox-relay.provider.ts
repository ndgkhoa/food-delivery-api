import {
  KAFKA_PRODUCER,
  KafkaTopicAdmin,
  type MessageProducer,
  OUTBOX_PORT,
  type OutboxPort,
  OutboxRelay,
} from '@food-delivery-api/shared-messaging';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Topics inventory interacts with (consumes commands, produces replies). */
const INVENTORY_TOPICS = ['inventory.commands', 'inventory.replies'];

/**
 * Owns inventory's polling-outbox relay lifecycle. Ensures its topics exist,
 * then drains `inventory_outbox` to Kafka (key = order id). Disabled under
 * NODE_ENV=test.
 */
@Injectable()
export class InventoryOutboxRelayProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InventoryOutboxRelayProvider.name);
  private readonly relay: OutboxRelay;

  constructor(
    @Inject(OUTBOX_PORT) outbox: OutboxPort,
    @Inject(KAFKA_PRODUCER) producer: MessageProducer,
    private readonly topicAdmin: KafkaTopicAdmin,
    private readonly config: ConfigService,
  ) {
    this.relay = new OutboxRelay(outbox, producer);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('Inventory outbox relay disabled (NODE_ENV=test)');
      return;
    }
    await this.topicAdmin.ensureTopics(INVENTORY_TOPICS.map((topic) => ({ topic })));
    this.relay.start();
    this.logger.log('Inventory outbox relay started');
  }

  onModuleDestroy(): void {
    this.relay.stop();
  }
}
