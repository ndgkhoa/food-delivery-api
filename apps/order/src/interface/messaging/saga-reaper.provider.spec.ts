import { FakeSagaRepository, TENANT_ID } from '@order/application/saga/saga-reply-test-doubles';
import { OrderSaga } from '@order/domain/saga/order-saga';
import { SagaReaperProvider } from './saga-reaper.provider';

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 30_000;

function reaperConfig() {
  const values: Record<string, number> = {
    SAGA_REAPER_TIMEOUT_MS: TIMEOUT_MS,
    SAGA_REAPER_INTERVAL_MS: INTERVAL_MS,
  };
  return {
    getOrThrow: <T>(key: string): T => values[key] as unknown as T,
    get: <T>(_key: string): T => 'test' as unknown as T,
  };
}

function sagaAged(orderId: string, ageMs: number): OrderSaga {
  const updatedAt = new Date(Date.now() - ageMs);
  return OrderSaga.reconstitute({
    orderId,
    tenantId: TENANT_ID,
    state: 'STARTED',
    correlationId: null,
    lastEventId: null,
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  });
}

describe('SagaReaperProvider.sweep', () => {
  it('reports only the non-terminal sagas idle past the timeout', async () => {
    const repo = new FakeSagaRepository();
    repo.seed(sagaAged('stale', TIMEOUT_MS + 5_000));
    repo.seed(sagaAged('fresh', TIMEOUT_MS - 5_000));
    repo.seed(
      OrderSaga.reconstitute({
        orderId: 'done',
        tenantId: TENANT_ID,
        state: 'COMPLETED',
        correlationId: null,
        lastEventId: null,
        version: 3,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
    );

    const reaper = new SagaReaperProvider(repo, reaperConfig() as never);

    await expect(reaper.sweep()).resolves.toBe(1);
  });
});
