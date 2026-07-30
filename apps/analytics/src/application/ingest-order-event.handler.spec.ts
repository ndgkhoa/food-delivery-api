import { IngestOrderEventHandler } from '@analytics/application/ingest-order-event.handler';
import { ORDERS_FACT_WRITER } from '@analytics/domain/orders-fact/orders-fact-writer.port';
import { Test } from '@nestjs/testing';

const ENVELOPE = {
  eventId: 'event-1',
  eventType: 'OrderConfirmed',
  aggregateId: 'order-1',
  tenantId: 'tenant-1',
  correlationId: 'corr-1',
  occurredAt: '2026-01-15T10:00:00.000Z',
};

describe('IngestOrderEventHandler', () => {
  const write = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    write.mockClear();
  });

  async function buildHandler(): Promise<IngestOrderEventHandler> {
    const module = await Test.createTestingModule({
      providers: [IngestOrderEventHandler, { provide: ORDERS_FACT_WRITER, useValue: { write } }],
    }).compile();
    return module.get(IngestOrderEventHandler);
  }

  it('maps a CONFIRMED event with a restaurantId into a fact row', async () => {
    const handler = await buildHandler();
    await handler.execute(ENVELOPE, {
      orderId: 'order-1',
      userId: 'user-1',
      totalCents: 2500,
      restaurantId: 'restaurant-1',
      status: 'CONFIRMED',
    });

    expect(write).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      orderId: 'order-1',
      restaurantId: 'restaurant-1',
      userId: 'user-1',
      status: 'CONFIRMED',
      totalCents: 2500,
      occurredAt: new Date('2026-01-15T10:00:00.000Z'),
    });
  });

  it('maps a straggler order with no restaurantId to an empty string, not undefined', async () => {
    const handler = await buildHandler();
    await handler.execute(ENVELOPE, {
      orderId: 'order-2',
      userId: 'user-2',
      totalCents: 1000,
      status: 'CONFIRMED',
    });

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: '' }));
  });

  it('maps a CANCELLED event the same way, minus a restaurant attribution requirement', async () => {
    const handler = await buildHandler();
    await handler.execute(ENVELOPE, {
      orderId: 'order-3',
      userId: 'user-3',
      totalCents: 500,
      status: 'CANCELLED',
    });

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELLED' }));
  });
});
