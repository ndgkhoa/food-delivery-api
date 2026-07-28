/**
 * Minimal ambient typing for the `pg` client, scoped to the compose saga e2e's
 * usage. The runtime package is present (a transitive dep of TypeORM's pg
 * driver) but ships no bundled types and `@types/pg` isn't installed — this
 * declares just the surface the spec touches so the e2e compiles standalone.
 */
declare module 'pg' {
  export interface QueryResult<TRow = Record<string, unknown>> {
    rows: TRow[];
    rowCount: number;
  }

  export interface ClientConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  }

  export class Client {
    constructor(config: ClientConfig);
    connect(): Promise<void>;
    query<TRow = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ): Promise<QueryResult<TRow>>;
    end(): Promise<void>;
  }
}
