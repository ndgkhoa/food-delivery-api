import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { KafkaConsumerSubscriber } from '@food-delivery-api/shared-messaging';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HandleInventoryReplyHandler } from '@order/application/saga/handle-inventory-reply.handler';

const INVENTORY_REPLIES_TOPIC = 'inventory.replies';
const CONSUMER_GROUP_ID = 'order-inventory-reply';

interface InventoryReplyPayload {
  orderId: string;
  reason?: string;
}

@Injectable()
export class InventoryReplyConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InventoryReplyConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly handler: HandleInventoryReplyHandler,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(`Saga inventory-reply consumer disabled (NODE_ENV=test)`);
      return;
    }
    this.consumer = await this.subscriber.subscribe<InventoryReplyPayload>({
      groupId: CONSUMER_GROUP_ID,
      topics: [INVENTORY_REPLIES_TOPIC],
      handler: ({ envelope, payload }) => this.handler.execute(envelope, payload),
    });
    this.logger.log(`Consuming ${INVENTORY_REPLIES_TOPIC} for the order saga`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
