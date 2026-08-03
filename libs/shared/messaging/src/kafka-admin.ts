import { Inject, Injectable, Logger } from '@nestjs/common';
import { KAFKA_CLIENT, type KafkaClient } from './kafka-client';

export interface KafkaTopicSpec {
  topic: string;
  partitions?: number;
  replicationFactor?: number;
}

export const DEFAULT_TOPIC_PARTITIONS = 3;
export const DEFAULT_TOPIC_REPLICATION_FACTOR = 1;

/**
 * Idempotently ensures topics exist with the repo's standard shape (3
 * partitions, RF=1 by default — enough to exercise keyed-partition ordering
 * on a single-broker dev cluster). Safe to call on every service boot:
 * `createTopics` is a no-op for topics that already exist.
 */
@Injectable()
export class KafkaTopicAdmin {
  private readonly logger = new Logger(KafkaTopicAdmin.name);

  constructor(@Inject(KAFKA_CLIENT) private readonly client: KafkaClient) {}

  async ensureTopics(specs: KafkaTopicSpec[]): Promise<void> {
    if (specs.length === 0) {
      return;
    }
    const admin = this.client.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        topics: specs.map((spec) => ({
          topic: spec.topic,
          numPartitions: spec.partitions ?? DEFAULT_TOPIC_PARTITIONS,
          replicationFactor: spec.replicationFactor ?? DEFAULT_TOPIC_REPLICATION_FACTOR,
        })),
      });
      this.logger.log(`Ensured Kafka topics exist: ${specs.map((spec) => spec.topic).join(', ')}`);
    } finally {
      await admin.disconnect();
    }
  }
}
