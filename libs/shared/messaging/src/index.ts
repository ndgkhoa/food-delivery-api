export {
  buildDeadLetterMessage,
  DEAD_LETTER_TOPIC_SUFFIX,
  deadLetterTopic,
  type RawInboundMessage,
} from './dead-letter';
export {
  AGGREGATE_ID_HEADER,
  CORRELATION_ID_HEADER,
  decodeHeaders,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  type EventEnvelope,
  type EventEnvelopeHeaders,
  encodeHeaders,
  MissingEventHeaderError,
  OCCURRED_AT_HEADER,
  type RawKafkaHeaders,
  TENANT_ID_HEADER,
} from './event-envelope';
export type { ProcessedEventStorePort } from './idempotent-consumer';
export {
  DuplicateEventError,
  IdempotentConsumer,
  PROCESSED_EVENT_STORE,
} from './idempotent-consumer';
export type { KafkaTopicSpec } from './kafka-admin';
export {
  DEFAULT_TOPIC_PARTITIONS,
  DEFAULT_TOPIC_REPLICATION_FACTOR,
  KafkaTopicAdmin,
} from './kafka-admin';
export type { KafkaClient, MessagingModuleOptions } from './kafka-client';
export { createKafkaClient, KAFKA_CLIENT } from './kafka-client';
export type {
  DecodedKafkaMessage,
  HandlerOutcome,
  KafkaMessageHandler,
  KafkaSubscribeOptions,
} from './kafka-consumer';
export {
  consumeOneMessage,
  decodeMessage,
  KafkaConsumerSubscriber,
  runHandlerWithRetry,
} from './kafka-consumer';
export type { MessageProducer, OutboundKafkaMessage } from './kafka-producer';
export { ConfluentMessageProducer, KAFKA_PRODUCER } from './kafka-producer';
export { type DropReason, MessageDropCounter } from './message-drop-counter';
export { MessagingModule } from './messaging.module';
export type { OutboxPort, OutboxRecord, OutboxRelayOptions } from './outbox-relay';
export { OUTBOX_PORT, OutboxRelay } from './outbox-relay';
