import type { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  createKafkaClient,
  DEFAULT_TOPIC_PARTITIONS,
  DEFAULT_TOPIC_REPLICATION_FACTOR,
  type KafkaClient,
} from '@food-delivery-api/shared-messaging';
import type { ConfigCache } from './config-cache';
import type { ConfigEventsConsumerLogger } from './config-client-logger';
import {
  CONFIG_EVENTS_TOPIC,
  type ConfigChangeMessage,
  evictForConfigChange,
} from './config-events';

export interface ConfigEventsConsumerOptions {
  /** `host:port` list for the Kafka broker(s), e.g. `['localhost:9092']`. */
  kafkaBrokers: string[];
}

/**
 * Subscribes to `config.events` and evicts the changed entry from BOTH
 * caches (a key is either a value or a flag, never both, so evicting in both
 * is a harmless no-op for the other). Deliberately lightweight — this is a
 * pure cache-invalidation side effect, safely re-run on redelivery, so it
 * bypasses the heavier `KafkaConsumerSubscriber` (DLQ/retry/tenant-scope
 * machinery built for business event handlers) and manages its own client.
 */
export class ConfigEventsConsumer {
  private readonly client: KafkaClient;
  private consumer?: KafkaJS.Consumer;

  constructor(
    options: ConfigEventsConsumerOptions,
    private readonly valueCache: ConfigCache<number>,
    private readonly flagCache: ConfigCache<boolean>,
    private readonly logger: ConfigEventsConsumerLogger,
  ) {
    this.client = createKafkaClient({
      clientId: `config-client-${Math.random().toString(36).slice(2)}`,
      brokers: options.kafkaBrokers,
    });
  }

  async start(): Promise<void> {
    await this.ensureTopicExists();
    this.consumer = this.client.consumer({
      kafkaJS: {
        groupId: `config-client-${Math.random().toString(36).slice(2)}`,
        autoCommit: true,
        // Read from the beginning: a fresh (random) group starting at `latest`
        // only sees events produced AFTER partition assignment completes, so a
        // config change during the brief assignment window would be missed.
        // Replaying the whole low-volume topic is safe — evicting an uncached
        // key is a no-op — and guarantees no change is ever missed. The random
        // group is deliberate: this is a per-instance fan-out (every process
        // must evict its OWN cache), so each instance needs its own group and
        // reads every partition.
        fromBeginning: true,
      },
    });
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [CONFIG_EVENTS_TOPIC] });
    await this.consumer.run({
      eachMessage: async ({ message }) => this.handleMessage(message.value),
    });
    this.logger.log(`Subscribed to ${CONFIG_EVENTS_TOPIC} for config-client cache invalidation`);
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

  /**
   * Idempotently creates the topic before subscribing — a config-client
   * consumer may be the FIRST process to reach the broker (the config
   * service itself never subscribes to its own topic).
   */
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
