import {
  ROLES_HEADER,
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
  type TenantRequestContext,
  USER_ID_HEADER,
} from '@food-delivery-api/shared-tenancy';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';
import { SagaAdminController } from '@order/interface/http/saga-admin.controller';
import request from 'supertest';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';

class StubSagaRepository implements OrderSagaRepository {
  outcome: 'reset' | 'terminal' | 'not_found' = 'reset';
  lastCall: { tenantId: string; orderId: string } | undefined;

  async resetReconcileAttempts(
    tenantId: string,
    orderId: string,
  ): Promise<'reset' | 'terminal' | 'not_found'> {
    this.lastCall = { tenantId, orderId };
    return this.outcome;
  }

  insert(): Promise<void> {
    throw new Error('not used by the saga-admin controller');
  }
  findByOrderId(): Promise<never> {
    throw new Error('not used by the saga-admin controller');
  }
  transition(): Promise<never> {
    throw new Error('not used by the saga-admin controller');
  }
  findNonTerminal(): Promise<never[]> {
    throw new Error('not used by the saga-admin controller');
  }
  recordReconcileAttempt(): Promise<void> {
    throw new Error('not used by the saga-admin controller');
  }
}

class FakeTenantContext implements TenantContextPort {
  run<T>(_context: TenantRequestContext, callback: () => T): T {
    return callback();
  }
  getContext(): TenantRequestContext | undefined {
    return undefined;
  }
  getTenantIdOrThrow(): string {
    return TENANT_ID;
  }
  getActor(): string {
    return 'admin-user';
  }
}

describe('SagaAdminController (POST /orders/sagas/:orderId/replay)', () => {
  let app: INestApplication;
  let sagaRepository: StubSagaRepository;

  beforeEach(async () => {
    sagaRepository = new StubSagaRepository();
    const moduleRef = await Test.createTestingModule({
      controllers: [SagaAdminController],
      providers: [
        { provide: ORDER_SAGA_REPOSITORY, useValue: sagaRepository },
        { provide: TENANT_CONTEXT_PORT, useClass: FakeTenantContext },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the reset outcome when the caller carries the admin role', async () => {
    sagaRepository.outcome = 'reset';

    const response = await request(app.getHttpServer())
      .post(`/orders/sagas/${ORDER_ID}/replay`)
      .set(USER_ID_HEADER, 'admin-user')
      .set(ROLES_HEADER, 'admin');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orderId: ORDER_ID, outcome: 'reset' });
    expect(sagaRepository.lastCall).toEqual({ tenantId: TENANT_ID, orderId: ORDER_ID });
  });

  it('also accepts the platform-admin operator role', async () => {
    sagaRepository.outcome = 'reset';

    const response = await request(app.getHttpServer())
      .post(`/orders/sagas/${ORDER_ID}/replay`)
      .set(USER_ID_HEADER, 'operator-1')
      .set(ROLES_HEADER, 'platform-admin');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orderId: ORDER_ID, outcome: 'reset' });
  });

  it('rejects a non-admin caller with 403 before the repository is ever called', async () => {
    const response = await request(app.getHttpServer())
      .post(`/orders/sagas/${ORDER_ID}/replay`)
      .set(USER_ID_HEADER, 'user-1')
      .set(ROLES_HEADER, 'customer');

    expect(response.status).toBe(403);
    expect(sagaRepository.lastCall).toBeUndefined();
  });

  it('returns 401 when no verified identity header reached the service', async () => {
    const response = await request(app.getHttpServer()).post(`/orders/sagas/${ORDER_ID}/replay`);

    expect(response.status).toBe(401);
  });

  it('returns 404 when the saga does not exist', async () => {
    sagaRepository.outcome = 'not_found';

    const response = await request(app.getHttpServer())
      .post(`/orders/sagas/${ORDER_ID}/replay`)
      .set(USER_ID_HEADER, 'admin-user')
      .set(ROLES_HEADER, 'admin');

    expect(response.status).toBe(404);
  });

  it('returns 409 when the saga is already terminal', async () => {
    sagaRepository.outcome = 'terminal';

    const response = await request(app.getHttpServer())
      .post(`/orders/sagas/${ORDER_ID}/replay`)
      .set(USER_ID_HEADER, 'admin-user')
      .set(ROLES_HEADER, 'admin');

    expect(response.status).toBe(409);
  });
});
