import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { AssignDriverHandler } from '@delivery/application/assign-driver.handler';
import { DeliveryGateway } from '@delivery/interface/ws/delivery.gateway';
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
/** Delivery's own consumer group — tails `order.events` with independent offsets. */
const CONSUMER_GROUP_ID = 'delivery-order-events';
const ORDER_CONFIRMED = 'OrderConfirmed';

interface OrderEventPayload {
  orderId?: string;
}

/**
 * Consumes `order.events` and assigns a driver when an order is CONFIRMED. The
 * shared subscriber runs the handler inside the tenant scope the envelope
 * carries; assignment is idempotent (HSETNX one-driver-per-order) so a
 * redelivered event is a safe no-op. Non-CONFIRMED events (e.g. OrderCancelled)
 * and malformed payloads are cleanly skipped — this consumer only reacts to
 * confirmations. On a successful assignment it broadcasts `assigned` to the
 * order room so a subscribed customer learns the driver immediately.
 */
@Injectable()
export class OrderEventsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    private readonly assignDriver: AssignDriverHandler,
    private readonly gateway: DeliveryGateway,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // In-process tests boot the graph without a broker; the compose e2e + real
    // runtime run outside NODE_ENV=test. Logged (not silent) so a mis-set env is visible.
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn(
        `Delivery assignment disabled (NODE_ENV=test): ${ORDER_EVENTS_TOPIC} not consumed`,
      );
      return;
    }

    this.consumer = await this.subscriber.subscribe<OrderEventPayload>({
      groupId: CONSUMER_GROUP_ID,
      topics: [ORDER_EVENTS_TOPIC],
      handler: ({ envelope, payload }) => this.handle(envelope, payload),
    });
    this.logger.log(`Assigning drivers from ${ORDER_EVENTS_TOPIC}`);
  }

  private async handle(envelope: EventEnvelopeHeaders, payload: OrderEventPayload): Promise<void> {
    if (envelope.eventType !== ORDER_CONFIRMED) {
      return;
    }
    const orderId = payload.orderId;
    if (!orderId) {
      this.logger.warn(`Skipping ${ORDER_CONFIRMED} with no orderId (event ${envelope.eventId})`);
      return;
    }

    const assignment = await this.assignDriver.execute(envelope.tenantId, orderId);
    if (assignment) {
      this.gateway.broadcastAssignment(envelope.tenantId, orderId, assignment.driverId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
