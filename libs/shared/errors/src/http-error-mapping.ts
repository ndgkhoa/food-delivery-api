import { type HttpException, HttpStatus } from '@nestjs/common';

/** Nest's built-in `HttpException`s carry either a plain string or `{message, error?}` as their response body. */
interface HttpExceptionResponseBody {
  message?: string | string[];
  code?: string;
}

/**
 * Extracts the human message (+ an optional passthrough `code`) from an
 * `HttpException`'s response body — handles both the plain-string form and
 * the object form (including `ValidationPipe`'s `message: string[]`).
 */
export function normalizeHttpExceptionResponse(exception: HttpException): {
  message: string | string[];
  code?: string;
} {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return { message: response };
  }
  const body = response as HttpExceptionResponseBody;
  const code = typeof body.code === 'string' ? body.code : undefined;
  return { message: body.message ?? exception.message, code };
}

/** Derives the HTTP reason phrase from a status code (e.g. 404 -> "Not Found"), matching Nest's own `HttpStatus` names. */
export function reasonPhrase(status: number): string {
  const name = (HttpStatus as unknown as Record<number, string | undefined>)[status];
  if (!name) {
    return status >= 500 ? 'Internal Server Error' : 'Error';
  }
  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Safe description of an unknown thrown value for server-side logging ONLY — never placed in a response body. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
