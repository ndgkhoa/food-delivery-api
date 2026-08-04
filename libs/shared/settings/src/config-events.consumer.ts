import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  createKafkaClient,
  DEFAULT_TOPIC_PARTITIONS,
  DEFAULT_TOPIC_REPLICATION_FACTOR,
  type KafkaClient,
} from '@food-delivery-api/shared-messaging';
import {
  CONFIG_EVENTS_TOPIC,
  type ConfigChangeMessage,
  evictForConfigChange,
} from './config-events';
import type { SettingsCache } from './settings-cache';
import type { ConfigEventsConsumerLogger } from './settings-client-logger';

export interface ConfigEventsConsumerOptions {
  kafkaBrokers: string[];
}

export class ConfigEventsConsumer {
  private readonly client: KafkaClient;
  private consumer?: KafkaJS.Consumer;

  constructor(
    options: ConfigEventsConsumerOptions,
    private readonly valueCache: SettingsCache<number>,
    private readonly flagCache: SettingsCache<boolean>,
    private readonly logger: ConfigEventsConsumerLogger,
  ) {
    this.client = createKafkaClient({
      clientId: `settings-client-${Math.random().toString(36).slice(2)}`,
      brokers: options.kafkaBrokers,
    });
  }

  async start(): Promise<void> {
    await this.ensureTopicExists();
    this.consumer = this.client.consumer({
      kafkaJS: {
        groupId: `settings-client-${Math.random().toString(36).slice(2)}`,
        autoCommit: true,
        fromBeginning: true,
      },
    });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [CONFIG_EVENTS_TOPIC] });
    await this.consumer.run({
      eachMessage: async ({ message }) => this.handleMessage(message.value),
    });
    this.logger.log(`Subscribed to ${CONFIG_EVENTS_TOPIC} for settings-client cache invalidation`);
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
  }

  private handleMessage(rawValue: Buffer | string | null | undefined): void {
    if (!rawValue) {
      return;
    }
    let payload: ConfigChangeMessage;
    try {
      payload = JSON.parse(rawValue.toString('utf8')) as ConfigChangeMessage;
    } catch (error) {
      this.logger.warn(
        `Skipping malformed ${CONFIG_EVENTS_TOPIC} message: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (!payload.key) {
      return;
    }
    evictForConfigChange(payload, this.valueCache, this.flagCache);
  }

  private async ensureTopicExists(): Promise<void> {
    const admin = this.client.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: [
          {
            topic: CONFIG_EVENTS_TOPIC,
            numPartitions: DEFAULT_TOPIC_PARTITIONS,
            replicationFactor: DEFAULT_TOPIC_REPLICATION_FACTOR,
          },
        ],
      });
    } finally {
      await admin.disconnect();
    }
  }
}
