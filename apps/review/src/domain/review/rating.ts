import { InvalidRatingError } from '@review/domain/shared/errors';

const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * 1–5 integer rating value object. The HTTP DTO already bounds this
 * (`@IsInt @Min(1) @Max(5)`); this is defense in depth so no code path —
 * present or future — can persist an out-of-range rating by constructing a
 * `Review` directly.
 */
export class Rating {
  private constructor(private readonly value: number) {}

  static create(value: number): Rating {
    if (!Number.isInteger(value) || value < MIN_RATING || value > MAX_RATING) {
      throw new InvalidRatingError(value);
    }
    return new Rating(value);
  }

  toNumber(): number {
    return this.value;
  }
}
