import knex from 'knex'; // Импорт Knex для работы с PostgreSQL

/**
 * Создание подключения к базе данных через Knex
 * Использует URL из конфигурации или переменной окружения
 */
const dbConnection = knex({
  client: 'pg', // Используем PostgreSQL
  connection: process.env.DATABASE_URL, // Подключение через переменную окружения из .env
  pool: {
    min: 2, // Минимальное количество подключений в пуле
    max: 10 // Максимальное количество подключений
  }
});

/**
 * Тестовое подключение к базе данных для проверки
 * Выполняет запрос к таблице functional_blocks и выводит результат или ошибку
 */
(async () => {
  try {
    const result = await dbConnection('functional_blocks').select('*').limit(1);
    console.log('Соединение с базой успешно:', result);
  } catch (error) {
    console.error('Ошибка подключения:', error);
  } finally {
    await dbConnection.destroy(); // Закрываем подключение после теста
  }
})();

export default dbConnection; 