import express from 'express'; // Импорт фреймворка Express для создания веб-сервера
import cors from 'cors'; // Импорт middleware для обработки кросс-доменных запросов
import { uploadMiddleware, handleJsonUpload } from './api/upload.js'; // Импорт функционала для загрузки JSON
import { getProjectStructure } from './api/structure.js'; // Импорт функционала для получения структуры Allure
import { handleComponentMapping, deleteComponentMapping } from './api/components.js'; // Импорт функционала для маппинга
import { createTestPlanHandler } from './api/launch.js'; // Импорт функционала для создания тест-планов
import config from './config/index.js'; // Импорт конфигурации проекта
import { logInfo } from './utils/logger.js'; // Импорт логгера для информационных сообщений

// Создание экземпляра приложения Express
const app = express();

// Настройка middleware для обработки JSON и CORS
app.use(cors()); // Разрешаем кросс-доменные запросы
app.use(express.json()); // Парсим JSON из тела запросов

/**
 * Роут для загрузки JSON-файлов фронтенда и бэкенда
 * Использует middleware Multer для обработки файлов
 */
app.post('/api/upload/json', uploadMiddleware, handleJsonUpload);

/**
 * Роут для получения структуры проекта из Allure
 * Принимает projectId как параметр запроса
 */
app.get('/api/structure', async (req, res) => {
    const projectId = req.query.projectId; // Извлекаем ID проекта из параметров запроса
    if (!projectId) {
        return res.status(400).send('Отсутствует идентификатор проекта (projectId)');
    }

    try {
        const structure = await getProjectStructure(projectId); // Получаем структуру проекта
        res.json(structure); // Отправляем структуру клиенту
    } catch (error) {
        res.status(500).send(error.message); // Отправляем ошибку, если запрос не удался
    }
});

/**
 * Роуты для управления маппингом компонентов
 */
app.post('/api/components', handleComponentMapping); // Создание или обновление маппинга
app.patch('/api/components/:componentId', handleComponentMapping); // Обновление маппинга по ID
app.delete('/api/components/:componentId', deleteComponentMapping); // Удаление маппинга по ID

/**
 * Роут для создания тест-плана
 */
app.post('/api/launch', createTestPlanHandler); // Создание тест-плана на основе данных

// Запуск сервера на указанном порту
app.listen(config.port, () => {
    logInfo(`TIA Mapping Service запущен на http://localhost:${config.port}`); // Логирование запуска сервера
});