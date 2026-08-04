import { Injectable } from '@nestjs/common';
import type {
  Recipient,
  RecipientResolverPort,
} from '@notification/domain/notification/recipient-resolver.port';

/**
 * STUB recipient lookup: order events only carry a `userId`, not contact
 * details, so this synthesises deterministic, clearly-fake contact info from
 * it. Real user-contact lookup (a user-service call) is deferred — swap this
 * class for a real adapter behind `RecipientResolverPort`, no consumer/handler
 * change required.
 */
@Injectable()
export class RecipientResolverStub implements RecipientResolverPort {
  async resolve(userId: string): Promise<Recipient> {
    const digits = userId
      .replace(/[^0-9]/g, '')
      .padEnd(7, '0')
      .slice(0, 7);
    return {
      email: `${userId}@example.test`,
      phone: `+1555${digits}`,
      pushToken: `push-token-${userId}`,
    };
  }
}
