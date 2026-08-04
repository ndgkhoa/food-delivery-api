import { randomUUID } from 'node:crypto';
import {
  createKafkaClient,
  type DecodedKafkaMessage,
  KafkaConsumerSubscriber,
} from '@food-delivery-api/shared-messaging';
import { AlsTenantContextAdapter } from '@food-delivery-api/shared-tenancy';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const REVIEW_EVENTS_TOPIC = 'review.events';

export async function collectRatingChangedEvents(
  restaurantId: string,
  expectedCount: number,
  timeoutMs = 30_000,
): Promise<Array<{ avgRating: number; reviewCount: number }>> {
  const client = createKafkaClient({
    clientId: `review-e2e-verify-${randomUUID()}`,
    brokers: KAFKA_BROKERS,
  });
  const subscriber = new KafkaConsumerSubscriber(client, new AlsTenantContextAdapter());
  const received: Array<{ avgRating: number; reviewCount: number }> = [];

  const consumer = await subscriber.subscribe({
    groupId: `review-e2e-verify-${randomUUID()}`,
    topics: [REVIEW_EVENTS_TOPIC],
    fromBeginning: true,
    handler: async (message: DecodedKafkaMessage) => {
      if (message.envelope.eventType !== 'RestaurantRatingChanged') {
        return;
      }
      const payload = message.payload as {
        restaurantId: string;
        avgRating: number;
        reviewCount: number;
      };
      if (payload.restaurantId === restaurantId) {
        received.push({ avgRating: payload.avgRating, reviewCount: payload.reviewCount });
      }
    },
  });

  try {
    const deadline = Date.now() + timeoutMs;
    while (received.length < expectedCount && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } finally {
    await consumer.disconnect();
  }

  return received;
}
