import { KafkaJS } from '@confluentinc/kafka-javascript';

export interface MessagingModuleOptions {
  clientId: string;
  brokers: string[];
}

export const KAFKA_CLIENT = Symbol('KafkaClient');

export type KafkaClient = KafkaJS.Kafka;

export function createKafkaClient(options: MessagingModuleOptions): KafkaClient {
  return new KafkaJS.Kafka({
    kafkaJS: { clientId: options.clientId, brokers: options.brokers },
  });
}
