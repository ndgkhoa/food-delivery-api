import type { SagaState } from '@order/domain/saga/order-saga';

/**
 * Saga states from which a reply is still expected — a saga sitting in one of
 * these for too long has likely lost its next reply (now dead-lettered, or
 * genuinely never produced) and is stranded. COMPLETED / CANCELLED are terminal
 * and never swept.
 */
export const NON_TERMINAL_SAGA_STATES: readonly SagaState[] = [
  'STARTED',
  'STOCK_RESERVED',
  'COMPENSATING',
];

/** A non-terminal saga row the reaper considers, reduced to what the sweep needs. */
export interface StrandedSagaCandidate {
  orderId: string;
  tenantId: string;
  state: SagaState;
  updatedAt: Date;
}

/**
 * Pure selection rule for the stranded-saga sweep: a candidate is stranded when
 * it is non-terminal AND has not advanced within `timeoutMs` of `now`. This is
 * the single source of truth for the reaper's semantics; the repository query
 * mirrors it (state + updated_at, backed by the `(state, updated_at)` index).
 * Discovery-only for this slice — full timeout-driven recovery is a later step.
 */
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
