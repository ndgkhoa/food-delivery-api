import { TENANT_CONTEXT_PORT, type TenantContextPort } from '@food-delivery-api/shared-tenancy';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { CancelOrderHandler } from '@order/application/order/commands/cancel-order.handler';
import { ConfirmOrderHandler } from '@order/application/order/commands/confirm-order.handler';
import { PlaceOrderHandler } from '@order/application/order/commands/place-order.handler';
import { GetOrderHandler } from '@order/application/order/queries/get-order.handler';
import type { OrderResponse } from '@order/interface/http/dto/order.response';
import { PlaceOrderRequest } from '@order/interface/http/dto/place-order.request';
import { OrderResponseMapper } from '@order/interface/http/mappers/order-response.mapper';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly placeOrder: PlaceOrderHandler,
    private readonly cancelOrder: CancelOrderHandler,
    private readonly confirmOrder: ConfirmOrderHandler,
    private readonly getOrder: GetOrderHandler,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Place an order (asynchronous)',
    description:
      'Validates the menu, then persists a PENDING order and starts a Kafka saga ' +
      '(reserve stock → charge payment) in one transaction. Returns the PENDING ' +
      'order immediately; poll GET /orders/:id until CONFIRMED or CANCELLED. ' +
      'Requires an `Idempotency-Key` header so retries replay the same order.',
  })
  async place(
    @Body() dto: PlaceOrderRequest,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey?: string,
  ): Promise<OrderResponse> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(`"${IDEMPOTENCY_KEY_HEADER}" header is required`);
    }
    const order = await this.placeOrder.execute({
      tenantId: this.tenantContext.getTenantIdOrThrow(),
      userId: this.tenantContext.getActor(),
      idempotencyKey: idempotencyKey.trim(),
      items: dto.items,
    });
    return OrderResponseMapper.toResponse(order);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponse> {
    const order = await this.cancelOrder.execute({
      tenantId: this.tenantContext.getTenantIdOrThrow(),
      userId: this.tenantContext.getActor(),
      roles: this.tenantContext.getContext()?.roles ?? [],
      orderId: id,
    });
    return OrderResponseMapper.toResponse(order);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponse> {
    const order = await this.confirmOrder.execute({
      tenantId: this.tenantContext.getTenantIdOrThrow(),
      userId: this.tenantContext.getActor(),
      roles: this.tenantContext.getContext()?.roles ?? [],
      orderId: id,
    });
    return OrderResponseMapper.toResponse(order);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponse> {
    const order = await this.getOrder.execute({
      tenantId: this.tenantContext.getTenantIdOrThrow(),
      userId: this.tenantContext.getActor(),
      roles: this.tenantContext.getContext()?.roles ?? [],
      orderId: id,
    });
    return OrderResponseMapper.toResponse(order);
  }
}
