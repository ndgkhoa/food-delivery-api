/**
 * Base class for framework-free domain errors that carry their own HTTP
 * mapping. Each bounded context extends this with a stable machine `code`
 * (e.g. `ORDER_NOT_FOUND`) and the `httpStatus` the shared
 * `GlobalExceptionFilter` should respond with — so the filter never needs a
 * per-service status switch, and use cases stay transport-agnostic (only the
 * status/code live on the error, not any HTTP framework dependency).
 */
export abstract class DomainException extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    // `new.target` resolves to the concrete subclass being constructed, so every
    // domain error self-reports its real class name without each subclass
    // repeating `this.name = '...'`.
    this.name = new.target.name;
  }
}
