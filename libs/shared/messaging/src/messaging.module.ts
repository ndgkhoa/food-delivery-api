import { type DynamicModule, Module } from '@nestjs/common';
import { createKafkaClient, KAFKA_CLIENT, type MessagingModuleOptions } from './kafka-client';
import { ConfluentMessageProducer, KAFKA_PRODUCER } from './kafka-producer';

/**
 * Wires the shared confluent Kafka client + idempotent producer for a
 * process. Import once via `MessagingModule.forRoot({ clientId, brokers })`
 * in the composition root; inject `KAFKA_CLIENT` to build consumers/admin
 * clients (`KafkaConsumerSubscriber`, `KafkaTopicAdmin`) or `KAFKA_PRODUCER`
 * to publish. Those helper classes are NOT registered here — a consuming
 * service adds them to its own providers so each service controls which
 * topics/groups it subscribes to.
 */
@Module({})
export class MessagingModule {
  static forRoot(options: MessagingModuleOptions): DynamicModule {
    return {
      module: MessagingModule,
      providers: [
        { provide: KAFKA_CLIENT, useValue: createKafkaClient(options) },
        ConfluentMessageProducer,
        { provide: KAFKA_PRODUCER, useExisting: ConfluentMessageProducer },
      ],
      exports: [KAFKA_CLIENT, KAFKA_PRODUCER],
    };
  }
}
