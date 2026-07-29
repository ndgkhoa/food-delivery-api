import { createServer, type Server } from 'node:http';

/**
 * A tiny real HTTP upstream the circuit-breaker e2e can start, take `down`
 * (stop accepting connections — new connects get ECONNREFUSED, simulating an
 * unreachable downstream) and bring `up` again on the SAME port (simulating
 * recovery) so the gateway's `*_SERVICE_URL` stays valid across the toggle.
 */
export class ToggleableStubUpstream {
  private server?: Server;
  private port = 0;

  /** Starts listening on a free port and returns its base URL. */
  async start(): Promise<string> {
    this.server = this.buildServer();
    await new Promise<void>((resolve) => this.server?.listen(0, resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
    return `http://127.0.0.1:${this.port}`;
  }

  /** Simulates the downstream going unreachable. */
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

  /** Simulates recovery: re-listens on the same port `start()` returned. */
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
