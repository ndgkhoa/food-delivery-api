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
  configServiceUrl: string;
  ttlMs: number;
  kafkaBrokers: string[];
}

export const SETTINGS_CLIENT = Symbol('SettingsClient');

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
