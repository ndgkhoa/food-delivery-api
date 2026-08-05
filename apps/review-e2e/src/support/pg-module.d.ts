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
