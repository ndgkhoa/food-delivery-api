import { Rating } from '@review/domain/review/rating';
import { InvalidRatingError } from '@review/domain/shared/errors';

describe('Rating', () => {
  it.each([1, 2, 3, 4, 5])('accepts the in-range integer %i', (value) => {
    expect(Rating.create(value).toNumber()).toBe(value);
  });

  it.each([0, 6, -1, 10])('rejects the out-of-range integer %i', (value) => {
    expect(() => Rating.create(value)).toThrow(InvalidRatingError);
  });

  it.each([1.5, 3.2, Number.NaN])('rejects a non-integer value %s', (value) => {
    expect(() => Rating.create(value)).toThrow(InvalidRatingError);
  });
});
