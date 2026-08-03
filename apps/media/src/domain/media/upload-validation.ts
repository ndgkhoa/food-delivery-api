import { InvalidUploadError } from '@media/domain/media/errors';

/**
 * Enforces the upload policy BEFORE a presigned PUT URL is ever issued: the
 * content type must be on the allowlist and the declared size must be a positive
 * integer within the byte ceiling. Throwing here means no metadata row and no
 * upload URL are created for a disallowed request.
 */
export function assertAllowedUpload(
  contentType: string,
  sizeBytes: number,
  allowedMimes: readonly string[],
  maxBytes: number,
): void {
  if (!allowedMimes.includes(contentType)) {
    throw new InvalidUploadError(`Unsupported content type "${contentType}"`);
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new InvalidUploadError('Upload size must be a positive integer number of bytes');
  }
  if (sizeBytes > maxBytes) {
    throw new InvalidUploadError(`Upload size ${sizeBytes} exceeds the ${maxBytes} byte limit`);
  }
}
