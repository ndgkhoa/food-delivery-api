#!/bin/bash
# Creates one database per service so migrations run without a manual `createdb`.
#
# Runs ONCE, only on a FRESH data volume (Postgres executes everything in
# /docker-entrypoint-initdb.d on first init). The default POSTGRES_DB already
# created `catalog`; this adds the rest idempotently. To re-run on an existing
# volume, reset it first: `docker compose -f infra/docker-compose.yml --profile core down -v`.
set -euo pipefail

for db in catalog auth inventory order payment; do
  if ! psql -U "$POSTGRES_USER" -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
    echo "creating database: $db"
    psql -U "$POSTGRES_USER" -c "CREATE DATABASE \"$db\""
  fi
done
