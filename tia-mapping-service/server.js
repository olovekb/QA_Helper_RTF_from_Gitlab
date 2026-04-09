import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { uploadMiddleware, handleJsonUpload } from './api/upload.js';
import { getProjectStructure } from './api/structure.js';
import { handleComponentMapping, deleteComponentMapping, getComponentMappings, getPageMappings, savePageDependencies, getFunctionalBlockPageComponentLinks } from './api/components.js';
import { getHeatmapData, getReleaseVersions, getTestCoverageData, bulkImportHistory } from './api/heatmap.js';
import { createTestPlan } from './api/launch.js';
import config from './config/index.js';
import { logInfo, logError } from './utils/logger.js';
import { logServerError } from './api/errors.js';
import { createStubTestCase } from './api/testcase.js';
import databasePool from './db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const app = express();

const tiaAllowedOrigins = (process.env.TIA_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    'https://test-inspector.abanking.ru,http://localhost:3000,http://localhost:3001')
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
const clientBuildPath = path.join(__dirname, 'client', 'build');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const apiRouter = express.Router();

app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

apiRouter.use((req, res, next) => {
    logInfo(`${req.method} ${req.path}`);
    next();
});

apiRouter.post('/api/upload/json', uploadMiddleware, handleJsonUpload);
apiRouter.post('/api/errors', logServerError);

apiRouter.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'tia-mapping-service'
    });
});

apiRouter.get('/api/structure', async (req, res) => {
    const projectId = req.query.projectId;
    if (!projectId) {
        return res.status(400).send('Отсутствует идентификатор проекта (projectId)');
    }

    const skipCriteria = { customFieldIdsToSkip: [], namePatternsToSkip: [] };
    if (req.query.skipCustomFieldIds) {
        skipCriteria.customFieldIdsToSkip = req.query.skipCustomFieldIds
            .split(',')
            .map(id => Number(id.trim()))
            .filter(id => !isNaN(id));
    }

    try {
        const structure = await getProjectStructure(projectId, skipCriteria);
        res.json(structure);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Неизвестная ошибка');
        logError(`Ошибка получения структуры для проекта ${projectId}:`, errorMessage);
        res.status(500).send(errorMessage);
    }
});

apiRouter.post('/api/components', handleComponentMapping);
apiRouter.patch('/api/components/:componentId', handleComponentMapping);
apiRouter.post('/api/components/page-dependencies', savePageDependencies);
apiRouter.get('/api/components', getComponentMappings);
apiRouter.get('/api/components/page-mappings', getPageMappings);
apiRouter.post('/api/components/page-mappings', getPageMappings);
apiRouter.get('/api/components/functional-block-links', getFunctionalBlockPageComponentLinks);

apiRouter.get('/api/functional-blocks', async (req, res) => {
    const { projectId } = req.query;
    if (!projectId) {
        return res.status(400).json({ error: 'Необходимо указать projectId.' });
    }
    try {
        const blocks = await databasePool('functional_blocks')
            .where({ project_id: projectId })
            .select('id', 'name', 'allure_id', 'custom_field_name')
            .orderBy('name', 'asc');
        res.json(blocks);
    } catch (error) {
        logError(`Ошибка получения функциональных блоков для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Ошибка при получении функциональных блоков.', details: error.message });
    }
});

apiRouter.get('/api/heatmap', getHeatmapData);
apiRouter.get('/api/heatmap/test-coverage', getTestCoverageData);
apiRouter.get('/api/heatmap/release-versions', getReleaseVersions);
apiRouter.post('/api/heatmap/bulk-import', bulkImportHistory);

apiRouter.delete('/api/components/:componentId', deleteComponentMapping);
apiRouter.post('/api/launch', createTestPlan);
apiRouter.post('/api/stub', createStubTestCase);

apiRouter.post('/api/migrations/run', async (req, res) => {
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

apiRouter.get('/api/migrations/status', async (req, res) => {
    try {
        const migrations = await databasePool.migrate.list();
        res.json({
            success: true,
            completed: migrations[0],
            pending: migrations[1]
        });
    } catch (error) {
        logError('[migrations] Ошибка при проверке статуса миграций:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.use(['/tia-api', '/'], apiRouter);

app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
        if (err) {
            logError(`Ошибка при обслуживании статического файла: ${err.message}`);
            res.status(500).send('Ошибка при загрузке приложения');
        }
    });
});

app.listen(config.port, async () => {
    logInfo(`TIA Mapping Service запущен на http://localhost:${config.port}`);
    logInfo(`Allure base url ${process.env.ALLURE_BASE_URL}`)
    logInfo(`Allure token ${process.env.ALLURE_TOKEN}`)
    logInfo(`Allure DB host ${process.env.DB_HOST}`)

    try {
        logInfo('Автоматическое применение миграций отключено для стабильности. Используйте POST /api/migrations/run');
    } catch (error) {
        logError('Ошибка при автоматическом применении миграций при запуске:', error.message);
    }
});
