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

const PAYMENT_TOPICS = ['payment.commands', 'payment.replies'];

@Injectable()
export class PaymentOutboxRelayProvider implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentOutboxRelayProvider.name);
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
      this.logger.warn('Payment outbox relay disabled (NODE_ENV=test)');
      return;
    }
    await this.topicAdmin.ensureTopics(PAYMENT_TOPICS.map((topic) => ({ topic })));
    this.relay.start();
    this.logger.log('Payment outbox relay started');
  }

  onModuleDestroy(): void {
    this.relay.stop();
  }
}
