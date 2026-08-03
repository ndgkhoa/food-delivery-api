import { OrderSaga } from '@order/domain/saga/order-saga';
import { FakeSagaRepository, TENANT_ID } from './saga-reply-test-doubles';

const ORDER_ID = '44444444-4444-4444-8444-444444444444';

function seedSaga(
  repository: FakeSagaRepository,
  state: OrderSaga['state'],
  attempts: number,
): void {
  const saga = OrderSaga.reconstitute({
    orderId: ORDER_ID,
    tenantId: TENANT_ID,
    state,
    correlationId: null,
    lastEventId: null,
    version: 1,
    attempts,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  repository.seed(saga);
}

describe('FakeSagaRepository.resetReconcileAttempts', () => {
  it('resets attempts to 0 and returns "reset" for a non-terminal saga', async () => {
    const repository = new FakeSagaRepository();
    seedSaga(repository, 'STOCK_RESERVED', 7);

    const outcome = await repository.resetReconcileAttempts(TENANT_ID, ORDER_ID);

    expect(outcome).toBe('reset');
    const saga = await repository.findByOrderId(TENANT_ID, ORDER_ID);
    expect(saga?.attempts).toBe(0);
  });

  it('leaves attempts unchanged and returns "terminal" for a COMPLETED saga', async () => {
    const repository = new FakeSagaRepository();
    seedSaga(repository, 'COMPLETED', 3);

    const outcome = await repository.resetReconcileAttempts(TENANT_ID, ORDER_ID);

    expect(outcome).toBe('terminal');
    const saga = await repository.findByOrderId(TENANT_ID, ORDER_ID);
    expect(saga?.attempts).toBe(3);
  });

  it('returns "not_found" when no saga row exists for the order', async () => {
    const repository = new FakeSagaRepository();

    const outcome = await repository.resetReconcileAttempts(TENANT_ID, ORDER_ID);

    expect(outcome).toBe('not_found');
  });

  it('returns "not_found" when the saga belongs to a different tenant', async () => {
    const repository = new FakeSagaRepository();
    seedSaga(repository, 'STARTED', 2);

    const outcome = await repository.resetReconcileAttempts('other-tenant', ORDER_ID);

    expect(outcome).toBe('not_found');
  });
});
