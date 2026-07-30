#!/bin/bash
# Bootstraps `postgres-replica` as a streaming physical standby of `postgres`.
#
# On a FRESH (empty) data volume: waits for the primary to accept connections,
# then clones it with `pg_basebackup -R` — `-R` writes standby.signal +
# primary_conninfo into the cloned data directory, so the standard postgres
# entrypoint (exec'd below) starts it straight into streaming recovery. Runs
# as the `postgres` user (via gosu, already in the base image) so the cloned
# files keep the ownership the server process expects.
#
# On every later restart the data directory already holds that clone (plus
# whatever it has streamed since), so this step is skipped entirely and the
# normal entrypoint just resumes streaming from where it left off.
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
