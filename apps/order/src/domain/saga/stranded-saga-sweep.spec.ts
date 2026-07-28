import type { SagaState } from '@order/domain/saga/order-saga';
import { type StrandedSagaCandidate, selectStrandedSagas } from './stranded-saga-sweep';

const NOW = new Date('2026-07-28T12:00:00.000Z');
const TIMEOUT_MS = 60_000;

function candidate(
  overrides: Partial<StrandedSagaCandidate> & { state: SagaState; ageMs: number },
): StrandedSagaCandidate {
  return {
    orderId: overrides.orderId ?? 'order-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    state: overrides.state,
    updatedAt: new Date(NOW.getTime() - overrides.ageMs),
  };
}

describe('selectStrandedSagas', () => {
  it('selects a non-terminal saga that has not advanced within the timeout', () => {
    const stale = candidate({ orderId: 'stale', state: 'STARTED', ageMs: TIMEOUT_MS + 1 });
    expect(selectStrandedSagas([stale], NOW, TIMEOUT_MS)).toEqual([stale]);
  });

  it('ignores a non-terminal saga still within the timeout window', () => {
    const fresh = candidate({ orderId: 'fresh', state: 'STOCK_RESERVED', ageMs: TIMEOUT_MS - 1 });
    expect(selectStrandedSagas([fresh], NOW, TIMEOUT_MS)).toEqual([]);
  });

  it('never selects a terminal saga, however old', () => {
    const completed = candidate({ state: 'COMPLETED', ageMs: TIMEOUT_MS * 100 });
    const cancelled = candidate({ state: 'CANCELLED', ageMs: TIMEOUT_MS * 100 });
    expect(selectStrandedSagas([completed, cancelled], NOW, TIMEOUT_MS)).toEqual([]);
  });

  it('selects every stranded non-terminal state (STARTED, STOCK_RESERVED, COMPENSATING)', () => {
    const rows: StrandedSagaCandidate[] = [
      candidate({ orderId: 'a', state: 'STARTED', ageMs: TIMEOUT_MS + 10 }),
      candidate({ orderId: 'b', state: 'STOCK_RESERVED', ageMs: TIMEOUT_MS + 10 }),
      candidate({ orderId: 'c', state: 'COMPENSATING', ageMs: TIMEOUT_MS + 10 }),
    ];
    expect(selectStrandedSagas(rows, NOW, TIMEOUT_MS).map((row) => row.orderId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
