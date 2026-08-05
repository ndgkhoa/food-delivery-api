import {
  IngestOrderEventHandler,
  type IngestOrderEventInput,
} from '@analytics/application/ingest-order-event.handler';
import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  type EventEnvelopeHeaders,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ORDER_EVENTS_TOPIC = 'order.events';
const CONSUMER_GROUP_ID = 'analytics-order-events';
const ORDER_CONFIRMED = 'OrderConfirmed';
const ORDER_CANCELLED = 'OrderCancelled';

interface OrderLifecyclePayload {
  orderId: string;
  userId: string;
  totalCents: number;
  restaurantId?: string;
}

@Injectable()
export class OrderEventsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly ingest: IngestOrderEventHandler,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(`Ingest disabled (NODE_ENV=test): ${ORDER_EVENTS_TOPIC} not consumed`);
      return;
    }
    this.consumer = await this.subscriber.subscribe<Partial<OrderLifecyclePayload>>({
      groupId: CONSUMER_GROUP_ID,
      topics: [ORDER_EVENTS_TOPIC],
      fromBeginning: true,
      handler: ({ envelope, payload }) => this.handle(envelope, payload),
    });
    this.logger.log(`Ingesting orders_fact rows from ${ORDER_EVENTS_TOPIC}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private async handle(
    envelope: EventEnvelopeHeaders,
    payload: Partial<OrderLifecyclePayload>,
  ): Promise<void> {
    if (envelope.eventType !== ORDER_CONFIRMED && envelope.eventType !== ORDER_CANCELLED) {
      return;
    }
    if (!payload.orderId || !payload.userId || typeof payload.totalCents !== 'number') {
      throw new Error(
        `${envelope.eventType} missing orderId/userId/totalCents (event ${envelope.eventId})`,
      );
    }
    const input: IngestOrderEventInput = {
      orderId: payload.orderId,
      userId: payload.userId,
      totalCents: payload.totalCents,
      restaurantId: payload.restaurantId,
      status: envelope.eventType === ORDER_CONFIRMED ? 'CONFIRMED' : 'CANCELLED',
    };
    await this.ingest.execute(envelope, input);
  }
}
