import winston from 'winston'; // Импорт библиотеки логирования winston

/**
 * Создаём логгер с настройками для информационных, предупреждающих и ошибочных сообщений
 */
const logger = winston.createLogger({
  level: 'info', // Уровень логирования по умолчанию (можно настроить на 'debug' для более детального вывода)
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'info.log', level: 'info' }), // Логи в файл
    new winston.transports.File({ filename: 'error.log', level: 'error' }), // Логи ошибок в отдельный файл
    new winston.transports.Console() // Логи в консоль
  ],
});

/**
 * Логирует информационное сообщение
 * @param {string} message - Сообщение для логирования
 */
export function logInfo(message) {
  logger.info(message);
}

/**
 * Логирует предупреждающее сообщение
 * @param {string} message - Сообщение для логирования предупреждения
 */
export function logWarn(message) {
  logger.warn(message); // Используем уровень 'warn' в winston
}

/**
 * Логирует ошибку
 * @param {string} message - Сообщение об ошибке
 * @param {Error} [error] - Объект ошибки (опционально)
 */
export function logError(message, error) {
  logger.error(`${message}${error ? `: ${error.message}` : ''}`);
}