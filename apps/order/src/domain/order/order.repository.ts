import type { Order } from '@order/domain/order/order';

export interface OrderRepository {
  insert(order: Order): Promise<Order>;
  updateStatus(order: Order): Promise<Order>;
  findById(tenantId: string, id: string): Promise<Order | undefined>;
  findRecentByTenant(tenantId: string, userId: string, limit: number): Promise<Order[]>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
