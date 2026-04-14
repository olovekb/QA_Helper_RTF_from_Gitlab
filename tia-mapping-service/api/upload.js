import multer from 'multer'; // Импорт библиотеки для обработки загрузки файлов
import { parseJsonFiles } from '../utils/jsonParser.js'; // Импорт функции парсинга JSON
import { logInfo, logError } from '../utils/logger.js'; // Импорт логгера

/**
 * Настройка хранения загружаемых файлов в памяти для парсинга JSON
 */
const fileStorage = multer.memoryStorage(); // Храним файлы в памяти, чтобы сразу парсить как JSON
const fileUpload = multer({ storage: fileStorage }); // Создание экземпляра Multer

/**
 * Обработка загрузки JSON-файлов фронтенда и бэкенда
 * @param {Object} req - Объект запроса с загруженными файлами
 * @param {Object} res - Объект ответа
 * @returns {void}
 */
export function handleJsonUpload(req, res) {
    // Ожидаем два поля: frontendJson и backendJson
    try {
        const frontendJsonBuffer = req.files['frontendJson'] ? req.files['frontendJson'][0].buffer : null;
        const backendJsonBuffer = req.files['backendJson'] ? req.files['backendJson'][0].buffer : null;

        // Проверяем, загружен хотя бы один файл
        if (!frontendJsonBuffer && !backendJsonBuffer) {
            logError('Отсутствуют JSON-файлы фронтенда или бэкенда'); // Логирование ошибки
            return res.status(400).send('Отсутствуют JSON-файлы фронтенда или бэкенда');
        }

        // Парсим JSON-файлы, если они существуют
        const frontendJson = frontendJsonBuffer ? JSON.parse(frontendJsonBuffer.toString()) : null;
        const backendJson = backendJsonBuffer ? JSON.parse(backendJsonBuffer.toString()) : null;

        logInfo('JSON-файлы успешно загружены и парсены'); // Логирование успеха

        // Извлекаем компоненты из JSON-файлов
        const components = parseJsonFiles(frontendJson, backendJson);

        res.status(200).json({
            message: 'JSON-файлы успешно загружены и обработаны',
            components: components // Возвращаем список компонентов для дальнейшего маппинга
        });
    } catch (parseError) {
        logError(`Ошибка при парсинге JSON-файлов: ${parseError.message}`); // Логирование ошибки
        res.status(500).send('Ошибка при обработке загруженных файлов');
    }
}

/**
 * Экспортируем middleware для маршрута загрузки файлов
 * @returns {Function} - Middleware Multer для обработки двух файлов
 */
export const uploadMiddleware = fileUpload.fields([
    { name: 'frontendJson', maxCount: 1 }, // Ожидаем файл фронтенда
    { name: 'backendJson', maxCount: 1 }  // Ожидаем файл бэкенда
]);