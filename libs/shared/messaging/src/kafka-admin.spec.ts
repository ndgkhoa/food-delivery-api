import { Logger } from '@nestjs/common';
import { KafkaTopicAdmin } from './kafka-admin';
import type { KafkaClient } from './kafka-client';

function buildAdminMock() {
  return {
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    createTopics: jest.fn(async () => undefined),
  };
}

function buildClient(admin: ReturnType<typeof buildAdminMock>): KafkaClient {
  return { admin: jest.fn(() => admin) } as unknown as KafkaClient;
}

describe('KafkaTopicAdmin', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('does nothing when no topics are requested', async () => {
    const admin = buildAdminMock();
    const client = buildClient(admin);
    await new KafkaTopicAdmin(client).ensureTopics([]);
    expect(client.admin).not.toHaveBeenCalled();
  });

  it('creates topics with default partitions and replication factor', async () => {
    const admin = buildAdminMock();
    await new KafkaTopicAdmin(buildClient(admin)).ensureTopics([{ topic: 'order.events' }]);
    expect(admin.connect).toHaveBeenCalledTimes(1);
    expect(admin.createTopics).toHaveBeenCalledWith({
      topics: [{ topic: 'order.events', numPartitions: 3, replicationFactor: 1 }],
    });
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });

  it('honors custom partitions and replication factor', async () => {
    const admin = buildAdminMock();
    await new KafkaTopicAdmin(buildClient(admin)).ensureTopics([
      { topic: 't', partitions: 6, replicationFactor: 2 },
    ]);
    expect(admin.createTopics).toHaveBeenCalledWith({
      topics: [{ topic: 't', numPartitions: 6, replicationFactor: 2 }],
    });
  });

  it('disconnects even when topic creation fails', async () => {
    const admin = buildAdminMock();
    admin.createTopics.mockRejectedValueOnce(new Error('boom'));
    const sut = new KafkaTopicAdmin(buildClient(admin));
    await expect(sut.ensureTopics([{ topic: 't' }])).rejects.toThrow('boom');
    expect(admin.disconnect).toHaveBeenCalledTimes(1);
  });
});
