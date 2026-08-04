import { InvalidRatingError } from '@review/domain/shared/errors';

const MIN_RATING = 1;
const MAX_RATING = 5;

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
