import { EntityNotFoundError } from '@catalog/domain/shared/errors';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Translates the transport-agnostic domain `EntityNotFoundError` into an HTTP
 * 404 at the delivery edge, keeping HTTP status concerns out of the use cases.
 */
@Catch(EntityNotFoundError)
export class EntityNotFoundFilter implements ExceptionFilter {
  catch(exception: EntityNotFoundError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(HttpStatus.NOT_FOUND).json({
      statusCode: HttpStatus.NOT_FOUND,
      message: exception.message,
      error: 'Not Found',
    });
  }
}
