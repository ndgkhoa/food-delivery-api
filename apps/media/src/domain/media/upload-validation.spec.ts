import { InvalidUploadError } from '@media/domain/media/errors';
import { assertAllowedUpload } from '@media/domain/media/upload-validation';

describe('assertAllowedUpload', () => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const maxBytes = 5_000_000;

  it('accepts an allowed MIME within the size limit', () => {
    expect(() => assertAllowedUpload('image/png', 1_000, allowed, maxBytes)).not.toThrow();
  });

  it('rejects a disallowed MIME type', () => {
    expect(() => assertAllowedUpload('application/pdf', 1_000, allowed, maxBytes)).toThrow(
      InvalidUploadError,
    );
  });

  it('rejects an over-size upload', () => {
    expect(() => assertAllowedUpload('image/jpeg', maxBytes + 1, allowed, maxBytes)).toThrow(
      InvalidUploadError,
    );
  });

  it('rejects a non-positive or non-integer size', () => {
    expect(() => assertAllowedUpload('image/jpeg', 0, allowed, maxBytes)).toThrow(
      InvalidUploadError,
    );
    expect(() => assertAllowedUpload('image/jpeg', -10, allowed, maxBytes)).toThrow(
      InvalidUploadError,
    );
    expect(() => assertAllowedUpload('image/jpeg', 12.5, allowed, maxBytes)).toThrow(
      InvalidUploadError,
    );
  });

  it('accepts a size exactly at the limit', () => {
    expect(() => assertAllowedUpload('image/webp', maxBytes, allowed, maxBytes)).not.toThrow();
  });
});
