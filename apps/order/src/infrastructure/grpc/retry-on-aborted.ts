import { status as GrpcStatus } from '@grpc/grpc-js';

/** Shape of the error `@nestjs/microservices`' gRPC client rejects with. */
interface GrpcClientError {
  code?: number;
  details?: string;
}

function isAborted(error: unknown): boolean {
  return (error as GrpcClientError | undefined)?.code === GrpcStatus.ABORTED;
}

/**
 * Retries a gRPC call a couple of extra times when it fails with ABORTED —
 * inventory surfaces lock contention this way, and it is safe to retry
 * (the underlying reserve/release is guarded by an atomic conditional
 * update, so a retry can never double-apply). Any other error propagates
 * immediately without retrying.
 */
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
  // Unreachable — the loop above always returns or throws — kept for type completeness.
  throw lastError;
}
