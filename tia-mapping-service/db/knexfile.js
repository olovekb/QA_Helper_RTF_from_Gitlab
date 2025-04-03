export default {
  client: 'pg', // Используем PostgreSQL
  connection: process.env.DATABASE_URL, // Подключение через переменную окружения
  migrations: {
    directory: './migrations', // Директория с файлами миграций
    tableName: 'knex_migrations' // Таблица для отслеживания миграций
  }
};