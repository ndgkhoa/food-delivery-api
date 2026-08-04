#!/bin/bash
set -euo pipefail

REPLICATION_USERNAME="${REPLICATION_USERNAME:-replicator}"
REPLICATION_PASSWORD="${REPLICATION_PASSWORD:-replicator}"

psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REPLICATION_USERNAME}') THEN
      CREATE ROLE "${REPLICATION_USERNAME}" WITH REPLICATION LOGIN PASSWORD '${REPLICATION_PASSWORD}';
    END IF;
  END
  \$\$;
EOSQL

echo "host replication ${REPLICATION_USERNAME} all md5" >> "$PGDATA/pg_hba.conf"
echo "created replication role: ${REPLICATION_USERNAME}"
