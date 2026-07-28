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

/** All saga topics keyed by order id (3 partitions, RF=1) — ensured idempotently on boot. */
const SAGA_TOPICS = [
  'inventory.commands',
  'inventory.replies',
  'payment.commands',
  'payment.replies',
];

/**
 * Owns the order service's polling-outbox relay lifecycle. On bootstrap it
 * ensures every saga topic exists, then starts the relay loop that drains
 * `order_outbox` and publishes each row (key = order id) to Kafka. Not
 * auto-started by the shared lib on purpose — a service decides when its own
 * outbox schema is ready. Disabled under NODE_ENV=test (no broker).
 */
@Injectable()
export class OrderOutboxRelayProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderOutboxRelayProvider.name);
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
      this.logger.warn('Order outbox relay disabled (NODE_ENV=test)');
      return;
    }
    await this.topicAdmin.ensureTopics(SAGA_TOPICS.map((topic) => ({ topic })));
    this.relay.start();
    this.logger.log('Order outbox relay started');
  }

  onModuleDestroy(): void {
    this.relay.stop();
  }
}
