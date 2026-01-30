import dotenv from 'dotenv'; // Загрузка переменных окружения из .env файла
dotenv.config(); // Загружаем переменные окружения
import express from 'express'; // Импорт фреймворка Express для создания веб-сервера
import cors from 'cors'; // Импорт middleware для обработки кросс-доменных запросов
import path, { dirname } from 'path'; // Импорт path и dirname для работы с путями файлов
import { fileURLToPath } from 'url'; // Импорт для преобразования URL в путь
import multer from 'multer'; // Импорт multer для обработки загрузки файлов
import { uploadMiddleware, handleJsonUpload } from './api/upload.js'; // Импорт функционала для загрузки JSON
import { getProjectStructure } from './api/structure.js'; // Импорт функционала для получения структуры Allure
import { handleComponentMapping, deleteComponentMapping, getComponentMappings, getPageMappings, savePageDependencies, getFunctionalBlockPageComponentLinks } from './api/components.js'; // Импорт функционала для маппинга
import { getHeatmapData, getReleaseVersions, getTestCoverageData, bulkImportHistory } from './api/heatmap.js'; // Импорт функционала для тепловой карты
import { createTestPlan } from './api/launch.js'; // Импорт функционала для создания запусков
// testplan.js removed - functionality replaced by launch splitting modal
import config from './config/index.js'; // Импорт конфигурации проекта
import { logInfo, logError } from './utils/logger.js'; // Импорт логгера для информационных и ошибочных сообщений
import { logServerError } from './api/errors.js';

// Получаем __dirname в ES-модулях
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const app = express();

const tiaAllowedOrigins = (process.env.TIA_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    'https://test-inspector.abanking.ru')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

