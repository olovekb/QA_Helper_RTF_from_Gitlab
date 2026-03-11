#!/bin/sh

# allure_inspector_db для allure-test-inspector

if ! command -v psql >/dev/null 2>&1; then
    echo "psql не найден. Пропускаем создание БД"
else
    DB_USER="${DB_USER:-tia_user}"
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-allure_inspector_db}"

    psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c "CREATE DATABASE \"$DB_NAME\";" 2>/dev/null || true
    psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" 2>/dev/null || true
    psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true
fi

# Миграции
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

echo "Применяем миграции allure_inspector_db..."
npx knex migrate:latest --knexfile server/db/knexfile.js

if [ $? -eq 0 ]; then
    echo "БД allure_inspector_db настроена успешно."
else
    echo "Ошибка при выполнении миграции. Проверьте DB_HOST, DB_NAME, DB_USER в .env"
    exit 1
fi
