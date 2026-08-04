#!/bin/bash
set -euo pipefail

PRIMARY_HOST="${PRIMARY_HOST:-postgres}"
PRIMARY_PORT="${PRIMARY_PORT:-5432}"
REPLICATION_USERNAME="${REPLICATION_USERNAME:-replicator}"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD:-replicator}"

if [ -z "$(gosu postgres ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo "postgres-replica: empty data directory — cloning primary via pg_basebackup"

  until pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -U "$REPLICATION_USERNAME" >/dev/null 2>&1; do
    echo "postgres-replica: waiting for primary at ${PRIMARY_HOST}:${PRIMARY_PORT} ..."
    sleep 2
  done

  gosu postgres bash -c "PGPASSWORD='${REPLICATION_PASSWORD}' pg_basebackup \
    -h '${PRIMARY_HOST}' -p '${PRIMARY_PORT}' -U '${REPLICATION_USERNAME}' \
    -D '${PGDATA}' -Fp -Xs -R -P"

  echo "postgres-replica: base backup complete — standby.signal + primary_conninfo written"
else
  echo "postgres-replica: existing data directory — resuming streaming replication"
fi

exec docker-entrypoint.sh postgres
