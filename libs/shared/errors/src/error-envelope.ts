export interface ErrorEnvelope {
  statusCode: number;
  error: string;
  code?: string;
  message: string | string[];
  correlationId?: string;
  timestamp: string;
  path: string;
}
