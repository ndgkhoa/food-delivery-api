/**
 * Deterministic subject/body templates for each notification type, so the
 * Mailpit e2e can assert exact content and the send stays pure (no template
 * engine, no I/O). Kept in the domain layer since it is pure content logic
 * every channel adapter (email today, sms/push stubs) can reuse.
 */
const SUBJECTS: Record<string, string> = {
  'order-confirmed': 'Your order is confirmed',
  'order-cancelled': 'Your order was cancelled',
};

const BODIES: Record<string, (data: Record<string, unknown>) => string> = {
  'order-confirmed': (data) => `Order ${data.orderId ?? ''} is confirmed. Thanks for ordering!`,
  'order-cancelled': (data) => `Order ${data.orderId ?? ''} was cancelled.`,
};

/**
 * Deterministic subject line for a notification type. Throws on an unmapped type
 * (fail loud): a type wired into the dispatcher but missing here surfaces as a
 * failed job → retries → DLQ, never a generic-content email sent as if correct.
 */
export function subjectFor(type: string): string {
  const subject = SUBJECTS[type];
  if (!subject) {
    throw new Error(`No subject template for notification type "${type}"`);
  }
  return subject;
}

/** Deterministic body text for a notification type + its order data; throws on an unmapped type. */
export function bodyFor(type: string, data: Record<string, unknown>): string {
  const build = BODIES[type];
  if (!build) {
    throw new Error(`No body template for notification type "${type}"`);
  }
  return build(data);
}
