import type { Rating } from '@review/domain/review/rating';
import { InvalidCommentError } from '@review/domain/shared/errors';

const MAX_COMMENT_LENGTH = 1000;

export interface ReviewProps {
  id: string;
  tenantId: string;
  orderId: string;
  restaurantId: string;
  userId: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
}

export interface CreateReviewProps {
  id: string;
  tenantId: string;
  orderId: string;
  restaurantId: string;
  userId: string;
  rating: Rating;
  comment?: string | null;
}

function normalizeComment(comment?: string | null): string | null {
  if (comment === undefined || comment === null) {
    return null;
  }
  const trimmed = comment.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new InvalidCommentError(trimmed.length);
  }
  return trimmed;
}

export class Review {
  private constructor(private readonly props: ReviewProps) {}

  static create(props: CreateReviewProps): Review {
    return new Review({
      id: props.id,
      tenantId: props.tenantId,
      orderId: props.orderId,
      restaurantId: props.restaurantId,
      userId: props.userId,
      rating: props.rating.toNumber(),
      comment: normalizeComment(props.comment),
      createdAt: new Date(),
    });
  }

  static reconstitute(props: ReviewProps): Review {
    return new Review(props);
  }

  get id(): string {
    return this.props.id;
  }

  get tenantId(): string {
    return this.props.tenantId;
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get restaurantId(): string {
    return this.props.restaurantId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get rating(): number {
    return this.props.rating;
  }

  get comment(): string | null {
    return this.props.comment;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
