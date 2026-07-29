/**
 * Domain errors for the media context. Framework-free on purpose so use cases
 * stay transport-agnostic — the interface layer maps each to an HTTP status
 * (see the media exception filter): not-found → 404, missing-object → 409,
 * invalid-upload → 400.
 */

/** The requested media row does not exist within the caller's tenant scope. */
export class MediaNotFoundError extends Error {
  constructor(readonly mediaId: string) {
    super(`Media "${mediaId}" not found`);
    this.name = 'MediaNotFoundError';
  }
}

/** The upload does not satisfy the MIME allowlist or size bounds — rejected before a PUT URL is issued. */
export class InvalidUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUploadError';
  }
}

/** Completion was requested but the bytes are not present in object storage yet. */
export class ObjectNotUploadedError extends Error {
  constructor(readonly mediaId: string) {
    super(`Object for media "${mediaId}" is not present in storage`);
    this.name = 'ObjectNotUploadedError';
  }
}
