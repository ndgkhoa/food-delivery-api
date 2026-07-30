import type { OrderFactStatus, OrdersFactRow } from '@analytics/domain/orders-fact/orders-fact';
import {
  ORDERS_FACT_WRITER,
  type OrdersFactWriterPort,
} from '@analytics/domain/orders-fact/orders-fact-writer.port';
import type { EventEnvelopeHeaders } from '@food-delivery-api/shared-messaging';
import { Inject, Injectable } from '@nestjs/common';

/**
 * Order lifecycle fields the consumer has already shape-validated (required
 * fields present) before handing off here; `status` is derived by the
 * consumer from the envelope's `eventType`, never trusted from the payload
 * alone. `restaurantId` is `undefined` for a straggler order.
 */
export interface IngestOrderEventInput {
  orderId: string;
  userId: string;
  totalCents: number;
  restaurantId?: string;
  status: OrderFactStatus;
}

/**
 * Writes one `orders_fact` row per delivered `order.events` message. No
 * dedupe ledger here — the ClickHouse adapter's ReplacingMergeTree table
 * engine is what makes a redelivery of the same `(tenantId, orderId)`
 * collapse on merge; this handler just maps the envelope + payload into a
 * fact row and appends it, every time it's called.
 */
@Injectable()
export class IngestOrderEventHandler {
  constructor(@Inject(ORDERS_FACT_WRITER) private readonly writer: OrdersFactWriterPort) {}

  async execute(envelope: EventEnvelopeHeaders, input: IngestOrderEventInput): Promise<void> {
    const row: OrdersFactRow = {
      tenantId: envelope.tenantId,
      orderId: input.orderId,
      // '' (not undefined) so the ClickHouse column stays a plain String —
      // top-restaurant queries filter this out with a simple inequality.
      restaurantId: input.restaurantId ?? '',
      userId: input.userId,
      status: input.status,
      totalCents: input.totalCents,
      occurredAt: new Date(envelope.occurredAt),
    };
    await this.writer.write(row);
  }
}
