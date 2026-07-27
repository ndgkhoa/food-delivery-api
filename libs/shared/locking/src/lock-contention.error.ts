/**
 * Raised by `withLocks` when a key is already held by another caller. Framework-
 * free so any transport (gRPC status, HTTP 409) can translate it at the edge.
 */
export class LockContentionError extends Error {
  constructor(readonly key: string) {
    super(`Could not acquire lock for "${key}" — held by another caller`);
    this.name = 'LockContentionError';
  }
}
