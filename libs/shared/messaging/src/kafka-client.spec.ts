import { KafkaJS } from '@confluentinc/kafka-javascript';
import { createKafkaClient } from './kafka-client';

jest.mock('@confluentinc/kafka-javascript', () => ({
  KafkaJS: { Kafka: jest.fn() },
}));

describe('createKafkaClient', () => {
  it('constructs a KafkaJS client with the given clientId and brokers', () => {
    createKafkaClient({ clientId: 'gateway', brokers: ['b1:9092', 'b2:9092'] });
    expect(KafkaJS.Kafka).toHaveBeenCalledWith({
      kafkaJS: { clientId: 'gateway', brokers: ['b1:9092', 'b2:9092'] },
    });
  });
});
