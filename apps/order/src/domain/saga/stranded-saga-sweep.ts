import type { SagaState } from '@order/domain/saga/order-saga';

export const NON_TERMINAL_SAGA_STATES: readonly SagaState[] = [
  'STARTED',
  'STOCK_RESERVED',
  'COMPENSATING',
];

export interface StrandedSagaCandidate {
  orderId: string;
  tenantId: string;
  state: SagaState;
  updatedAt: Date;
}

export function selectStrandedSagas(
  candidates: readonly StrandedSagaCandidate[],
  now: Date,
  timeoutMs: number,
): StrandedSagaCandidate[] {
  const thresholdMs = now.getTime() - timeoutMs;
  return candidates.filter(
    (candidate) =>
      NON_TERMINAL_SAGA_STATES.includes(candidate.state) &&
      candidate.updatedAt.getTime() < thresholdMs,
  );
}
