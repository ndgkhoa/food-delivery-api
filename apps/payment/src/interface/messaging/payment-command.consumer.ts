import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  type EventEnvelopeHeaders,
  IdempotentConsumer,
  KafkaConsumerSubscriber,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decideCharge } from '@payment/application/charge/charge-decision';
import type { OutboxCommandEntry, OutboxWriter } from '@payment/domain/shared/outbox.port';
import { OUTBOX_WRITER } from '@payment/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@payment/domain/shared/transaction.port';
import {
  CHARGE_PAYMENT,
  paymentFailedReply,
  paymentSucceededReply,
} from '@payment/interface/messaging/payment-reply-factory';

const PAYMENT_COMMANDS_TOPIC = 'payment.commands';
const CONSUMER_GROUP_ID = 'payment-commands';

interface ChargePaymentPayload {
  orderId: string;
  totalCents: number;
}

/**
 * Consumes `payment.commands`, applies the deterministic stub charge rule, and
 * replies over the outbox. The decision is a pure function of the total, so a
 * re-delivered command reaches the same verdict; the reply is appended under a
 * `processed_events` dedupe keyed by the command event id, so it is emitted at
 * most once. Disabled under NODE_ENV=test (no broker).
 */
@Injectable()
export class PaymentCommandConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentCommandConsumer.name);
  private readonly failAtCents: number;
  private consumer?: KafkaJS.Consumer;

  constructor(
    private readonly subscriber: KafkaConsumerSubscriber,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
    private readonly config: ConfigService,
  ) {
    this.failAtCents = this.config.getOrThrow<number>('PAYMENT_STUB_FAIL_AT_CENTS');
  }

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
    const reply = this.buildReply(payload, envelope.correlationId);
    await this.transaction.runInTransaction(async () => {
      await IdempotentConsumer.runOnce(this.processedEvents, envelope.eventId, undefined, () =>
        this.outbox.append(reply),
      );
    });
  }

  private buildReply(payload: ChargePaymentPayload, correlationId: string): OutboxCommandEntry {
    const decision = decideCharge(payload.totalCents, this.failAtCents);
    return decision.ok
      ? paymentSucceededReply(payload.orderId, correlationId)
      : paymentFailedReply(payload.orderId, decision.reason ?? 'payment declined', correlationId);
  }
}
