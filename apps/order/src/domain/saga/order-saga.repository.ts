import type { OrderSaga, SagaState } from '@order/domain/saga/order-saga';
import type { StrandedSagaCandidate } from '@order/domain/saga/stranded-saga-sweep';

export interface OrderSagaRepository {
  insert(saga: OrderSaga): Promise<void>;
  findByOrderId(tenantId: string, orderId: string): Promise<OrderSaga | undefined>;
  transition(saga: OrderSaga): Promise<OrderSaga>;
  findNonTerminal(olderThan: Date): Promise<StrandedSagaCandidate[]>;
  recordReconcileAttempt(orderId: string, expectedState: SagaState): Promise<void>;
  resetReconcileAttempts(
    tenantId: string,
    orderId: string,
  ): Promise<'reset' | 'terminal' | 'not_found'>;
}

export const ORDER_SAGA_REPOSITORY = Symbol('OrderSagaRepository');
