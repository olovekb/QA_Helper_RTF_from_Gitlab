import { logError } from '../utils/logger.js'; // Импорт логгера для записи ошибок
import databasePool from '../db/pool.js'; // Импорт пула подключений к базе данных (если хочешь сохранять в БД)

/**
 * Логирование ошибки на сервер
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function logServerError(req, res) {
    const { errorType, description, timestamp } = req.body;

    try {
        if (!errorType || !description || !timestamp) {
            return res.status(400).json({ error: 'Необходимо указать errorType, description и timestamp.' });
        }

        // Логируем ошибку в файл через logger.js
        logError(`Ошибка клиента: ${errorType}`, `Описание: ${description}, Время: ${timestamp}`);

        // сохраняем в базе данных 
        
        await databasePool('errors_log').insert({
            error_type: errorType,
            description,
            timestamp
        });
        

        res.status(200).json({ message: 'Ошибка успешно записана.' });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Неизвестная ошибка');
        logError('Ошибка при логировании ошибки на сервере:', errorMessage);
        res.status(500).json({ error: 'Произошла ошибка при логировании.', details: errorMessage });
    }
}