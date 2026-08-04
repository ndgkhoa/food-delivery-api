import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';

type BreakerAction = () => Promise<unknown>;
type ServiceBreaker = CircuitBreaker<[BreakerAction], unknown>;

@Injectable()
export class CircuitBreakerRegistry implements OnApplicationShutdown {
  private readonly logger = new Logger(CircuitBreakerRegistry.name);
  private readonly breakers = new Map<string, ServiceBreaker>();
  private readonly enabled: boolean;
  private readonly options: CircuitBreaker.Options<[BreakerAction]>;

  constructor(config: ConfigService) {
    const enabled = config.get('CB_ENABLED');
    this.enabled = enabled !== false && enabled !== 'false';
    this.options = {
      errorThresholdPercentage: Number(config.getOrThrow('CB_ERROR_THRESHOLD_PERCENT')),
      resetTimeout: Number(config.getOrThrow('CB_RESET_TIMEOUT_MS')),
      rollingCountTimeout: Number(config.getOrThrow('CB_ROLLING_WINDOW_MS')),
      volumeThreshold: Number(config.getOrThrow('CB_VOLUME_THRESHOLD')),
      timeout: false,
    };
  }

  get resetTimeoutMs(): number {
    return this.options.resetTimeout ?? 10_000;
  }

  async run<T>(serviceName: string, action: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return action();
    }
    return this.breakerFor(serviceName).fire(action as BreakerAction) as Promise<T>;
  }

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
