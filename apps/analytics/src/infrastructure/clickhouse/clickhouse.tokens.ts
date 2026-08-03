/** DI token for the shared `@clickhouse/client` instance (bound in the ClickHouse client module). */
export const CLICKHOUSE_CLIENT = Symbol('ClickHouseClient');

/** Name of the analytics fact table every ingest/query adapter reads and writes. */
export const ORDERS_FACT_TABLE = 'orders_fact';
