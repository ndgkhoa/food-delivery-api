import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by `@socket.io/redis-adapter`, so a broadcast on ANY
 * delivery instance fans out to clients connected to EVERY instance (WS handlers
 * stay stateless — driver positions + assignments live in Redis, not memory).
 * Uses two DEDICATED ioredis connections (one pub, one sub) — the redis-adapter
 * requires a subscriber connection that never runs other commands, so this does
 * NOT reuse the shared client. Connections are closed on shutdown.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    const pubClient = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    const subClient = pubClient.duplicate();
    this.clients = [pubClient, subClient];
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.quit()));
    this.clients = [];
  }
}
