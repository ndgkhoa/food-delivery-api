import type { DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { CORRELATION_ID_HEADER } from './correlation-id.constants';

/**
 * Structured (pino) logging wired to the correlation ID set by
 * `correlationIdMiddleware`, so every log line for a request can be
 * grepped/traced by `x-correlation-id`. Pretty-prints in non-production
 * for readable local dev output; ships raw JSON otherwise.
 */
export class SharedLoggingModule {
  static forRoot(): DynamicModule {
    return LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          genReqId: (req: { headers: Record<string, unknown> }) =>
            req.headers[CORRELATION_ID_HEADER] as string,
          customProps: (req: { headers: Record<string, unknown> }) => ({
            correlationId: req.headers[CORRELATION_ID_HEADER],
          }),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          transport:
            config.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
        },
      }),
    });
  }
}
