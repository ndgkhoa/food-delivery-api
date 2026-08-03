import { DomainException } from '@food-delivery-api/shared-errors';

/**
 * Transport-agnostic domain errors for the review service. Use cases throw
 * these; the shared `GlobalExceptionFilter` reads `code`/`httpStatus`
 * directly off each, so the domain/application layers never depend on
 * `@nestjs/common` HTTP semantics.
 */

/** Raised when a rating value outside the 1–5 integer range reaches the domain (defense in depth behind the DTO's own bounds). */
export class InvalidRatingError extends DomainException {
  readonly code = 'REVIEW_INVALID_RATING';
  readonly httpStatus = 400;

  constructor(readonly value: number) {
    super(`Rating must be an integer between 1 and 5, got ${value}`);
  }
}

/** Raised when a comment exceeds the bounded length (defense in depth behind the DTO's own `MaxLength`). */
export class InvalidCommentError extends DomainException {
  readonly code = 'REVIEW_INVALID_COMMENT';
  readonly httpStatus = 400;

  constructor(readonly length: number) {
    super(`Comment must be at most 1000 characters, got ${length}`);
  }
}

/**
 * Raised when no review-eligible record exists for the given order in the
 * caller's tenant — the order doesn't exist, was never confirmed, or belongs
 * to another tenant. Tenant-scoped lookups fail this way rather than a
 * separate "cross-tenant" error so existence is never leaked across tenants.
 */
export class ReviewEligibilityNotFoundError extends DomainException {
  readonly code = 'REVIEW_ELIGIBILITY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" is not eligible for review`);
  }
}

/** Raised when the caller is not the order's owner — the order IS review-eligible, but for a different user. */
export class ReviewNotOwnedError extends DomainException {
  readonly code = 'REVIEW_NOT_OWNED';
  readonly httpStatus = 403;

  constructor(readonly orderId: string) {
    super(`Not permitted to review order "${orderId}"`);
  }
}

/** Raised when a review already exists for the order (the `order_id` unique constraint). */
export class DuplicateReviewError extends DomainException {
  readonly code = 'REVIEW_DUPLICATE';
  readonly httpStatus = 409;

  constructor(readonly orderId: string) {
    super(`Order "${orderId}" has already been reviewed`);
  }
}
