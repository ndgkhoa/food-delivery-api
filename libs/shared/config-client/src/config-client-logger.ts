/**
 * Minimal logger shape so this lib never hard-depends on `@nestjs/common`'s
 * `Logger` class — the module wiring passes a real Nest `Logger` in, but a
 * plain object (or a test double) satisfies this just as well.
 */
export interface ConfigClientLogger {
  warn(message: string): void;
}

/** `ConfigEventsConsumer` also logs an informational start-up message. */
export interface ConfigEventsConsumerLogger extends ConfigClientLogger {
  log(message: string): void;
}
