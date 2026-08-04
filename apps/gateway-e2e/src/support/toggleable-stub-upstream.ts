import { createServer, type Server } from 'node:http';

export class ToggleableStubUpstream {
  private server?: Server;
  private port = 0;

  async start(): Promise<string> {
    this.server = this.buildServer();
    await new Promise<void>((resolve) => this.server?.listen(0, resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${this.port}`;
  }

  async down(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  async up(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = this.buildServer();
    await new Promise<void>((resolve) => this.server?.listen(this.port, resolve));
  }

  async stop(): Promise<void> {
    await this.down();
  }

  private buildServer(): Server {
    return createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  }
}
