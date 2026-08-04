import { DomainException } from '@food-delivery-api/shared-errors';

export class InvalidRatingError extends DomainException {
  readonly code = 'REVIEW_INVALID_RATING';
  readonly httpStatus = 400;

  constructor(readonly value: number) {
    super(`Rating must be an integer between 1 and 5, got ${value}`);
  }
}

export class InvalidCommentError extends DomainException {
  readonly code = 'REVIEW_INVALID_COMMENT';
  readonly httpStatus = 400;

  constructor(readonly length: number) {
    super(`Comment must be at most 1000 characters, got ${length}`);
  }
}

export class ReviewEligibilityNotFoundError extends DomainException {
  readonly code = 'REVIEW_ELIGIBILITY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" is not eligible for review`);
  }
}

export class ReviewNotOwnedError extends DomainException {
  readonly code = 'REVIEW_NOT_OWNED';
  readonly httpStatus = 403;

  constructor(readonly orderId: string) {
    super(`Not permitted to review order "${orderId}"`);
  }
}

export class DuplicateReviewError extends DomainException {
  readonly code = 'REVIEW_DUPLICATE';
  readonly httpStatus = 409;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" has already been reviewed`);
  }
}
