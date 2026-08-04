import {
  type EventEnvelopeHeaders,
  IdempotentConsumer,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { recordSagaOutcome, type SagaOutcome } from '@food-delivery-api/shared-observability';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { orderConfirmedEvent, releaseStockCommand } from '@order/application/saga/saga-commands';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';
import { OrderNotFoundError, SagaNotFoundError } from '@order/domain/shared/errors';
import { OUTBOX_WRITER, type OutboxWriter } from '@order/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@order/domain/shared/transaction.port';

export const PAYMENT_SUCCEEDED = 'PaymentSucceeded';
export const PAYMENT_FAILED = 'PaymentFailed';

interface PaymentReplyPayload {
  orderId: string;
  reason?: string;
}

@Injectable()
export class HandlePaymentReplyHandler {
  private readonly logger = new Logger(HandlePaymentReplyHandler.name);

  constructor(
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(envelope: EventEnvelopeHeaders, payload: PaymentReplyPayload): Promise<void> {
    const outcome = await this.transaction.runInTransaction(() =>
      IdempotentConsumer.runOnce(this.processedEvents, envelope.eventId, undefined, () =>
        this.apply(envelope, payload),
      ),
    );
    if (outcome) {
      recordSagaOutcome(outcome);
    }
  }

  private async apply(
    envelope: EventEnvelopeHeaders,
    payload: PaymentReplyPayload,
  ): Promise<SagaOutcome | undefined> {
    const { tenantId, eventType, eventId } = envelope;
    const orderId = payload.orderId;
    const saga = await this.sagaRepository.findByOrderId(tenantId, orderId);
    if (!saga) {
      throw new SagaNotFoundError(orderId);
    }

    if (saga.state !== 'STOCK_RESERVED') {
      return undefined;
    }

    switch (eventType) {
      case PAYMENT_SUCCEEDED: {
        const order = await this.loadOrder(tenantId, orderId);
        await this.orderRepository.updateStatus(order.confirm());
        await this.sagaRepository.transition(saga.transition('COMPLETED', eventId));
        await this.outbox.append(
          orderConfirmedEvent(
            orderId,
            order.userId,
            order.restaurantId,
            order.totalCents,
            envelope.correlationId,
          ),
        );
        return 'confirmed';
      }
      case PAYMENT_FAILED: {
        await this.sagaRepository.transition(saga.transition('COMPENSATING', eventId));
        await this.outbox.append(releaseStockCommand(orderId, envelope.correlationId));
        return undefined;
      }
      default:
        this.logger.warn(`Ignoring unknown payment reply type "${eventType}" for order ${orderId}`);
        return undefined;
    }
  }

  private async loadOrder(tenantId: string, orderId: string) {
    const order = await this.orderRepository.findById(tenantId, orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  }
}
