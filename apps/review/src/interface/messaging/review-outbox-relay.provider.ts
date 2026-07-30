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
import { REVIEW_EVENTS_TOPIC } from '@review/application/build-rating-changed-event';

/**
 * Owns the review service's polling-outbox relay lifecycle (mirrors order's
 * `OrderOutboxRelayProvider`). On bootstrap it ensures `review.events` exists,
 * then starts the relay loop that drains `review_outbox` and publishes each
 * row (key = restaurant id) to Kafka. Disabled under NODE_ENV=test (no broker).
 */
@Injectable()
export class ReviewOutboxRelayProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReviewOutboxRelayProvider.name);
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
      this.logger.warn('Review outbox relay disabled (NODE_ENV=test)');
      return;
    }
    await this.topicAdmin.ensureTopics([{ topic: REVIEW_EVENTS_TOPIC }]);
    this.relay.start();
    this.logger.log('Review outbox relay started');
  }

  onModuleDestroy(): void {
    this.relay.stop();
  }
}
