import { Client } from 'pg';

const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'abc123456',
  database: 'notification',
};

export interface NotificationRow {
  id: string;
  channel: string;
  status: string;
  recipient: string;
  attempts: number;
  error: string | null;
}

async function withDb<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(DB);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function notificationRowsForEvent(eventId: string): Promise<NotificationRow[]> {
  return withDb(async (db) => {
    const res = await db.query<NotificationRow>(
      'SELECT "id","channel","status","recipient","attempts","error" FROM "notifications" ' +
        'WHERE "event_id"=$1 ORDER BY "channel"',
      [eventId],
    );
    return res.rows;
  });
}

export async function pollNotificationRowsUntil(
  eventId: string,
  expectedCount: number,
  terminal: string[],
  timeoutMs = 30_000,
): Promise<NotificationRow[]> {
  const deadline = Date.now() + timeoutMs;
  let rows: NotificationRow[] = [];
  for (;;) {
    rows = await notificationRowsForEvent(eventId);
    if (rows.length >= expectedCount && rows.every((row) => terminal.includes(row.status))) {
      return rows;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `notification rows for event ${eventId} did not reach [${terminal.join(', ')}] within ` +
          `${timeoutMs}ms (last: ${JSON.stringify(rows)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
