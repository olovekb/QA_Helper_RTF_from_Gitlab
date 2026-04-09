import multer from 'multer';
import { parseJsonFiles } from '../utils/jsonParser.js';
import { logInfo, logError } from '../utils/logger.js';

const fileStorage = multer.memoryStorage();
const fileUpload = multer({ storage: fileStorage });

/**
 * Обработка загрузки JSON-файлов фронтенда и бэкенда
 * @param {Object} req - Объект запроса с загруженными файлами
 * @param {Object} res - Объект ответа
 * @returns {void}
 */
export function handleJsonUpload(req, res) {
    try {
        const frontendJsonBuffer = req.files['frontendJson'] ? req.files['frontendJson'][0].buffer : null;
        const backendJsonBuffer = req.files['backendJson'] ? req.files['backendJson'][0].buffer : null;
        if (!frontendJsonBuffer && !backendJsonBuffer) {
            logError('Отсутствуют JSON-файлы фронтенда или бэкенда');
            return res.status(400).send('Отсутствуют JSON-файлы фронтенда или бэкенда');
        }

        const frontendJson = frontendJsonBuffer ? JSON.parse(frontendJsonBuffer.toString()) : null;
        const backendJson = backendJsonBuffer ? JSON.parse(backendJsonBuffer.toString()) : null;

        logInfo('JSON-файлы успешно загружены и парсены');

        const components = parseJsonFiles(frontendJson, backendJson);

        res.status(200).json({
            message: 'JSON-файлы успешно загружены и обработаны',
            components: components
        });
    } catch (parseError) {
        logError(`Ошибка при парсинге JSON-файлов: ${parseError.message}`);
        res.status(500).send('Ошибка при обработке загруженных файлов');
    }
}

/**
 * Экспортируем middleware для маршрута загрузки файлов
 * @returns {Function} - Middleware Multer для обработки двух файлов
 */
export const uploadMiddleware = fileUpload.fields([
    { name: 'frontendJson', maxCount: 1 },
    { name: 'backendJson', maxCount: 1 }
]);