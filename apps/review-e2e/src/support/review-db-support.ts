import { Client } from 'pg';

const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'abc123456',
  database: 'review',
};

export interface ReviewRow {
  id: string;
  order_id: string;
  restaurant_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
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

async function findEligibleOrder(orderId: string): Promise<{ order_id: string } | undefined> {
  return withDb(async (db) => {
    const res = await db.query<{ order_id: string }>(
      'SELECT "order_id" FROM "review_eligible_orders" WHERE "order_id" = $1',
      [orderId],
    );
    return res.rows[0];
  });
}

export async function waitForEligibility(orderId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await findEligibleOrder(orderId)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Order ${orderId} was not recorded review-eligible within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export async function findReviewByOrderId(orderId: string): Promise<ReviewRow | undefined> {
  return withDb(async (db) => {
    const res = await db.query<ReviewRow>(
      'SELECT "id","order_id","restaurant_id","user_id","rating","comment" FROM "reviews" WHERE "order_id" = $1',
      [orderId],
    );
    return res.rows[0];
  });
}
