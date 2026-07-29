/** Raised when a BullMQ job references a notification row that no longer exists. */
export class NotificationNotFoundError extends Error {
  constructor(readonly notificationId: string) {
    super(`Notification "${notificationId}" not found`);
    this.name = 'NotificationNotFoundError';
  }
}
