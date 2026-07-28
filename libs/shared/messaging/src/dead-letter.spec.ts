import { buildDeadLetterMessage, deadLetterTopic, type RawInboundMessage } from './dead-letter';

function rawMessage(): RawInboundMessage {
  return {
    topic: 'inventory.replies',
    partition: 2,
    message: {
      offset: '42',
      key: Buffer.from('order-1', 'utf8'),
      value: Buffer.from(JSON.stringify({ orderId: 'order-1' }), 'utf8'),
      headers: { 'x-event-id': Buffer.from('evt-1', 'utf8'), 'x-tenant-id': 'tenant-1' },
    },
  };
}

describe('deadLetterTopic', () => {
  it('appends the .dlq suffix', () => {
    expect(deadLetterTopic('payment.commands')).toBe('payment.commands.dlq');
  });
});

describe('buildDeadLetterMessage', () => {
  it('targets the DLQ topic, preserves the key, and stamps source + reason headers', () => {
    const dlq = buildDeadLetterMessage(rawMessage(), 'handler-exhausted', 'db lock timeout');

    expect(dlq.topic).toBe('inventory.replies.dlq');
    expect(dlq.key).toBe('order-1');
    expect(dlq.headers).toMatchObject({
      'x-dlq-source-topic': 'inventory.replies',
      'x-dlq-source-partition': '2',
      'x-dlq-source-offset': '42',
      'x-dlq-reason': 'handler-exhausted',
      'x-dlq-failure-reason': 'db lock timeout',
    });
  });

  it('carries the original bytes (base64) + flattened headers for replay', () => {
    const dlq = buildDeadLetterMessage(rawMessage(), 'undecodable', 'missing header');
    const value = dlq.value as {
      key: string | null;
      value: string | null;
      headers: Record<string, string>;
      sourceOffset: string;
    };

    expect(Buffer.from(value.key ?? '', 'base64').toString('utf8')).toBe('order-1');
    expect(JSON.parse(Buffer.from(value.value ?? '', 'base64').toString('utf8'))).toEqual({
      orderId: 'order-1',
    });
    expect(value.headers).toEqual({ 'x-event-id': 'evt-1', 'x-tenant-id': 'tenant-1' });
    expect(value.sourceOffset).toBe('42');
  });

  it('tolerates a null key and null value (records null, not a crash)', () => {
    const raw: RawInboundMessage = {
      topic: 't',
      partition: 0,
      message: { offset: '0', key: null, value: null, headers: undefined },
    };
    const dlq = buildDeadLetterMessage(raw, 'undecodable', 'x');
    const value = dlq.value as { key: string | null; value: string | null };

    expect(dlq.key).toBe('');
    expect(value.key).toBeNull();
    expect(value.value).toBeNull();
  });
});
