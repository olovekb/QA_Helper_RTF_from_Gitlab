import winston from 'winston';

/**
 * Настраиваем логгер для записи запросов, ошибок и информационных сообщений
 * @returns {Object} - Экземпляр логгера
 */
const logger = winston.createLogger({
    level: 'info', // Уровень логирования (info, error, debug)
    format: winston.format.combine(
        winston.format.timestamp(), // Добавляем временную метку
        winston.format.json() // Формат логов в JSON
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }), // Логи ошибок в файл
        new winston.transports.File({ filename: 'combined.log' }) // Все логи в файл
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple() // Простой формат для консоли в режиме разработки
    }));
}

/**
 * Логирование информации
 * @param {string} message - Сообщение для логирования
 */
export function logInfo(message) {
    logger.info(message);
}

/**
 * Логирование ошибок
 * @param {string} message - Сообщение об ошибке
 * @param {Error} error - Объект ошибки (опционально)
 */
export function logError(message, error = null) {
    logger.error({ message, stack: error ? error.stack : null });
}