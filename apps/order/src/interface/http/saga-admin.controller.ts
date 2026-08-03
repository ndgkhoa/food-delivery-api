import {
  Roles,
  RolesGuard,
  TENANT_CONTEXT_PORT,
  type TenantContextPort,
} from '@food-delivery-api/shared-tenancy';
import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
  ORDER_SAGA_REPOSITORY,
  type OrderSagaRepository,
} from '@order/domain/saga/order-saga.repository';

/** Only an operator may trigger a DLQ replay — never opened to a tenant's own callers. */
const SAGA_REPLAY_ROLES = ['admin'] as const;

export interface SagaReplayResponse {
  orderId: string;
  outcome: 'reset';
}

/**
 * Operator-only DLQ-replay tool for sagas the reaper has escalated (stuck
 * past `SAGA_RECONCILER_MAX_ATTEMPTS`, re-escalated every sweep until someone
 * intervenes). Replaying resets `attempts` to 0 so the NEXT reaper sweep
 * re-drives the saga through its existing idempotent recovery logic — this
 * endpoint never re-implements command emission itself. Admin-only enforced
 * on this route alone via a method-scoped `RolesGuard`; the order app has no
 * global RolesGuard by design (see `app.module.ts`), so every other route
 * stays open to any authenticated tenant.
 */
@Controller('orders/sagas')
export class SagaAdminController {
  constructor(
    @Inject(ORDER_SAGA_REPOSITORY) private readonly sagaRepository: OrderSagaRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  @Post(':orderId/replay')
  @UseGuards(RolesGuard)
  @Roles(...SAGA_REPLAY_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay an escalated saga (admin-only)',
    description:
      'Resets the reconcile-attempts counter for a non-terminal saga so the ' +
      'next reaper sweep re-drives it fresh. No-op-with-409 if the saga is ' +
      'already terminal (COMPLETED/CANCELLED); 404 if no saga exists for the order.',
  })
  async replay(@Param('orderId', ParseUUIDPipe) orderId: string): Promise<SagaReplayResponse> {
    const tenantId = this.tenantContext.getTenantIdOrThrow();
    const outcome = await this.sagaRepository.resetReconcileAttempts(tenantId, orderId);

    switch (outcome) {
      case 'reset':
        return { orderId, outcome: 'reset' };
      case 'not_found':
        throw new NotFoundException(`No saga found for order "${orderId}"`);
      case 'terminal':
        throw new ConflictException('Saga already terminal — nothing to replay');
    }
  }
}
