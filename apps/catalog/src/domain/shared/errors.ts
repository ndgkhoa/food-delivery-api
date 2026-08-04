import { DomainException } from '@food-delivery-api/shared-errors';

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
