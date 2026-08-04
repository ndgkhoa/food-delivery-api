import { type DynamicModule, Module } from '@nestjs/common';
import { createKafkaClient, KAFKA_CLIENT, type MessagingModuleOptions } from './kafka-client';
import { ConfluentMessageProducer, KAFKA_PRODUCER } from './kafka-producer';

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
