import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';

/** The wrapped action a breaker fires: the caller's own async unit of work. */
type BreakerAction = () => Promise<unknown>;
/** One opossum breaker instance, generically typed over the action wrapper above. */
type ServiceBreaker = CircuitBreaker<[BreakerAction], unknown>;

/**
 * Per-downstream circuit breaker (opossum): lazily builds and caches ONE
 * breaker per `serviceName`, all configured from the same `CB_*` env.
 * Isolation is the entire point — a dead `catalog` upstream must never
 * fast-fail `order`. The caller's action (fetch-with-abort-timeout) owns its
 * own timeout, so opossum's own `timeout` is disabled here to avoid a second,
 * redundant timeout mechanism double-counting a single slow call as two
 * failures.
 *
 * `CB_ENABLED=false` (mirrors `RATE_LIMIT_ENABLED`, off in test envs) makes
 * `run` a pure pass-through: the action is invoked directly and never
 * recorded or able to trip.
 */
@Injectable()
export class CircuitBreakerRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(CircuitBreakerRegistry.name);
  private readonly breakers = new Map<string, ServiceBreaker>();
  private readonly enabled: boolean;
  private readonly options: CircuitBreaker.Options<[BreakerAction]>;

  constructor(config: ConfigService) {
    // Tolerate both the zod-transformed boolean and the raw env string, same
    // rationale as RateLimitGuard: ConfigService may surface the
    // un-transformed process.env value and the string "false" is truthy.
    const enabled = config.get('CB_ENABLED');
    this.enabled = enabled !== false && enabled !== 'false';
    this.options = {
      errorThresholdPercentage: Number(config.getOrThrow('CB_ERROR_THRESHOLD_PERCENT')),
      resetTimeout: Number(config.getOrThrow('CB_RESET_TIMEOUT_MS')),
      rollingCountTimeout: Number(config.getOrThrow('CB_ROLLING_WINDOW_MS')),
      volumeThreshold: Number(config.getOrThrow('CB_VOLUME_THRESHOLD')),
      // The action owns its own AbortController timeout — opossum must not
      // also time it out, or a single slow call would be double-counted.
      timeout: false,
    };
  }

  /** `CB_RESET_TIMEOUT_MS` — how long an open breaker waits before its half-open probe; used to size the `Retry-After` on a fast-fail response. */
  get resetTimeoutMs(): number {
    return this.options.resetTimeout ?? 10_000;
  }

  /**
   * Runs `action` through the named service's breaker (building + caching it
   * on first use). Rejects with an `EOPENBREAKER`-coded error, without ever
   * invoking `action`, once that service's breaker is open.
   */
  async run<T>(serviceName: string, action: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return action();
    }
    // One breaker instance is shared across every call shape for a given
    // service (opossum has no per-fire generic); the caller's own `T` is
    // restored on the way out since `fire` only ever settles with the exact
    // value or error `action` produced.
    return this.breakerFor(serviceName).fire(action as BreakerAction) as Promise<T>;
  }

  /** Shuts every cached breaker down cleanly on Nest application shutdown. */
  onApplicationShutdown(): void {
    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }
  }

  private breakerFor(serviceName: string): ServiceBreaker {
    let breaker = this.breakers.get(serviceName);
    if (breaker) {
      return breaker;
    }
    breaker = new CircuitBreaker<[BreakerAction], unknown>((action) => action(), {
      ...this.options,
      name: serviceName,
    });
    breaker.on('open', () =>
      this.logger.warn(`circuit breaker opened for downstream "${serviceName}"`),
    );
    // opossum's half-open state has no request cap (default capacity is
    // effectively unbounded), so under load EVERY in-flight request during the
    // half-open window probes the real upstream, not just one — if it is still
    // down each pays the full timeout once per reset window. Acceptable: the
    // steady-state fast-fail (the resource-protection win) still holds; a strict
    // single-probe would need throttling opossum can't express cleanly.
    breaker.on('halfOpen', () =>
      this.logger.log(`circuit breaker half-open, probing downstream "${serviceName}"`),
    );
    breaker.on('close', () =>
      this.logger.log(`circuit breaker closed for downstream "${serviceName}"`),
    );
    this.breakers.set(serviceName, breaker);
    return breaker;
  }
}
