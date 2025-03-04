// db/knexfile.js
import knex from 'knex'; // Импорт Knex как ES-модуль
import dotenv from 'dotenv'; // Импорт dotenv для загрузки .env

// Явно загружаем переменные из .env
dotenv.config({ path: '../.env' }); // Указываем путь к .env в корневой директории проекта

export default {
  client: 'pg', // Используем PostgreSQL
  connection: process.env.DATABASE_URL, // Подключение через переменную окружения
  migrations: {
    directory: './migrations', // Директория с файлами миграций
    tableName: 'knex_migrations' // Таблица для отслеживания миграций
  }
};