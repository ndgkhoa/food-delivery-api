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
/** Analytics' own consumer group — tails `order.events` with independent offsets. */
const CONSUMER_GROUP_ID = 'analytics-order-events';
const ORDER_CONFIRMED = 'OrderConfirmed';
const ORDER_CANCELLED = 'OrderCancelled';

/** The `order.events` lifecycle payload fields the fact table needs. */
interface OrderLifecyclePayload {
  orderId: string;
  userId: string;
  totalCents: number;
  /** Absent for a straggler order placed before the restaurantId invariant existed. */
  restaurantId?: string;
}

/**
 * Consumes `order.events` and turns each `OrderConfirmed`/`OrderCancelled`
 * into one `orders_fact` row (mirrors notification's/review's own
 * `order.events` consumers on the same topic, each with an independent
 * consumer group). Reads from the beginning: a fresh consumer group must
 * replay the whole topic to rebuild the analytics read model from scratch
 * (e.g. after a ClickHouse reset), the same rationale as the settings-client
 * cache-invalidation consumer. Redelivery-safe by the ClickHouse table's
 * ReplacingMergeTree engine, not by a ledger here.
 */
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
      // A malformed/other event type on this topic is skipped, not fatal —
      // the partition must keep advancing.
      return;
    }
    if (!payload.orderId || !payload.userId || typeof payload.totalCents !== 'number') {
      // A valid-TYPE lifecycle event that fails field validation is a producer
      // contract violation, not an ignorable other-type event — throw so the
      // shared consumer retries then dead-letters it (observable), rather than
      // silently skip-committing an order that would then never reach analytics.
      throw new Error(
        `${envelope.eventType} missing orderId/userId/totalCents (event ${envelope.eventId})`,
      );
    }
    const input: IngestOrderEventInput = {
      orderId: payload.orderId,
      userId: payload.userId,
      totalCents: payload.totalCents,
      restaurantId: payload.restaurantId,
      // Derived from the envelope's verified eventType, never trusted from
      // the payload alone — mirrors notification's/review's own consumers.
      status: envelope.eventType === ORDER_CONFIRMED ? 'CONFIRMED' : 'CANCELLED',
    };
    await this.ingest.execute(envelope, input);
  }
}
