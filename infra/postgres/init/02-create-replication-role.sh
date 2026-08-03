#!/bin/bash
# Creates a least-privilege streaming-replication role and opens pg_hba for it,
# so `postgres-replica` can clone + stream from this primary.
#
# Runs ONCE, only on a FRESH data volume (see the sibling
# 01-create-service-databases.sh header for the reset caveat). The role has
# ONLY the REPLICATION attribute — no database access beyond the replication
# protocol itself. The pg_hba line is appended (not overwritten) so the
# image's default rules for normal client connections are untouched; it takes
# effect on the entrypoint's post-init restart into the final serving process,
# so no manual reload is needed here.
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
