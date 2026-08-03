import type { RawKafkaHeaders } from './event-envelope';
import type { OutboundKafkaMessage } from './kafka-producer';
import type { DropReason } from './message-drop-counter';

/** Suffix appended to a source topic to name its dead-letter topic. */
export const DEAD_LETTER_TOPIC_SUFFIX = '.dlq';

/** Names the dead-letter topic for a source topic (`inventory.replies` -> `inventory.replies.dlq`). */
export function deadLetterTopic(sourceTopic: string): string {
  return `${sourceTopic}${DEAD_LETTER_TOPIC_SUFFIX}`;
}

/** The minimal inbound-message shape the DLQ path needs — a subset of the vendor message. */
export interface RawInboundMessage {
  topic: string;
  partition: number;
  message: {
    offset: string;
    key: Buffer | null;
    value: Buffer | null;
    headers?: RawKafkaHeaders;
  };
}

/**
 * Flattens raw Kafka header values (Buffer | Buffer[] | string) into strings so
 * the original headers survive into the DLQ payload for replay/inspection.
 */
function rawHeadersToStrings(headers: RawKafkaHeaders | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    const single = Array.isArray(value) ? value[value.length - 1] : value;
    out[name] = Buffer.isBuffer(single) ? single.toString('utf8') : String(single);
  }
  return out;
}

/**
 * Builds the dead-letter message for a message a consumer could not process.
 * Preserves the ORIGINAL bytes (key + headers + value, base64 so any payload
 * round-trips), the source coordinates (topic/partition/offset), and why it
 * failed — everything a replay tool needs. The DLQ message is keyed by the
 * original key so same-key records stay co-partitioned/ordered on the DLQ too.
 */
export function buildDeadLetterMessage(
  raw: RawInboundMessage,
  reason: DropReason,
  failureReason: string,
): OutboundKafkaMessage {
  const { topic, partition, message } = raw;
  return {
    topic: deadLetterTopic(topic),
    key: message.key ? message.key.toString('utf8') : '',
    headers: {
      'x-dlq-source-topic': topic,
      'x-dlq-source-partition': String(partition),
      'x-dlq-source-offset': message.offset,
      'x-dlq-reason': reason,
      'x-dlq-failure-reason': failureReason,
    },
    value: {
      sourceTopic: topic,
      sourcePartition: partition,
      sourceOffset: message.offset,
      reason,
      failureReason,
      key: message.key ? message.key.toString('base64') : null,
      headers: rawHeadersToStrings(message.headers),
      value: message.value ? message.value.toString('base64') : null,
    },
  };
}
