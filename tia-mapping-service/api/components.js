// api/components.js
import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js'; // Для авторизации, если нужно
import config from '../config/index.js'; // Конфигурация проекта
import { logInfo, logError, logWarn } from '../utils/logger.js'; // Импорт логгера для информационных и ошибочных сообщений
import databasePool from '../db/pool.js'; // Импорт пула подключений к базе данных
import Joi from 'joi'; // Импорт библиотеки для валидации

/**
 * Схема валидации данных для компонентов и маппинга
 * @type {Object}
 */
const componentValidationSchema = Joi.object({
    projectId: Joi.string().required().description('Идентификатор проекта'),
    componentType: Joi.string().valid('frontend', 'backend').required().description('Тип компонента: frontend или backend'),
    componentName: Joi.string().required().description('Название компонента'),
    functionalBlock: Joi.string().required().description('Идентификатор функционального блока для маппинга'),
    componentId: Joi.string().optional().description('Идентификатор компонента для обновления/удаления'),
});

/**
 * Создание или обновление маппинга компонента
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function handleComponentMapping(req, res) {
    const { projectId, componentType, componentName, functionalBlock } = req.body;
    const componentId = req.params.componentId; // Для PATCH

    try {
        // Валидация входных данных
        const { error, value } = componentValidationSchema.validate({ projectId, componentType, componentName, functionalBlock });
        if (error) {
            logError(`Ошибка валидации данных для маппинга компонента: ${error.details[0].message}`);
            return res.status(400).json({ error: error.details[0].message });
        }

        logInfo(`Получен запрос на маппинг компонента: projectId=${projectId}, componentType=${componentType}, componentName=${componentName}, functionalBlock=${functionalBlock}`);

        // Проверяем, существует ли функциональный блок по allure_id в таблице functional_blocks
        const functionalBlockData = await databasePool('functional_blocks')
            .where({ allure_id: functionalBlock.toString(), project_id: projectId })
            .first();

        if (!functionalBlockData) {
            logWarn(`Функциональный блок с allure_id ${functionalBlock} для проекта ${projectId} не найден`);
            return res.status(404).json({ error: `Функциональный блок с allure_id ${functionalBlock} не найден для проекта ${projectId}.` });
        }

        let query = databasePool('component_mappings'); // Используем таблицу component_mappings для маппинга

        if (req.method === 'POST') {
            // Проверяем, существует ли маппинг для этого компонента и проекта
            const existingMapping = await query
                .where({
                    project_id: projectId,
                    component_type: componentType,
                    component_name: componentName,
                })
                .first();

            if (existingMapping) {
                // Обновляем существующий маппинг вместо возврата ошибки
                const updatedMapping = await query
                    .where({ id: existingMapping.id })
                    .update({
                        functional_block_id: functionalBlockData.id, // Обновляем ссылку на новый функциональный блок
                        updated_at: databasePool.fn.now(),
                    })
                    .returning('*');

                logInfo(`Перезаписан маппинг для компонента ${componentName} в проекте ${projectId} (новый functional_block_id: ${functionalBlock})`);
                return res.status(200).json({ message: 'Маппинг успешно перезаписан.', mapping: updatedMapping[0] });
            }

            // Создаём новый маппинг, если маппинг не существует
            const [newMapping] = await query.insert({
                project_id: projectId,
                component_type: componentType,
                component_name: componentName,
                functional_block_id: functionalBlockData.id, // Используем внутренний id из functional_blocks
                created_at: databasePool.fn.now(),
                updated_at: databasePool.fn.now(),
            }).returning('*');

            logInfo(`Создан новый маппинг для компонента ${componentName} в проекте ${projectId}`);
            res.status(201).json({ message: 'Маппинг успешно создан.', mapping: newMapping });
        } else if (req.method === 'PATCH') {
            if (!componentId) {
                return res.status(400).json({ error: 'Не указан componentId для обновления.' });
            }

            const updatedMapping = await query
                .where({ id: componentId })
                .update({
                    functional_block_id: functionalBlockData.id, // Обновляем ссылку на функциональный блок
                    updated_at: databasePool.fn.now(),
                })
                .returning('*');

            if (!updatedMapping.length) {
                return res.status(404).json({ error: `Маппинг с ID ${componentId} не найден.` });
            }

            logInfo(`Обновлён маппинг для компонента с ID ${componentId} в проекте ${projectId}`);
            res.status(200).json({ message: 'Маппинг успешно обновлён.', mapping: updatedMapping[0] });
        }
    } catch (error) {
        logError(`Ошибка при обработке маппинга для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при создании/обновлении маппинга.', details: error.message });
    }
}

/**
 * Удаление маппинга компонента
 * @param {Object} req - Объект запроса с параметром componentId
 * @param {Object} res - Объект ответа
 * @returns {void}
 */
export async function deleteComponentMapping(req, res) {
    // Валидация ID компонента
    const { error, value } = componentValidationSchema.validate({ ...req.body, componentId: req.params.componentId });
    if (error) {
        logError(`Ошибка валидации данных для удаления компонента: ${error.details[0].message}`);
        return res.status(400).send(error.details[0].message);
    }

    const { componentId } = value; // Извлечение ID компонента

    try {
        logInfo(`Удаляем маппинг компонента с ID ${componentId}`);
        const result = await databasePool('component_mappings')
            .where({ id: componentId })
            .del();

        if (!result) {
            logError(`Маппинг с ID ${componentId} не найден`);
            return res.status(404).json({ error: 'Маппинг не найден' });
        }

        res.status(200).json({ message: 'Маппинг успешно удалён' });
    } catch (error) {
        logError(`Ошибка при удалении маппинга компонента ${componentId}:`, error.message);
        res.status(500).json({ error: 'Ошибка при удалении маппинга.', details: error.message });
    }
}