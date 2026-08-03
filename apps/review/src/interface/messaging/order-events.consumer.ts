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
  type OrderConfirmedPayload,
  parseEligibleOrder,
} from '@review/application/parse-eligible-order';
import { RecordReviewEligibilityHandler } from '@review/application/record-review-eligibility.handler';

const ORDER_EVENTS_TOPIC = 'order.events';
/** Review's own consumer group — tails `order.events` with independent offsets. */
const CONSUMER_GROUP_ID = 'review-order-events';
const ORDER_CONFIRMED = 'OrderConfirmed';

/**
 * Consumes `order.events` and records a CONFIRMED order as review-eligible
 * (mirrors delivery's/notification's own `order.events` consumers on the same
 * topic, each with an independent consumer group). A straggler order
 * confirmed without a `restaurantId` (placed before that invariant existed)
 * is skipped — it is never review-eligible.
 */
@Injectable()
export class OrderEventsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly recordEligibility: RecordReviewEligibilityHandler,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Review eligibility recording disabled (NODE_ENV=test): ${ORDER_EVENTS_TOPIC} not consumed`,
      );
      return;
    }

    this.consumer = await this.subscriber.subscribe<OrderConfirmedPayload>({
      groupId: CONSUMER_GROUP_ID,
      topics: [ORDER_EVENTS_TOPIC],
      handler: ({ envelope, payload }) => this.handle(envelope, payload),
    });
    this.logger.log(`Recording review eligibility from ${ORDER_EVENTS_TOPIC}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private async handle(
    envelope: EventEnvelopeHeaders,
    payload: OrderConfirmedPayload,
  ): Promise<void> {
    if (envelope.eventType !== ORDER_CONFIRMED) {
      return;
    }
    const order = parseEligibleOrder(payload);
    if (!order) {
      this.logger.debug(
        `Skipping ${envelope.eventType} (event ${envelope.eventId}) — missing orderId/userId/restaurantId`,
      );
      return;
    }
    await this.recordEligibility.execute(envelope.eventId, envelope.tenantId, order);
  }
}