const corsOptions = {
    origin(origin, callback) {
        if (!origin) return callback(null, true);

        if (tiaAllowedOrigins.includes('*') || tiaAllowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Не разрешено конфигурацией CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
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
app.get('/health', (req, res) => {
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
app.get('/api/structure', async (req, res) => {
    const projectId = req.query.projectId; // Извлекаем ID проекта из параметров запроса
    if (!projectId) {
        return res.status(400).send('Отсутствует идентификатор проекта (projectId)');
    }

    try {
        const structure = await getProjectStructure(projectId); // Получаем структуру проекта без фильтров пропуска
        res.json(structure); // Отправляем структуру клиенту
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Неизвестная ошибка');
        logError(`Ошибка получения структуры для проекта ${projectId}:`, errorMessage); // Логирование ошибки
        res.status(500).send(errorMessage); // Отправляем ошибку клиенту
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
app.post('/api/components/page-dependencies', savePageDependencies); // Сохранение связей Page -> компоненты
app.get('/api/components', getComponentMappings);
app.get('/api/components/page-mappings', getPageMappings); // Получение маппингов функциональных блоков для Page
app.post('/api/components/page-mappings', getPageMappings); // Получение маппингов функциональных блоков для Page (POST для больших списков)
app.get('/api/components/functional-block-links', getFunctionalBlockPageComponentLinks); // Получение явных связей функциональный блок -> Page -> компонент

/**
 * Получение данных для тепловой карты дефектов
 * @route GET /api/heatmap
 * @param {string} projectId - ID проекта
 * @param {string} startDate - Начальная дата (ISO 8601, опционально)
 * @param {string} endDate - Конечная дата (ISO 8601, опционально)
 * @param {string[]} releaseVersions - Массив версий релизов (опционально)
 * @param {boolean} isBugFix - Фильтр по типу: true - только баги, false - общий (опционально)
 */
app.get('/api/heatmap', getHeatmapData);

/**
 * Получение данных для тепловой карты Test Coverage (по функциональным блокам и роутам)
 * @route GET /api/heatmap/test-coverage
 * @param {string} projectId - ID проекта
 * @param {string} startDate - Начальная дата (ISO 8601, опционально)
 * @param {string} endDate - Конечная дата (ISO 8601, опционально)
 * @param {string[]} releaseVersions - Массив версий релизов (опционально)
 * @param {boolean} isBugFix - Фильтр по типу: true - только баги, false - общий (опционально)
 */
app.get('/api/heatmap/test-coverage', getTestCoverageData);

/**
 * Получение списка доступных версий релизов для проекта
 * @route GET /api/heatmap/release-versions
 * @param {string} projectId - ID проекта
 * @param {string} startDate - Начальная дата для фильтрации (опционально)
 * @param {string} endDate - Конечная дата для фильтрации (опционально)
 */
app.get('/api/heatmap/release-versions', getReleaseVersions);
app.post('/api/heatmap/bulk-import', bulkImportHistory); // Массовый импорт истории

/**
 * Удаление маппинга компонента
 * @route DELETE /api/components/:componentId
 * @param {string} componentId - ID маппинга
 */
app.delete('/api/components/:componentId', deleteComponentMapping);

/**
 * Создание запуска в Allure
 * @route POST /api/launch
 * @param {string} jiraTaskUrl - URL задачи в Jira (опционально)
 * @param {string} projectId - ID проекта
 * @param {Object} componentMappings - Маппинги компонентов
 */
app.post('/api/launch', createTestPlan);

// /api/testplan removed - functionality replaced by launch splitting modal

// Обработка всех маршрутов для React SPA (перенаправление на index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
        if (err) {
            logError(`Ошибка при обслуживании статического файла: ${err.message}`);
            res.status(500).send('Ошибка при загрузке приложения');
        }
    });
});

// Функция для применения миграций
async function runMigrations() {
    try {
        logInfo('Применение миграций базы данных...');
        const knex = await import('./db/connection.js');
        const [batchNo, log] = await knex.default.migrate.latest();
        logInfo(`Миграции успешно применены. Batch: ${batchNo}, Applied: ${log.length}`);
        if (log.length > 0) {
            logInfo(`Применённые миграции: ${log.join(', ')}`);
        }
        return { success: true, batchNo, applied: log };
    } catch (error) {
        logError('Ошибка при применении миграций:', error.message);
        throw error;
    }
}

/**
 * Эндпоинт для ручного запуска миграций (для админов)
 * @route POST /api/migrations/run
 */
app.post('/api/migrations/run', async (req, res) => {
    try {
        logInfo('[migrations] Запрос на ручное применение миграций');
        const result = await runMigrations();
        res.json({
            success: true,
            message: 'Миграции успешно применены',
            batchNo: result.batchNo,
            applied: result.applied
        });
    } catch (error) {
        logError('[migrations] Ошибка при применении миграций:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * Эндпоинт для проверки статуса миграций
 * @route GET /api/migrations/status
 */
app.get('/api/migrations/status', async (req, res) => {
    try {
        const knex = await import('./db/connection.js');
        const migrations = await knex.default.migrate.list();
        res.json({
            success: true,
            completed: migrations[0], // Уже применённые
            pending: migrations[1]     // Ожидающие применения
        });
    } catch (error) {
        logError('[migrations] Ошибка при проверке статуса миграций:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Запуск сервера на указанном порту
app.listen(config.port, async () => {
    logInfo(`TIA Mapping Service запущен на http://localhost:${config.port}`);
    logInfo(`Allure base url ${process.env.ALLURE_BASE_URL}`) // Логирование env
    logInfo(`Allure token ${process.env.ALLURE_TOKEN}`) // Логирование env
    logInfo(`Allure DB host ${process.env.DB_HOST}`) // Логирование env

    // Применяем миграции при запуске
    try {
        // await runMigrations();
        logInfo('Автоматическое применение миграций отключено для стабильности. Используйте POST /api/migrations/run');
    } catch (error) {
        logError('Ошибка при автоматическом применении миграций при запуске:', error.message);
        // Не останавливаем сервер, продолжаем работу
        // Миграции можно применить вручную через POST /api/migrations/run
    }
});
