import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import {
  DuplicateReviewError,
  InvalidCommentError,
  InvalidRatingError,
  ReviewEligibilityNotFoundError,
  ReviewNotOwnedError,
} from '@review/domain/shared/errors';
import type { Response } from 'express';

type ReviewDomainError =
  | ReviewEligibilityNotFoundError
  | ReviewNotOwnedError
  | DuplicateReviewError
  | InvalidRatingError
  | InvalidCommentError;

/** Maps each transport-agnostic review domain error to its HTTP status. */
function statusFor(exception: ReviewDomainError): number {
  switch (exception.name) {
    case 'ReviewEligibilityNotFoundError':
      return HttpStatus.NOT_FOUND;
    case 'ReviewNotOwnedError':
      return HttpStatus.FORBIDDEN;
    case 'DuplicateReviewError':
      return HttpStatus.CONFLICT;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Translates review domain errors into their HTTP status, keeping status-code
 * concerns out of the use cases (mirrors order's `OrderDomainErrorFilter`).
 */
@Catch(
  ReviewEligibilityNotFoundError,
  ReviewNotOwnedError,
  DuplicateReviewError,
  InvalidRatingError,
  InvalidCommentError,
)
export class ReviewDomainErrorFilter implements ExceptionFilter {
  catch(exception: ReviewDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = statusFor(exception);
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: exception.name,
    });
  }
}
