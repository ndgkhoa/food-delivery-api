/**
 * Transport-agnostic domain errors. Use cases throw these; the delivery edge
 * (HTTP filter) decides how to surface them, so non-HTTP callers can reuse the
 * same use cases without inheriting an HTTP status concern.
 */

/** A requested aggregate does not exist. Surfaced as HTTP 404. */
export class EntityNotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly entityId: string,
    message?: string,
  ) {
    super(message ?? `${entity} "${entityId}" not found`);
    this.name = 'EntityNotFoundError';
  }
}

/** A unique constraint (e.g. tenant slug) is already taken. Surfaced as HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * A value that must be a UUID is not one. Enforces the invariant that every
 * Keycloak user is stamped with a valid UUID `tenant_id` (so every future token
 * carries a valid tenant claim). Surfaced as HTTP 400.
 */
export class InvalidUuidError extends Error {
  constructor(
    readonly field: string,
    readonly value: string,
  ) {
    super(`"${field}" must be a valid UUID, received "${value}"`);
    this.name = 'InvalidUuidError';
  }
}

/**
 * The Keycloak Admin API rejected an operation. Carries the upstream status so
 * the edge can map a duplicate username to 409 and other failures to 502.
 */
export class KeycloakAdminError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'KeycloakAdminError';
  }
}
