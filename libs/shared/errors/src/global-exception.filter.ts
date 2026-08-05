import { CORRELATION_ID_HEADER } from '@food-delivery-api/shared-logging';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { EntityNotFoundError as TypeOrmEntityNotFoundError } from 'typeorm';
import { DomainException } from './domain-exception';
import type { ErrorEnvelope } from './error-envelope';
import { describeError, normalizeHttpExceptionResponse, reasonPhrase } from './http-error-mapping';

const GENERIC_SERVER_ERROR_MESSAGE = 'Internal server error';
const GENERIC_NOT_FOUND_MESSAGE = 'Resource not found';

interface ResolvedError {
  statusCode: number;
  code?: string;
  message: string | string[];
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request | undefined>();
    const correlationId = this.readCorrelationId(request);
    const resolved = this.resolve(exception, correlationId, request);

    const envelope: ErrorEnvelope = {
      statusCode: resolved.statusCode,
      error: reasonPhrase(resolved.statusCode),
      ...(resolved.code ? { code: resolved.code } : {}),
      message: resolved.message,
      ...(correlationId ? { correlationId } : {}),
      timestamp: new Date().toISOString(),
      path: request?.url ?? '',
    };

    this.respond(ctx.getResponse<Response>(), envelope);
  }

  private respond(response: Response, envelope: ErrorEnvelope): void {
    try {
      response.status(envelope.statusCode).json(envelope);
    } catch (writeError) {
      this.logger.error(`failed to write error envelope: ${describeError(writeError)}`);
    }
  }

  private resolve(
    exception: unknown,
    correlationId: string | undefined,
    request: Request | undefined,
  ): ResolvedError {
    if (exception instanceof DomainException) {
      return { statusCode: exception.httpStatus, code: exception.code, message: exception.message };
    }
    if (exception instanceof HttpException) {
      const { message, code } = normalizeHttpExceptionResponse(exception);
      return { statusCode: exception.getStatus(), code, message };
    }
    if (exception instanceof TypeOrmEntityNotFoundError) {
      return { statusCode: HttpStatus.NOT_FOUND, message: GENERIC_NOT_FOUND_MESSAGE };
    }
    this.logger.error(
      `unhandled exception on ${request?.method ?? '?'} ${request?.url ?? '?'} ` +
        `[correlationId=${correlationId ?? 'none'}]: ${describeError(exception)}`,
    );
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: GENERIC_SERVER_ERROR_MESSAGE };
  }

  private readCorrelationId(request: Request | undefined): string | undefined {
    const header = request?.headers?.[CORRELATION_ID_HEADER];
    return Array.isArray(header) ? header[0] : header;
  }
}
