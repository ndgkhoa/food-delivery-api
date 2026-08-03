import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Domain errors for the media context. Framework-free (beyond the
 * `DomainException` base) so use cases stay transport-agnostic — the shared
 * `GlobalExceptionFilter` reads `code`/`httpStatus` directly off each:
 * not-found → 404, missing-object → 409, invalid-upload → 400.
 */

/** The requested media row does not exist within the caller's tenant scope. */
export class MediaNotFoundError extends DomainException {
  readonly code = 'MEDIA_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly mediaId: string) {
    super(`Media "${mediaId}" not found`);
  }
}

/** The upload does not satisfy the MIME allowlist or size bounds — rejected before a PUT URL is issued. */
export class InvalidUploadError extends DomainException {
  readonly code = 'MEDIA_INVALID_UPLOAD';
  readonly httpStatus = 400;
}

/** Completion was requested but the bytes are not present in object storage yet. */
export class ObjectNotUploadedError extends DomainException {
  readonly code = 'MEDIA_OBJECT_NOT_UPLOADED';
  readonly httpStatus = 409;

  constructor(readonly mediaId: string) {
    super(`Object for media "${mediaId}" is not present in storage`);
  }
}
