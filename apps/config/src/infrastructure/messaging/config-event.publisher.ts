import { randomUUID } from 'node:crypto';
import {
  CONFIG_VALUE_CHANGED,
  type ConfigChangePayload,
  type ConfigEventPublisherPort,
  FEATURE_FLAG_CHANGED,
} from '@config/domain/config/config-event';
import {
  encodeHeaders,
  KAFKA_PRODUCER,
  type MessageProducer,
} from '@food-delivery-api/shared-messaging';
import { Inject, Injectable } from '@nestjs/common';

const CONFIG_EVENTS_TOPIC = 'config.events';
/**
 * The envelope's `tenantId` header must be non-empty (`decodeHeaders` fails
 * closed on a missing/empty header). A GLOBAL change (`tenant_id IS NULL`) has
 * no single owning tenant, so this sentinel fills the header; the true
 * nullable tenant scope travels in the JSON payload instead.
 */
const GLOBAL_TENANT_HEADER = 'global';

/**
 * Direct Kafka producer for config change notifications — best-effort, NOT a
 * transactional outbox: config writes are low-frequency admin actions and the
 * settings-client's short-TTL cache is the self-healing fallback if a publish is
 * ever missed (documented trade-off; see architecture notes for this slice).
 */
@Injectable()
export class KafkaConfigEventPublisher implements ConfigEventPublisherPort {
  constructor(@Inject(KAFKA_PRODUCER) private readonly producer: MessageProducer) {}

  publishValueChanged(payload: ConfigChangePayload): Promise<void> {
    return this.publish(CONFIG_VALUE_CHANGED, payload);
  }

  publishFlagChanged(payload: ConfigChangePayload): Promise<void> {
    return this.publish(FEATURE_FLAG_CHANGED, payload);
  }

  private publish(eventType: string, payload: ConfigChangePayload): Promise<void> {
    return this.producer.publish({
      topic: CONFIG_EVENTS_TOPIC,
      key: payload.key,
      headers: encodeHeaders({
        eventId: randomUUID(),
        eventType,
        aggregateId: payload.key,
        tenantId: payload.tenantId ?? GLOBAL_TENANT_HEADER,
        correlationId: randomUUID(),
        occurredAt: new Date().toISOString(),
      }),
      value: payload,
    });
  }
}
