import {
  type DynamicModule,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigEventsConsumer } from './config-events.consumer';
import { SettingsCache } from './settings-cache';
import { SettingsClient } from './settings-client';

export interface SettingsClientModuleOptions {
  /** Base URL of the config service, e.g. `http://localhost:3008`. */
  configServiceUrl: string;
  /** Cache TTL in ms — the self-healing backstop if a `config.events` invalidation is ever missed. */
  ttlMs: number;
  /** `host:port` list for the Kafka broker(s) the eviction consumer connects to. */
  kafkaBrokers: string[];
}

export const SETTINGS_CLIENT = Symbol('SettingsClient');

/**
 * Owns the `ConfigEventsConsumer`'s process lifecycle: starts it once the
 * host app has bootstrapped, stops it on shutdown. Disabled under
 * `NODE_ENV=test` (mirrors every other Kafka consumer in this repo, e.g.
 * `OrderEventsConsumer`) so in-process test suites never need a live broker
 * just because they imported `SettingsClientModule`.
 */
@Injectable()
class ConfigEventsConsumerLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ConfigEventsConsumerLifecycle.name);

  constructor(private readonly consumer: ConfigEventsConsumer) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      this.logger.warn(
        'settings-client cache invalidation disabled (NODE_ENV=test): config.events not consumed',
      );
      return;
    }
    await this.consumer.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.stop();
  }
}

/**
 * Nest dynamic module wiring the read-through `SettingsClient` + its
 * `config.events` cache-eviction consumer. Import once per host app via
 * `SettingsClientModule.forRoot({ configServiceUrl, ttlMs, kafkaBrokers })` and
 * inject `SETTINGS_CLIENT` wherever a use case needs `getInt`/`isEnabled`.
 */
@Module({})
export class SettingsClientModule {
  static forRoot(options: SettingsClientModuleOptions): DynamicModule {
    const logger = new Logger('SettingsClient');
    const valueCache = new SettingsCache<number>();
    const flagCache = new SettingsCache<boolean>();

    return {
      module: SettingsClientModule,
      providers: [
        {
          provide: SETTINGS_CLIENT,
          useValue: new SettingsClient(
            { configServiceUrl: options.configServiceUrl, ttlMs: options.ttlMs },
            valueCache,
            flagCache,
            logger,
          ),
        },
        {
          provide: ConfigEventsConsumer,
          useValue: new ConfigEventsConsumer(
            { kafkaBrokers: options.kafkaBrokers },
            valueCache,
            flagCache,
            logger,
          ),
        },
        ConfigEventsConsumerLifecycle,
      ],
      exports: [SETTINGS_CLIENT],
    };
  }
}
