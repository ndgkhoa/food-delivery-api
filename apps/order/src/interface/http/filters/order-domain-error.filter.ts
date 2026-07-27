import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import {
  IdempotencyConflictError,
  IllegalOrderTransitionError,
  InsufficientStockError,
  InvalidOrderRequestError,
  MenuValidationError,
  OrderConcurrencyConflictError,
  OrderForbiddenError,
  OrderNotFoundError,
} from '@order/domain/shared/errors';
import type { Response } from 'express';

type OrderDomainError =
  | OrderNotFoundError
  | IllegalOrderTransitionError
  | MenuValidationError
  | InsufficientStockError
  | IdempotencyConflictError
  | OrderConcurrencyConflictError
  | OrderForbiddenError
  | InvalidOrderRequestError;

/** Maps each transport-agnostic order domain error to its HTTP status + a JSON body. */
function statusFor(exception: OrderDomainError): number {
  switch (exception.name) {
    case 'OrderNotFoundError':
      return HttpStatus.NOT_FOUND;
    case 'IllegalOrderTransitionError':
    case 'InsufficientStockError':
    case 'IdempotencyConflictError':
    case 'OrderConcurrencyConflictError':
      return HttpStatus.CONFLICT;
    case 'MenuValidationError':
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case 'OrderForbiddenError':
      return HttpStatus.FORBIDDEN;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Translates order domain errors into their HTTP status, keeping status-code
 * concerns out of the use cases (mirrors catalog's `EntityNotFoundFilter`,
 * extended to the full set of order-specific error types).
 */
@Catch(
  OrderNotFoundError,
  IllegalOrderTransitionError,
  MenuValidationError,
  InsufficientStockError,
  IdempotencyConflictError,
  OrderConcurrencyConflictError,
  OrderForbiddenError,
  InvalidOrderRequestError,
)
export class OrderDomainErrorFilter implements ExceptionFilter {
  catch(exception: OrderDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = statusFor(exception);
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: exception.name,
    });
  }
}
