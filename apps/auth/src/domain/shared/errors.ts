import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Transport-agnostic domain errors. Use cases throw these; the shared
 * `GlobalExceptionFilter` reads `code`/`httpStatus` directly off each, so
 * non-HTTP callers can reuse the same use cases without inheriting an HTTP
 * framework dependency.
 */

/** A requested aggregate does not exist. Surfaced as HTTP 404. */
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

/** A unique constraint (e.g. tenant slug) is already taken. Surfaced as HTTP 409. */
export class ConflictError extends DomainException {
  readonly code = 'CONFLICT';
  readonly httpStatus = 409;
}

/**
 * A value that must be a UUID is not one. Enforces the invariant that every
 * Keycloak user is stamped with a valid UUID `tenant_id` (so every future token
 * carries a valid tenant claim). Surfaced as HTTP 400.
 */
export class InvalidUuidError extends DomainException {
  readonly code = 'INVALID_UUID';
  readonly httpStatus = 400;

  constructor(
    readonly field: string,
    readonly value: string,
  ) {
    super(`"${field}" must be a valid UUID, received "${value}"`);
  }
}

/**
 * The Keycloak Admin API rejected an operation. Carries the upstream status so
 * the edge can map a duplicate username to 409 and other failures to 502 (or
 * 400 for a rejected input, e.g. an unknown realm role).
 */
export class KeycloakAdminError extends DomainException {
  readonly code: string;
  readonly httpStatus: number;

  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.httpStatus = statusCode;
    this.code =
      statusCode === 409
        ? 'KEYCLOAK_USER_CONFLICT'
        : statusCode === 400
          ? 'KEYCLOAK_INVALID_REQUEST'
          : 'KEYCLOAK_UPSTREAM_ERROR';
  }
}
