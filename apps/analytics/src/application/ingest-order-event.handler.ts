import type { OrderFactStatus, OrdersFactRow } from '@analytics/domain/orders-fact/orders-fact';
import {
  ORDERS_FACT_WRITER,
  type OrdersFactWriterPort,
} from '@analytics/domain/orders-fact/orders-fact-writer.port';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import { Inject, Injectable } from '@nestjs/common';

export interface IngestOrderEventInput {
  orderId: string;
  userId: string;
  totalCents: number;
  restaurantId?: string;
  status: OrderFactStatus;
}

@Injectable()
export class IngestOrderEventHandler {
  constructor(@Inject(ORDERS_FACT_WRITER) private readonly writer: OrdersFactWriterPort) {}

  async execute(envelope: EventEnvelopeHeaders, input: IngestOrderEventInput): Promise<void> {
    const row: OrdersFactRow = {
      tenantId: envelope.tenantId,
      orderId: input.orderId,
      restaurantId: input.restaurantId ?? '',
      userId: input.userId,
      status: input.status,
      totalCents: input.totalCents,
      occurredAt: new Date(envelope.occurredAt),
    };
    await this.writer.write(row);
  }
}
