module.exports = {
    client: 'pg', // Используем PostgreSQL как клиент базы данных
    connection: process.env.DATABASE_URL, // Подключение через переменную окружения из .env
    migrations: {
      directory: './db/migrations', // Директория с файлами миграций
      tableName: 'knex_migrations' // Таблица для отслеживания выполненных миграций
    }
  };