#!/bin/bash
set -euo pipefail

for db in catalog auth inventory order payment media notification config review; do
  if ! psql -U "$POSTGRES_USER" -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
    echo "creating database: $db"
    psql -U "$POSTGRES_USER" -c "CREATE DATABASE \"$db\""
  fi
done
