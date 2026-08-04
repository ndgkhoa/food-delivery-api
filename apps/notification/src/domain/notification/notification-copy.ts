const SUBJECTS: Record<string, string> = {
  'order-confirmed': 'Your order is confirmed',
  'order-cancelled': 'Your order was cancelled',
};

const BODIES: Record<string, (data: Record<string, unknown>) => string> = {
  'order-confirmed': (data) => `Order ${data.orderId ?? ''} is confirmed. Thanks for ordering!`,
  'order-cancelled': (data) => `Order ${data.orderId ?? ''} was cancelled.`,
};

export function subjectFor(type: string): string {
  const subject = SUBJECTS[type];
  if (!subject) {
    throw new Error(`No subject template for notification type "${type}"`);
  }
  return subject;
}

export function bodyFor(type: string, data: Record<string, unknown>): string {
  const build = BODIES[type];
  if (!build) {
    throw new Error(`No body template for notification type "${type}"`);
  }
  return build(data);
}
