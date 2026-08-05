import { type HttpException, HttpStatus } from '@nestjs/common';

interface HttpExceptionResponseBody {
  message?: string | string[];
  code?: string;
}

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

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
