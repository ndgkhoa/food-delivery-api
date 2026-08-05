import { status as GrpcStatus } from '@grpc/grpc-js';

interface GrpcClientError {
  code?: number;
  details?: string;
}

function isAborted(error: unknown): boolean {
  return (error as GrpcClientError | undefined)?.code === GrpcStatus.ABORTED;
}

export async function retryOnAborted<T>(call: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      if (!isAborted(error) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
  throw lastError;
}
