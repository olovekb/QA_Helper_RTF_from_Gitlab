import axios from 'axios'; // Импорт библиотеки для HTTP-запросов
import config from '../config/index.js'; // Импорт конфигурации
import { logInfo, logError } from '../utils/logger.js'; // Импорт логгера

/**
 * Получает структуру проекта из Allure API
 * @param {string} projectId - Идентификатор проекта в Allure
 * @returns {Promise<Object>} - Структура проекта с функциональными блоками
 * @throws {Error} - Если запрос не удался
 */
export async function getProjectStructure(projectId) {
    try {
        logInfo(`Запрашиваем структуру проекта с ID ${projectId} из Allure API`); // Логирование запроса

        const response = await axios.get(`${config.allureBaseUrl}/structure`, {
            params: { projectId }, // Параметры запроса
            headers: {
                'Authorization': `Bearer ${config.allureToken}`, // Токен авторизации
                'Content-Type': 'application/json' // Тип контента
            }
        });

        logInfo(`Успешно получена структура проекта ${projectId}`); // Логирование успеха
        return response.data; // Возвращаем данные структуры
    } catch (error) {
        logError(`Ошибка получения структуры проекта ${projectId}:`, error); // Логирование ошибки
        throw new Error(`Не удалось получить структуру проекта: ${error.message}`); // Выбрасываем ошибку
    }
}