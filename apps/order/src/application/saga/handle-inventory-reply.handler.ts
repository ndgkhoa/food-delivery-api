import {
  type EventEnvelopeHeaders,
  IdempotentConsumer,
  PROCESSED_EVENT_STORE,
  type ProcessedEventStorePort,
} from '@food-delivery-api/shared-messaging';
import { recordSagaOutcome, type SagaOutcome } from '@food-delivery-api/shared-observability';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { chargePaymentCommand, orderCancelledEvent } from '@order/application/saga/saga-commands';
import type { Order } from '@order/domain/order/order';
import { ORDER_REPOSITORY, type OrderRepository } from '@order/domain/order/order.repository';
import type { OrderSaga } from '@order/domain/saga/order-saga';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';
import { OrderNotFoundError, SagaNotFoundError } from '@order/domain/shared/errors';
import { OUTBOX_WRITER, type OutboxWriter } from '@order/domain/shared/outbox.port';
import { TRANSACTION_PORT, type TransactionPort } from '@order/domain/shared/transaction.port';

export const STOCK_RESERVED = 'StockReserved';
export const STOCK_RESERVATION_FAILED = 'StockReservationFailed';
const STOCK_RELEASED = 'StockReleased';

interface InventoryReplyPayload {
  orderId: string;
  reason?: string;
}

@Injectable()
export class HandleInventoryReplyHandler {
  private readonly logger = new Logger(HandleInventoryReplyHandler.name);

  constructor(
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(PROCESSED_EVENT_STORE) private readonly processedEvents: ProcessedEventStorePort,
    @Inject(TRANSACTION_PORT) private readonly transaction: TransactionPort,
  ) {}

  async execute(envelope: EventEnvelopeHeaders, payload: InventoryReplyPayload): Promise<void> {
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
    payload: InventoryReplyPayload,
  ): Promise<SagaOutcome | undefined> {
    const { tenantId, eventType, eventId } = envelope;
    const orderId = payload.orderId;
    const saga = await this.sagaRepository.findByOrderId(tenantId, orderId);
    if (!saga) {
      throw new SagaNotFoundError(orderId);
    }

    switch (eventType) {
      case STOCK_RESERVED: {
        if (saga.state !== 'STARTED') {
          return undefined;
        }
        const order = await this.loadOrder(tenantId, orderId);
        await this.orderRepository.updateStatus(order.reserve());
        await this.sagaRepository.transition(saga.transition('STOCK_RESERVED', eventId));
        await this.outbox.append(
          chargePaymentCommand(orderId, order.totalCents, envelope.correlationId),
        );
        return undefined;
      }
      case STOCK_RESERVATION_FAILED: {
        if (saga.state !== 'STARTED') {
          return undefined;
        }
        const order = await this.loadOrder(tenantId, orderId);
        return this.cancelOrder(order, saga, eventId, envelope.correlationId);
      }
      case STOCK_RELEASED: {
        if (saga.state !== 'COMPENSATING') {
          return undefined;
        }
        const order = await this.loadOrder(tenantId, orderId);
        return this.cancelOrder(order, saga, eventId, envelope.correlationId);
      }
      default:
        this.logger.warn(
          `Ignoring unknown inventory reply type "${eventType}" for order ${orderId}`,
        );
        return undefined;
    }
  }

  private async cancelOrder(
    order: Order,
    saga: OrderSaga,
    eventId: string,
    correlationId: string,
  ): Promise<SagaOutcome> {
    await this.orderRepository.updateStatus(order.cancel());
    await this.sagaRepository.transition(saga.transition('CANCELLED', eventId));
    await this.outbox.append(
      orderCancelledEvent(order.id, order.userId, order.totalCents, correlationId),
    );
    return 'cancelled';
  }

  private async loadOrder(tenantId: string, orderId: string) {
    const order = await this.orderRepository.findById(tenantId, orderId);
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    return order;
  }
}
