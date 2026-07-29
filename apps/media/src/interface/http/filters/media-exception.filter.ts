import {
  InvalidUploadError,
  MediaNotFoundError,
  ObjectNotUploadedError,
} from '@media/domain/media/errors';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Translates the transport-agnostic media domain errors into HTTP statuses at
 * the edge, keeping status concerns out of the use cases: not-found → 404,
 * missing-object-on-complete → 409, invalid-upload → 400.
 */
@Catch(MediaNotFoundError, InvalidUploadError, ObjectNotUploadedError)
export class MediaExceptionFilter implements ExceptionFilter {
  catch(
    exception: MediaNotFoundError | InvalidUploadError | ObjectNotUploadedError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, error } = mapError(exception);
    response.status(status).json({ statusCode: status, message: exception.message, error });
  }
}

function mapError(exception: MediaNotFoundError | InvalidUploadError | ObjectNotUploadedError): {
  status: number;
  error: string;
} {
  if (exception instanceof MediaNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (exception instanceof ObjectNotUploadedError) {
    return { status: HttpStatus.CONFLICT, error: 'Conflict' };
  }
  return { status: HttpStatus.BAD_REQUEST, error: 'Bad Request' };
}
