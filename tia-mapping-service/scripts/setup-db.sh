#!/bin/sh

# Скрипт для настройки базы данных PostgreSQL для проекта tia-mapping-service

# Проверка наличия утилиты psql
if ! command -v psql >/dev/null 2>&1; then
    echo "PostgreSQL не установлен или psql не найден в PATH. Установите PostgreSQL и добавьте psql в PATH."
    exit 1
fi

# Получение настроек из переменных окружения или установка значений по умолчанию
DB_USER="${DB_USER:-tia_user}" 
DB_PASSWORD="${DB_PASSWORD:-password}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-tia_mapping_db}"

# Создание роли (пользователя) в PostgreSQL, если её ещё нет
psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASSWORD';" || true

# Создание базы данных, если её ещё нет
psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c "CREATE DATABASE \"$DB_NAME\";" || true

# Присвоение прав пользователю на базу данных
psql -U postgres -h "$DB_HOST" -p "$DB_PORT" -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";" || true

# Проверка установки расширения uuid-ossp
psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" || true

# Применение миграций через Knex
echo "Применяем миграции базы данных..."
npx knex migrate:latest --knexfile db/knexfile.js

# Проверка успешности миграций
if [ $? -eq 0 ]; then
    echo "База данных настроена успешно!"
else
    echo "Ошибка при настройке базы данных. Проверь логи и настройки."
    exit 1
fi