import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaConsumerSubscriber } from '@food-delivery-api/shared-messaging';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HandlePaymentReplyHandler } from '@order/application/saga/handle-payment-reply.handler';

const PAYMENT_REPLIES_TOPIC = 'payment.replies';
const CONSUMER_GROUP_ID = 'order-payment-reply';

interface PaymentReplyPayload {
  orderId: string;
  reason?: string;
}

@Injectable()
export class PaymentReplyConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReplyConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly handler: HandlePaymentReplyHandler,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(`Saga payment-reply consumer disabled (NODE_ENV=test)`);
      return;
    }
    this.consumer = await this.subscriber.subscribe<PaymentReplyPayload>({
      groupId: CONSUMER_GROUP_ID,
      topics: [PAYMENT_REPLIES_TOPIC],
      handler: ({ envelope, payload }) => this.handler.execute(envelope, payload),
    });
    this.logger.log(`Consuming ${PAYMENT_REPLIES_TOPIC} for the order saga`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
