import {
  DuplicateReviewError,
  InvalidCommentError,
  InvalidRatingError,
  ReviewEligibilityNotFoundError,
  ReviewNotOwnedError,
} from '@review/domain/shared/errors';

const orderId = '11111111-1111-4111-8111-111111111111';

describe('InvalidRatingError', () => {
  it('carries the rejected rating value', () => {
    const error = new InvalidRatingError(7);

    expect(error.code).toBe('REVIEW_INVALID_RATING');
    expect(error.httpStatus).toBe(400);
    expect(error.value).toBe(7);
    expect(error.message).toBe('Rating must be an integer between 1 and 5, got 7');
  });
});

describe('InvalidCommentError', () => {
  it('carries the rejected comment length', () => {
    const error = new InvalidCommentError(1200);

    expect(error.code).toBe('REVIEW_INVALID_COMMENT');
    expect(error.httpStatus).toBe(400);
    expect(error.length).toBe(1200);
    expect(error.message).toBe('Comment must be at most 1000 characters, got 1200');
  });
});

describe('ReviewEligibilityNotFoundError', () => {
  it('carries the ineligible order id', () => {
    const error = new ReviewEligibilityNotFoundError(orderId);

    expect(error.code).toBe('REVIEW_ELIGIBILITY_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
    expect(error.orderId).toBe(orderId);
    expect(error.message).toBe(`Order "${orderId}" is not eligible for review`);
  });
});

describe('ReviewNotOwnedError', () => {
  it('carries the disallowed order id', () => {
    const error = new ReviewNotOwnedError(orderId);

    expect(error.code).toBe('REVIEW_NOT_OWNED');
    expect(error.httpStatus).toBe(403);
    expect(error.orderId).toBe(orderId);
    expect(error.message).toBe(`Not permitted to review order "${orderId}"`);
  });
});

describe('DuplicateReviewError', () => {
  it('carries the already-reviewed order id', () => {
    const error = new DuplicateReviewError(orderId);

    expect(error.code).toBe('REVIEW_DUPLICATE');
    expect(error.httpStatus).toBe(409);
    expect(error.orderId).toBe(orderId);
    expect(error.message).toBe(`Order "${orderId}" has already been reviewed`);
  });
});
