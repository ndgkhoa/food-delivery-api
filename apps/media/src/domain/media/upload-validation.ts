import { InvalidUploadError } from '@media/domain/media/errors';

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
