/**
 * The single JSON shape every service returns for an HTTP error response,
 * produced by `GlobalExceptionFilter`. `code` is present for `DomainException`s
 * (and any `HttpException` whose response body opts in with its own `code`);
 * omitted otherwise. `message` is a human string, or `string[]` for
 * validation errors (mirrors Nest's `ValidationPipe` shape).
 */
export interface ErrorEnvelope {
  statusCode: number;
  error: string;
  code?: string;
  message: string | string[];
  correlationId?: string;
  timestamp: string;
  path: string;
}
