import { createTestPlan } from '../db/models.js'; // Импорт функции для создания тест-плана
import Joi from 'joi'; // Импорт библиотеки для валидации
import { logInfo, logError } from '../utils/logger.js'; // Импорт логгера

/**
 * Схема валидации данных для создания тест-плана
 * @type {Object}
 */
const testPlanValidationSchema = Joi.object({
    projectId: Joi.string().required().description('Идентификатор проекта'),
    jiraTaskUrl: Joi.string().uri().required().description('URL задачи Jira'),
    functionalBlocks: Joi.array().items(Joi.object({
        id: Joi.string().required(),
        components: Joi.array().items(Joi.string()).required()
    })).required().description('Список функциональных блоков с маппингом компонентов')
});

/**
 * Создание тест-плана на основе данных TIA и маппинга
 * @param {Object} req - Объект запроса с данными тест-плана
 * @param {Object} res - Объект ответа
 * @returns {void}
 */
export async function createTestPlanHandler(req, res) {
    // Валидация входных данных
    const { error, value } = testPlanValidationSchema.validate(req.body);
    if (error) {
        logError(`Ошибка валидации данных тест-плана: ${error.details[0].message}`); // Логирование
        return res.status(400).send(error.details[0].message);
    }

    const { projectId, jiraTaskUrl, functionalBlocks } = value; // Извлечение валидированных данных

    try {
        logInfo(`Создаём тест-план для проекта ${projectId} с задачей Jira ${jiraTaskUrl}`); // Логирование
        const testPlanId = await createTestPlan(projectId, jiraTaskUrl, functionalBlocks);
        res.status(201).json({ message: 'Тест-план успешно создан', id: testPlanId }); // Успешный ответ
    } catch (error) {
        logError(`Ошибка при создании тест-плана для проекта ${projectId}:`, error); // Логирование
        res.status(500).send('Ошибка при создании тест-плана');
    }
}