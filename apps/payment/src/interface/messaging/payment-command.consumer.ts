import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  type EventEnvelopeHeaders,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WORKFLOW_GATEWAY,
  type WorkflowGatewayPort,
} from '@payment/domain/shared/workflow-gateway.port';
import { CHARGE_PAYMENT } from '@payment/interface/messaging/payment-reply-factory';

const PAYMENT_COMMANDS_TOPIC = 'payment.commands';
const CONSUMER_GROUP_ID = 'payment-commands';

interface ChargePaymentPayload {
  orderId: string;
  totalCents: number;
}

/**
 * Consumes `payment.commands` and starts the durable charge workflow — it no
 * longer decides or replies inline (the workflow's emit-reply activity owns the
 * reply). Idempotency is by workflow id (`charge-{orderId}`): a redelivered
 * `ChargePayment` re-targets the same id and the gateway treats the resulting
 * "already started" as a no-op, so exactly one workflow (and one reply) exists
 * per order. The handler runs in the tenant scope the envelope carries; that
 * tenant + the saga correlation id are threaded into the workflow so the
 * emit-reply activity can re-establish scope when writing the outbox. Disabled
 * under NODE_ENV=test (no broker).
 */
@Injectable()
export class PaymentCommandConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentCommandConsumer.name);
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    @Inject(WORKFLOW_GATEWAY) private readonly workflowGateway: WorkflowGatewayPort,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      this.logger.warn('Payment command consumer disabled (NODE_ENV=test)');
      return;
    }
    this.consumer = await this.subscriber.subscribe<ChargePaymentPayload>({
      groupId: CONSUMER_GROUP_ID,
      topics: [PAYMENT_COMMANDS_TOPIC],
      handler: ({ envelope, payload }) => this.handleCommand(envelope, payload),
    });
    this.logger.log(`Consuming ${PAYMENT_COMMANDS_TOPIC} for the order saga`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private async handleCommand(
    envelope: EventEnvelopeHeaders,
    payload: ChargePaymentPayload,
  ): Promise<void> {
    if (envelope.eventType !== CHARGE_PAYMENT) {
      this.logger.warn(`Ignoring unknown payment command type "${envelope.eventType}"`);
      return;
    }
    await this.workflowGateway.startCharge({
      orderId: payload.orderId,
      totalCents: payload.totalCents,
      correlationId: envelope.correlationId,
      tenantId: envelope.tenantId,
    });
  }
}
