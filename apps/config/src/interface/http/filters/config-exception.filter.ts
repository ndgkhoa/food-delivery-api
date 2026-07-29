import {
  ConfigEntryNotFoundError,
  FeatureFlagNotFoundError,
  GlobalWriteRequiresPlatformAdminError,
} from '@config/domain/shared/errors';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

type ConfigDomainError =
  | ConfigEntryNotFoundError
  | FeatureFlagNotFoundError
  | GlobalWriteRequiresPlatformAdminError;

/**
 * Translates the transport-agnostic config domain errors into HTTP statuses
 * at the edge, keeping status concerns out of the use cases: not-found → 404,
 * global-write-without-platform-admin → 403.
 */
@Catch(ConfigEntryNotFoundError, FeatureFlagNotFoundError, GlobalWriteRequiresPlatformAdminError)
export class ConfigExceptionFilter implements ExceptionFilter {
  catch(exception: ConfigDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, error } = mapError(exception);
    response.status(status).json({ statusCode: status, message: exception.message, error });
  }
}

function mapError(exception: ConfigDomainError): { status: number; error: string } {
  if (exception instanceof GlobalWriteRequiresPlatformAdminError) {
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
}
