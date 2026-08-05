import { Logger } from '@nestjs/common';
import type { RawKafkaHeaders } from './event-envelope';
import type { KafkaClient } from './kafka-client';
import { KafkaConsumerSubscriber } from './kafka-consumer';

function buildConsumer() {
  return {
    connect: jest.fn(async () => undefined),
    subscribe: jest.fn(async (_options: unknown) => undefined),
    run: jest.fn(async (_config: unknown) => undefined),
    commitOffsets: jest.fn(async (_offsets: unknown) => undefined),
    disconnect: jest.fn(async () => undefined),
  };
}

function buildAdmin() {
  return {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    createTopics: jest.fn(async (_spec: unknown) => undefined),
  };
}

function buildProducer() {
  return {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
    send: jest.fn(async (_payload: unknown) => undefined),
    sendBatch: jest.fn(async (_payload: unknown) => undefined),
  };
}

type Parts = {
  consumer: ReturnType<typeof buildConsumer>;
  admin: ReturnType<typeof buildAdmin>;
  producer: ReturnType<typeof buildProducer>;
};

function buildClient(parts: Parts): KafkaClient {
  return {
    consumer: jest.fn(() => parts.consumer),
    admin: jest.fn(() => parts.admin),
    producer: jest.fn(() => parts.producer),
  } as unknown as KafkaClient;
}

function buildTenantContext() {
  return {
    run: jest.fn(<T>(_ctx: unknown, fn: () => Promise<T>) => fn()),
  };
}

function validHeaders(): RawKafkaHeaders {
  return {
    'x-event-id': 'evt-1',
    'x-event-type': 'order.created',
    'x-aggregate-id': 'agg-1',
    'x-tenant-id': 'tenant-1',
    'x-correlation-id': 'corr-1',
    'x-occurred-at': '2026-01-01T00:00:00.000Z',
  };
}

function kafkaMessage(headers: RawKafkaHeaders | Record<string, never>) {
  return {
    offset: '10',
    key: Buffer.from('order-1', 'utf8'),
    value: Buffer.from(JSON.stringify({ id: 'order-1' }), 'utf8'),
    headers,
  };
}

type EachMessage = (arg: {
  topic: string;
  partition: number;
  message: ReturnType<typeof kafkaMessage>;
}) => Promise<void>;

function eachMessageOf(consumer: ReturnType<typeof buildConsumer>): EachMessage {
  return (consumer.run.mock.calls[0][0] as { eachMessage: EachMessage }).eachMessage;
}

describe('KafkaConsumerSubscriber', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  function build() {
    const parts = { consumer: buildConsumer(), admin: buildAdmin(), producer: buildProducer() };
    const client = buildClient(parts);
    const tenant = buildTenantContext();
    const sut = new KafkaConsumerSubscriber(client, tenant as never);
    return { sut, parts, client, tenant };
  }

  it('starts with an empty drop-count snapshot', () => {
    const { sut } = build();
    expect(sut.getDropCounts()).toEqual({});
  });

  it('connects, ensures topics with their dlq, subscribes and runs', async () => {
    const { sut, parts, client } = build();
    const handler = jest.fn(async () => undefined);
    const consumer = await sut.subscribe({ groupId: 'g1', topics: ['order.events'], handler });

    expect(client.consumer).toHaveBeenCalledWith({
      kafkaJS: { groupId: 'g1', autoCommit: false, fromBeginning: false },
    });
    expect(parts.consumer.connect).toHaveBeenCalledTimes(1);
    const created = parts.admin.createTopics.mock.calls[0][0] as { topics: { topic: string }[] };
    expect(created.topics.map((t) => t.topic)).toEqual(['order.events', 'order.events.dlq']);
    expect(parts.consumer.subscribe).toHaveBeenCalledWith({ topics: ['order.events'] });
    expect(parts.consumer.run).toHaveBeenCalledTimes(1);
    expect(consumer).toBe(parts.consumer);
  });

  it('commits the next offset when the handler succeeds', async () => {
    const { sut, parts, tenant } = build();
    const handler = jest.fn(async () => undefined);
    await sut.subscribe({ groupId: 'g1', topics: ['order.events'], handler });

    await eachMessageOf(parts.consumer)({
      topic: 'order.events',
      partition: 0,
      message: kafkaMessage(validHeaders()),
    });

    expect(tenant.run).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(parts.consumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'order.events', partition: 0, offset: '11' },
    ]);
    expect(parts.producer.send).not.toHaveBeenCalled();
  });

  it('dead-letters an undecodable message then commits', async () => {
    const { sut, parts } = build();
    const handler = jest.fn(async () => undefined);
    await sut.subscribe({ groupId: 'g1', topics: ['order.events'], handler });

    await eachMessageOf(parts.consumer)({
      topic: 'order.events',
      partition: 0,
      message: kafkaMessage({}),
    });

    expect(handler).not.toHaveBeenCalled();
    expect(parts.producer.send).toHaveBeenCalledTimes(1);
    expect(parts.consumer.commitOffsets).toHaveBeenCalledWith([
      { topic: 'order.events', partition: 0, offset: '11' },
    ]);
    expect(sut.getDropCounts()['order.events::undecodable']).toBe(1);
  });

  it('dead-letters when the handler exhausts its retries', async () => {
    const { sut, parts } = build();
    const handler = jest.fn(async () => {
      throw new Error('handler boom');
    });
    await sut.subscribe({ groupId: 'g1', topics: ['order.events'], handler, maxAttempts: 1 });

    await eachMessageOf(parts.consumer)({
      topic: 'order.events',
      partition: 0,
      message: kafkaMessage(validHeaders()),
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(parts.producer.send).toHaveBeenCalledTimes(1);
    expect(parts.consumer.commitOffsets).toHaveBeenCalledTimes(1);
  });

  it('reuses a single dlq producer across dead-letters', async () => {
    const { sut, parts, client } = build();
    const handler = jest.fn(async () => undefined);
    await sut.subscribe({ groupId: 'g1', topics: ['order.events'], handler });
    const each = eachMessageOf(parts.consumer);

    await each({ topic: 'order.events', partition: 0, message: kafkaMessage({}) });
    await each({ topic: 'order.events', partition: 0, message: kafkaMessage({}) });

    expect(client.producer).toHaveBeenCalledTimes(1);
    expect(parts.producer.send).toHaveBeenCalledTimes(2);
  });

  it('disconnects the dlq producer on module destroy when one exists', async () => {
    const { sut, parts } = build();
    await sut.subscribe({
      groupId: 'g1',
      topics: ['order.events'],
      handler: jest.fn(async () => undefined),
    });
    await eachMessageOf(parts.consumer)({
      topic: 'order.events',
      partition: 0,
      message: kafkaMessage({}),
    });

    await sut.onModuleDestroy();
    expect(parts.producer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('is a no-op on module destroy when no dlq producer was created', async () => {
    const { sut, client } = build();
    await sut.onModuleDestroy();
    expect(client.producer).not.toHaveBeenCalled();
  });
});
