import type { KafkaClient } from './kafka-client';
import { ConfluentMessageProducer, type OutboundKafkaMessage } from './kafka-producer';

function buildProducerMock() {
  return {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    send: jest.fn(async (_payload: unknown) => undefined),
    sendBatch: jest.fn(async (_payload: unknown) => undefined),
  };
}

function buildClient(producer: ReturnType<typeof buildProducerMock>): KafkaClient {
  return { producer: jest.fn(() => producer) } as unknown as KafkaClient;
}

function message(overrides: Partial<OutboundKafkaMessage> = {}): OutboundKafkaMessage {
  return {
    topic: 'order.events',
    key: 'order-1',
    headers: { traceparent: 'tp-1' },
    value: { id: 'order-1' },
    ...overrides,
  };
}

describe('ConfluentMessageProducer', () => {
  it('creates an idempotent producer with acks=-1', () => {
    const producer = buildProducerMock();
    const client = buildClient(producer);
    new ConfluentMessageProducer(client);
    expect(client.producer).toHaveBeenCalledWith({ kafkaJS: { idempotent: true, acks: -1 } });
  });

  it('connects on module init', async () => {
    const producer = buildProducerMock();
    await new ConfluentMessageProducer(buildClient(producer)).onModuleInit();
    expect(producer.connect).toHaveBeenCalledTimes(1);
  });

  it('flushes then disconnects on module destroy', async () => {
    const producer = buildProducerMock();
    await new ConfluentMessageProducer(buildClient(producer)).onModuleDestroy();
    expect(producer.flush).toHaveBeenCalledTimes(1);
    expect(producer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('publishes one message to its topic with buffer-encoded key and value', async () => {
    const producer = buildProducerMock();
    await new ConfluentMessageProducer(buildClient(producer)).publish(message());
    expect(producer.send).toHaveBeenCalledTimes(1);
    const arg = producer.send.mock.calls[0][0] as {
      topic: string;
      messages: { key: Buffer; value: Buffer }[];
    };
    expect(arg.topic).toBe('order.events');
    expect(arg.messages).toHaveLength(1);
    expect(arg.messages[0].key).toEqual(Buffer.from('order-1', 'utf8'));
    expect(JSON.parse(arg.messages[0].value.toString('utf8'))).toEqual({ id: 'order-1' });
  });

  it('injects a traceparent header when the message lacks one', async () => {
    const producer = buildProducerMock();
    await new ConfluentMessageProducer(buildClient(producer)).publish(message({ headers: {} }));
    const arg = producer.send.mock.calls[0][0] as {
      messages: { headers: Record<string, Buffer> }[];
    };
    expect(arg.messages[0].headers).toBeDefined();
  });

  it('is a no-op for an empty batch', async () => {
    const producer = buildProducerMock();
    await new ConfluentMessageProducer(buildClient(producer)).publishBatch([]);
    expect(producer.sendBatch).not.toHaveBeenCalled();
  });

  it('groups a batch by topic before sending', async () => {
    const producer = buildProducerMock();
    await new ConfluentMessageProducer(buildClient(producer)).publishBatch([
      message({ topic: 'a', key: 'k1' }),
      message({ topic: 'b', key: 'k2' }),
      message({ topic: 'a', key: 'k3' }),
    ]);
    expect(producer.sendBatch).toHaveBeenCalledTimes(1);
    const arg = producer.sendBatch.mock.calls[0][0] as {
      topicMessages: { topic: string; messages: unknown[] }[];
    };
    const byTopic = Object.fromEntries(arg.topicMessages.map((t) => [t.topic, t.messages.length]));
    expect(byTopic).toEqual({ a: 2, b: 1 });
  });
});
