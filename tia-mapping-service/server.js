// server.js (фрагмент)
import express from 'express'; // Импорт фреймворка Express для создания веб-сервера
import cors from 'cors'; // Импорт middleware для обработки кросс-доменных запросов
import path, { dirname } from 'path'; // Импорт path и dirname для работы с путями файлов
import { fileURLToPath } from 'url'; // Импорт для преобразования URL в путь
import multer from 'multer'; // Импорт multer для обработки загрузки файлов
import { uploadMiddleware, handleJsonUpload } from './api/upload.js'; // Импорт функционала для загрузки JSON
import { getProjectStructure } from './api/structure.js'; // Импорт функционала для получения структуры Allure
import { handleComponentMapping, deleteComponentMapping, getComponentMappings } from './api/components.js'; // Импорт функционала для маппинга
import { createTestPlan } from './api/launch.js'; // Импорт функционала для создания тест-планов
import config from './config/index.js'; // Импорт конфигурации проекта
import { logInfo, logError } from './utils/logger.js'; // Импорт логгера для информационных и ошибочных сообщений
import { logServerError } from './api/errors.js';

// Получаем __dirname в ES-модулях
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Создание экземпляра приложения Express
const app = express();

// Настройка middleware для обработки JSON, URL-encoded данных и CORS
app.use(cors()); // Разрешаем кросс-доменные запросы
app.use(express.json()); // Парсим JSON из тела запросов
app.use(express.urlencoded({ extended: true })); // Парсим URL-encoded данные

// Обслуживание статических файлов React-приложения после сборки
const clientBuildPath = path.join(__dirname, 'client', 'build');
app.use(express.static(clientBuildPath));

// Настройка Multer для загрузки файлов (храним в памяти для парсинга)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Роуты API для работы с TIA и маппингом

/**
 * Обработка загрузки JSON-файлов
 * @route POST /api/upload/json
 */
app.post('/api/upload/json', uploadMiddleware, handleJsonUpload);

app.post('/api/errors', logServerError);

/**
 * Получение структуры проекта из Allure без пропуска узлов
 * @route GET /api/structure
 * @param {string} projectId - ID проекта
 */
app.get('/api/structure', async (req, res) => {
    const projectId = req.query.projectId; // Извлекаем ID проекта из параметров запроса
    if (!projectId) {
        return res.status(400).send('Отсутствует идентификатор проекта (projectId)');
    }

    try {
        const structure = await getProjectStructure(projectId); // Получаем структуру проекта без фильтров пропуска
        res.json(structure); // Отправляем структуру клиенту
    } catch (error) {
        logError(`Ошибка получения структуры для проекта ${projectId}:`, error.message); // Логирование ошибки
        res.status(500).send(error.message); // Отправляем ошибку клиенту
    }
});

/**
 * Создание или обновление маппинга компонента с функциональным блоком
 * @route POST/PATCH /api/components
 * @param {string} projectId - ID проекта
 * @param {string} componentType - Тип компонента (frontend/backend)
 * @param {string} componentName - Название компонента
 * @param {string} functionalBlock - ID функционального блока
 */
app.post('/api/components', handleComponentMapping); // Создание маппинга
app.patch('/api/components/:componentId', handleComponentMapping); // Обновление маппинга по ID
app.get('/api/components', getComponentMappings);

/**
 * Удаление маппинга компонента
 * @route DELETE /api/components/:componentId
 * @param {string} componentId - ID маппинга
 */
app.delete('/api/components/:componentId', deleteComponentMapping);

/**
 * Создание тест-плана на основе данных
 * @route POST /api/launch
 * @param {string} jiraTaskUrl - URL задачи в Jira
 * @param {string} projectId - ID проекта
 * @param {Array} functionalBlocks - Список функциональных блоков
 */
app.post('/api/launch', createTestPlan);

// Обработка всех маршрутов для React SPA (перенаправление на index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
        if (err) {
            logError(`Ошибка при обслуживании статического файла: ${err.message}`);
            res.status(500).send('Ошибка при загрузке приложения');
        }
    });
});

// Запуск сервера на указанном порту
app.listen(config.port, () => {
    logInfo(`TIA Mapping Service запущен на http://localhost:${config.port}`); // Логирование запуска сервера
});