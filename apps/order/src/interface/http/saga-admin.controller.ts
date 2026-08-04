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

const SAGA_REPLAY_ROLES = ['admin', 'platform-admin'] as const;

export interface SagaReplayResponse {
  orderId: string;
  outcome: 'reset';
}

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
