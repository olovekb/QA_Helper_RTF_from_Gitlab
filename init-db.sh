#!/bin/bash

# Скрипт для инициализации базы данных
echo "Инициализация базы данных..."

# Ждем пока PostgreSQL будет готов
echo "Ожидание готовности PostgreSQL..."
until pg_isready -h postgresql -p 5432 -U ${DB_USER:-tia_user}; do
  echo "PostgreSQL не готов, ждем..."
  sleep 2
done

echo "PostgreSQL готов!"

# Создаем базу данных если она не существует
echo "Создание базы данных если необходимо..."
createdb -h postgresql -p 5432 -U ${DB_USER:-tia_user} ${DB_NAME:-tia_mapping_db} 2>/dev/null || echo "База данных уже существует"

echo "Инициализация завершена!"
