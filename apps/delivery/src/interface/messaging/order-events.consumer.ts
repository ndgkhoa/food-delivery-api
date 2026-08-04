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
const CONSUMER_GROUP_ID = 'delivery-order-events';
const ORDER_CONFIRMED = 'OrderConfirmed';
const ORDER_CANCELLED = 'OrderCancelled';

interface OrderEventPayload {
  orderId?: string;
}

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
    if (envelope.eventType !== ORDER_CONFIRMED && envelope.eventType !== ORDER_CANCELLED) {
      return;
    }
    const orderId = payload.orderId;
    if (!orderId) {
      this.logger.warn(
        `Skipping ${envelope.eventType} with no orderId (event ${envelope.eventId})`,
      );
      return;
    }

    if (envelope.eventType === ORDER_CANCELLED) {
      await this.assignDriver.release(envelope.tenantId, orderId);
      return;
    }

    const claim = await this.assignDriver.execute(envelope.tenantId, orderId);
    if (claim?.created) {
      this.gateway.broadcastAssignment(envelope.tenantId, orderId, claim.assignment.driverId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }
}
