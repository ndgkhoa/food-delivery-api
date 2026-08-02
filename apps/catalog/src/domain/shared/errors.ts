import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Domain-layer error signalling that a requested aggregate does not exist
 * within the caller's tenant scope. Thrown by use cases; the shared
 * `GlobalExceptionFilter` reads `code`/`httpStatus` directly off it. Keeping
 * this framework-free (beyond the `DomainException` base) lets non-HTTP
 * callers reuse the same use cases without inheriting an HTTP framework
 * dependency.
 */
export class EntityNotFoundError extends DomainException {
  readonly code = 'ENTITY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(
    readonly entity: string,
    readonly entityId: string,
    message?: string,
  ) {
    super(message ?? `${entity} "${entityId}" not found`);
  }
}
