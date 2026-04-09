import winston from 'winston';

/**
 * Создаём логгер с настройками для информационных, предупреждающих и ошибочных сообщений
 */
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'info.log', level: 'info' }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.Console()
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
  logger.warn(message);
}

/**
 * Логирует ошибку
 * @param {string} message - Сообщение об ошибке
 * @param {Error|string} [error] - Объект ошибки или строка с описанием ошибки (опционально)
 */
export function logError(message, error) {
  let errorText = '';
  if (error) {
    if (error instanceof Error) {
      errorText = `: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    } else if (typeof error === 'string') {
      errorText = `: ${error}`;
    } else {
      errorText = `: ${JSON.stringify(error)}`;
    }
  }
  logger.error(`${message}${errorText}`);
}