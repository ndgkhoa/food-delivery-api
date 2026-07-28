import { KafkaJS } from '@confluentinc/kafka-javascript';

export interface MessagingModuleOptions {
  /** Identifies this process to the broker (shows up in broker logs/metrics). */
  clientId: string;
  /** `host:port` list, e.g. `['localhost:9092']`. */
  brokers: string[];
}

/** DI token for the shared confluent KafkaJS-compatible client instance. */
export const KAFKA_CLIENT = Symbol('KafkaClient');

/** Thin alias so consumers of this lib never import the vendor package directly. */
export type KafkaClient = KafkaJS.Kafka;

/**
 * Builds the singleton confluent client a process shares across its producer,
 * consumers, and admin helper. Kept in its own module (rather than
 * `messaging.module.ts`) so `kafka-producer`/`kafka-consumer`/`kafka-admin`
 * can depend on the `KAFKA_CLIENT` token without importing the module that
 * in turn imports them — avoids a circular dependency.
 */
export function createKafkaClient(options: MessagingModuleOptions): KafkaClient {
  return new KafkaJS.Kafka({
    kafkaJS: { clientId: options.clientId, brokers: options.brokers },
  });
}
