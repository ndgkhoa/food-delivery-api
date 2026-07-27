import {
  ConflictError,
  EntityNotFoundError,
  InvalidUuidError,
  KeycloakAdminError,
} from '@auth/domain/shared/errors';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

type DomainError = EntityNotFoundError | ConflictError | InvalidUuidError | KeycloakAdminError;

/**
 * Translates transport-agnostic domain errors into HTTP responses at the edge,
 * keeping HTTP status concerns out of the use cases:
 *  - EntityNotFoundError → 404
 *  - ConflictError → 409 (e.g. duplicate tenant slug)
 *  - InvalidUuidError → 400 (M-2 guard rejected a non-UUID tenant_id)
 *  - KeycloakAdminError → its carried upstream status (409 duplicate user, else 502)
 */
@Catch(EntityNotFoundError, ConflictError, InvalidUuidError, KeycloakAdminError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, error } = this.classify(exception);
    response.status(status).json({ statusCode: status, message: exception.message, error });
  }

  private classify(exception: DomainError): { status: number; error: string } {
    if (exception instanceof EntityNotFoundError) {
      return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
    }
    if (exception instanceof ConflictError) {
      return { status: HttpStatus.CONFLICT, error: 'Conflict' };
    }
    if (exception instanceof InvalidUuidError) {
      return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request' };
    }
    // KeycloakAdminError carries the upstream status (409 for a duplicate user,
    // otherwise 502 — the auth service could not complete the upstream call).
    return {
      status: exception.statusCode,
      error: exception.statusCode === HttpStatus.CONFLICT ? 'Conflict' : 'Bad Gateway',
    };
  }
}
