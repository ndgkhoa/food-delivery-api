import { Rating } from '@review/domain/review/rating';
import { Review } from '@review/domain/review/review';
import { InvalidCommentError } from '@review/domain/shared/errors';

const id = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const restaurantId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';

function buildCreateProps(overrides: Partial<Parameters<typeof Review.create>[0]> = {}) {
  return {
    id,
    tenantId,
    orderId,
    restaurantId,
    userId,
    rating: Rating.create(4),
    ...overrides,
  };
}

describe('Review', () => {
  it('creates a review and trims a non-empty comment', () => {
    const review = Review.create(buildCreateProps({ comment: '  great food  ' }));

    expect(review.id).toBe(id);
    expect(review.tenantId).toBe(tenantId);
    expect(review.orderId).toBe(orderId);
    expect(review.restaurantId).toBe(restaurantId);
    expect(review.userId).toBe(userId);
    expect(review.rating).toBe(4);
    expect(review.comment).toBe('great food');
    expect(review.createdAt).toBeInstanceOf(Date);
  });

  it('normalizes an undefined comment to null', () => {
    const review = Review.create(buildCreateProps());

    expect(review.comment).toBeNull();
  });

  it('normalizes an explicit null comment to null', () => {
    const review = Review.create(buildCreateProps({ comment: null }));

    expect(review.comment).toBeNull();
  });

  it('normalizes a whitespace-only comment to null', () => {
    const review = Review.create(buildCreateProps({ comment: '   ' }));

    expect(review.comment).toBeNull();
  });

  it('rejects a comment longer than 1000 characters', () => {
    const comment = 'a'.repeat(1001);

    expect(() => Review.create(buildCreateProps({ comment }))).toThrow(InvalidCommentError);
  });

  it('accepts a comment exactly at the 1000 character limit', () => {
    const comment = 'a'.repeat(1000);

    const review = Review.create(buildCreateProps({ comment }));

    expect(review.comment).toBe(comment);
  });

  it('rehydrates already-validated persistence data without re-validating', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const review = Review.reconstitute({
      id,
      tenantId,
      orderId,
      restaurantId,
      userId,
      rating: 5,
      comment: 'restored',
      createdAt,
    });

    expect(review.id).toBe(id);
    expect(review.tenantId).toBe(tenantId);
    expect(review.rating).toBe(5);
    expect(review.comment).toBe('restored');
    expect(review.createdAt).toBe(createdAt);
  });
});
