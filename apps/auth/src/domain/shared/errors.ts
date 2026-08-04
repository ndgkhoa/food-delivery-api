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

export class ConflictError extends DomainException {
  readonly code = 'CONFLICT';
  readonly httpStatus = 409;
}

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
