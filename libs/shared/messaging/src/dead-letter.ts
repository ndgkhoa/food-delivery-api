import type { RawKafkaHeaders } from './event-envelope';
import type { OutboundKafkaMessage } from './kafka-producer';
import type { DropReason } from './message-drop-counter';

export const DEAD_LETTER_TOPIC_SUFFIX = '.dlq';

export function deadLetterTopic(sourceTopic: string): string {
  return `${sourceTopic}${DEAD_LETTER_TOPIC_SUFFIX}`;
}

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
