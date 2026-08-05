export class NotificationNotFoundError extends Error {
  constructor(readonly notificationId: string) {
    super(`Notification "${notificationId}" not found`);
    this.name = 'NotificationNotFoundError';
  }
}
