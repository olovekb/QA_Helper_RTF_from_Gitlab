#!/bin/sh

# Database bootstrap for tia-mapping-service.
# By default, docker-compose provisions PostgreSQL with the same user that the
# application uses, so we avoid hard-coding the "postgres" account here.

if ! command -v psql >/dev/null 2>&1; then
    echo "Error: psql is not available. Install postgresql-client."
    exit 1
fi

DB_USER="${DB_USER:-tia_user}"
DB_PASSWORD="${DB_PASSWORD:-password}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-tia_mapping_db}"
DB_ADMIN_USER="${DB_ADMIN_USER:-$DB_USER}"
DB_ADMIN_PASSWORD="${DB_ADMIN_PASSWORD:-$DB_PASSWORD}"

# Use an optional dedicated admin account when it is provided. Otherwise the
# application user performs bootstrap against the already initialized cluster.
export PGPASSWORD="$DB_ADMIN_PASSWORD"

if [ "$DB_ADMIN_USER" != "$DB_USER" ]; then
    psql -U "$DB_ADMIN_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD';" 2>/dev/null || true
fi

psql -U "$DB_ADMIN_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "CREATE DATABASE \"$DB_NAME\";" 2>/dev/null || true
psql -U "$DB_ADMIN_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" 2>/dev/null || true

export PGPASSWORD="$DB_PASSWORD"
psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true

echo "Applying database migrations..."
npx knex migrate:latest --knexfile db/knexfile.js

if [ $? -eq 0 ]; then
    echo "Database bootstrap completed successfully."
else
    echo "Database bootstrap failed. Check DB_HOST, DB_NAME, DB_USER and DB_PASSWORD."
    exit 1
fi
