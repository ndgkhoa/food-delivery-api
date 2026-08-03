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
import {
  DispatchOrderEventHandler,
  ORDER_CANCELLED,
  ORDER_CONFIRMED,
  type OrderLifecyclePayload,
} from '@notification/application/dispatch-order-event.handler';

const ORDER_EVENTS_TOPIC = 'order.events';
/** Notification's own consumer group — tails `order.events` with independent offsets. */
const CONSUMER_GROUP_ID = 'notification-order-events';

/**
 * Consumes `order.events` and fans a CONFIRMED/CANCELLED lifecycle event out
 * to per-channel notifications (mirrors delivery's driver-assignment consumer
 * on the same topic). Disabled under NODE_ENV=test (no broker) — the compose
 * e2e + real runtime run outside it.
 */
@Injectable()
export class OrderEventsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly dispatch: DispatchOrderEventHandler,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Notification dispatch disabled (NODE_ENV=test): ${ORDER_EVENTS_TOPIC} not consumed`,
      );
      return;
    }
    this.consumer = await this.subscriber.subscribe<Partial<OrderLifecyclePayload>>({
      groupId: CONSUMER_GROUP_ID,
      topics: [ORDER_EVENTS_TOPIC],
      handler: ({ envelope, payload }) => this.handle(envelope, payload),
    });
    this.logger.log(`Dispatching notifications from ${ORDER_EVENTS_TOPIC}`);
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
    if (!payload.orderId || !payload.userId) {
      this.logger.warn(
        `Skipping ${envelope.eventType} with missing orderId/userId (event ${envelope.eventId})`,
      );
      return;
    }
    await this.dispatch.execute(envelope, { orderId: payload.orderId, userId: payload.userId });
  }
}
