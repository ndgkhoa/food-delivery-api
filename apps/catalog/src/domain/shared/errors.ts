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

/**
 * Domain-layer error signalling an optimistic-lock conflict: the aggregate's
 * version at write time no longer matches what was loaded (or what the
 * caller's `If-Match` header specified), because another request modified it
 * first. The write is rejected — never silently clobbered — so the caller
 * must reload and retry.
 */
export class ConcurrencyConflictError extends DomainException {
  readonly code = 'CATALOG_CONCURRENCY_CONFLICT';
  readonly httpStatus = 409;

  constructor(
    readonly entity: string,
    readonly entityId: string,
  ) {
    super(`${entity} "${entityId}" was modified by another request; reload and retry`);
  }
}
