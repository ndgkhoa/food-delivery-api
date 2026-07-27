/**
 * Domain-layer error signalling that a requested aggregate does not exist
 * within the caller's tenant scope. Thrown by use cases; the transport layer
 * (HTTP filter, future gRPC/consumer edges) decides how to surface it. Keeping
 * this framework-free lets non-HTTP callers reuse the same use cases without
 * inheriting an HTTP status concern.
 */
export class EntityNotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly entityId: string,
    message?: string,
  ) {
    super(message ?? `${entity} "${entityId}" not found`);
    this.name = 'EntityNotFoundError';
  }
}
