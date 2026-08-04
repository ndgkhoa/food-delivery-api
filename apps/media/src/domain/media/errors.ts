import { DomainException } from '@food-delivery-api/shared-errors';

export class MediaNotFoundError extends DomainException {
  readonly code = 'MEDIA_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly mediaId: string) {
    super(`Media "${mediaId}" not found`);
  }
}

export class InvalidUploadError extends DomainException {
  readonly code = 'MEDIA_INVALID_UPLOAD';
  readonly httpStatus = 400;
}

export class ObjectNotUploadedError extends DomainException {
  readonly code = 'MEDIA_OBJECT_NOT_UPLOADED';
  readonly httpStatus = 409;

  constructor(readonly mediaId: string) {
    super(`Object for media "${mediaId}" is not present in storage`);
  }
}
