import dotenv from 'dotenv'; // Загрузка переменных окружения из .env файла
dotenv.config(); // Загружаем переменные окружения
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


const app = express();

const corsOptions = {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const clientBuildPath = path.join(__dirname, 'client', 'build');
app.use(express.static(clientBuildPath));


const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Роуты API для работы с TIA и маппингом

/**
 * Обработка загрузки JSON-файлов
 * @route POST /api/upload/json
 */
app.post('/api/upload/json', uploadMiddleware, handleJsonUpload);

app.post('/api/errors', logServerError);

// Health check endpoint
app.get('/health', (req, res) =>
{
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'tia-mapping-service'
    });
});

/**
 * Получение структуры проекта из Allure без пропуска узлов
 * @route GET /api/structure
 * @param {string} projectId - ID проекта
 */
app.get('/api/structure', async (req, res) =>
{
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
app.get('*', (req, res) =>
{
    res.sendFile(path.join(clientBuildPath, 'index.html'), (err) =>
    {
        if (err) {
            logError(`Ошибка при обслуживании статического файла: ${err.message}`);
            res.status(500).send('Ошибка при загрузке приложения');
        }
    });
});

// Функция для применения миграций
async function runMigrations ()
{
    try {
        logInfo('Применение миграций базы данных...');
        const knex = await import('./db/connection.js');
        await knex.default.migrate.latest();
        logInfo('Миграции успешно применены');
    } catch (error) {
        logError('Ошибка при применении миграций:', error.message);
        // Не останавливаем сервер, продолжаем работу
    }
}

// Запуск сервера на указанном порту
app.listen(config.port, async () =>
{
    logInfo(`TIA Mapping Service запущен на http://localhost:${config.port}`);
    logInfo(`Allure base url ${process.env.ALLURE_BASE_URL}`) // Логирование env
    logInfo(`Allure token ${process.env.ALLURE_TOKEN}`) // Логирование env
    logInfo(`Allure DB host ${process.env.DB_HOST}`) // Логирование env

    // Применяем миграции при запуске
    await runMigrations();
});
