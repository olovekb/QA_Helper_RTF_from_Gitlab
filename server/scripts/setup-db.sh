#!/bin/sh

# allure_inspector_db для allure-test-inspector (аналогично tia-mapping-service)

if ! command -v psql >/dev/null 2>&1; then
    echo "Ошибка: psql не найден. Установите postgresql-client."
    exit 1
fi

{
    DB_USER="${DB_USER:-tia_user}"
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-allure_inspector_db}"
    DB_PASSWORD="${DB_PASSWORD:-password}"
    export PGPASSWORD="$DB_PASSWORD"

    # Используем DB_USER (создан postgres-контейнером) — он суперпользователь
    psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "CREATE DATABASE \"$DB_NAME\";" 2>/dev/null || true
    psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" 2>/dev/null || true
    psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true
}

# Миграции с retry
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_ROOT"

echo "Применяем миграции allure_inspector_db..."
for i in 1 2 3 4 5; do
    if npx knex migrate:latest --knexfile server/db/knexfile.js; then
        echo "БД allure_inspector_db настроена успешно."
        exit 0
    fi
    echo "Попытка $i/5 не удалась, повтор через 5 сек..."
    sleep 5
done
echo "Ошибка: миграции не выполнились после 5 попыток. Проверьте DB_HOST, DB_NAME, DB_USER, DB_PASSWORD"
exit 1
