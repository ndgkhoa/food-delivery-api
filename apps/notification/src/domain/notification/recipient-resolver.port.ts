/** Contact details a notification is sent to, resolved from an order's userId. */
export interface Recipient {
  email: string;
  phone: string;
  pushToken: string;
}

/**
 * Resolves an order's userId to contact details. Only a stub implementation
 * exists today (`RecipientResolverStub`) — real user-contact lookup (a user
 * service call) is deferred; this port is the seam that swap lands behind
 * with no consumer/handler change.
 */
export interface RecipientResolverPort {
  resolve(userId: string): Promise<Recipient>;
}

export const RECIPIENT_RESOLVER = Symbol('RecipientResolverPort');
