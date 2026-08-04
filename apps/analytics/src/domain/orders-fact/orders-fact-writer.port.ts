import type { OrdersFactRow } from '@analytics/domain/orders-fact/orders-fact';

export interface OrdersFactWriterPort {
  write(row: OrdersFactRow): Promise<void>;
}

export const ORDERS_FACT_WRITER = Symbol('OrdersFactWriterPort');
