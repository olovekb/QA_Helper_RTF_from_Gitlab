import { createComponent, updateComponent, deleteComponent, getComponents } from '../db/models.js'; // Импорт моделей БД
import Joi from 'joi'; // Импорт библиотеки для валидации
import { logInfo, logError } from '../utils/logger.js'; // Импорт логгера

/**
 * Схема валидации данных для компонентов и маппинга
 * @type {Object}
 */
const componentValidationSchema = Joi.object({
    projectId: Joi.string().required().description('Идентификатор проекта'),
    componentType: Joi.string().valid('frontend', 'backend').required().description('Тип компонента: frontend или backend'),
    functionalBlock: Joi.string().required().description('Идентификатор функционального блока для маппинга'),
    componentId: Joi.string().optional().description('Идентификатор компонента для обновления/удаления')
});

/**
 * Создание или обновление маппинга компонента
 * @param {Object} req - Объект запроса с данными компонента
 * @param {Object} res - Объект ответа
 * @returns {void}
 */
export async function handleComponentMapping(req, res) {
    const { projectId, componentType, componentName, functionalBlock } = req.body;
    const componentId = req.params.componentId; // Для PATCH

    try {
        // Валидация входных данных
        if (!projectId || !componentType || !componentName || !functionalBlock) {
            return res.status(400).json({ error: 'Необходимо указать projectId, componentType, componentName и functionalBlock.' });
        }

        // Проверяем, существует ли функциональный блок по allure_id
        let functionalBlockData = await databasePool('functional_blocks')
            .where({ allure_id: functionalBlock.toString(), project_id: projectId })
            .first();

        if (!functionalBlockData) {
            return res.status(404).json({ error: `Функциональный блок с allure_id ${functionalBlock} не найден для проекта ${projectId}.` });
        }

        let query = databasePool('component_mappings');

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
                return res.status(400).json({ error: 'Маппинг для этого компонента уже существует.' });
            }

            // Создаём новый маппинг
            const [newMapping] = await query.insert({
                project_id: projectId,
                component_type: componentType,
                component_name: componentName,
                functional_block_id: functionalBlockData.id, // Используем внутренний id
            }).returning('*');

            logInfo(`Создаём новый маппинг для компонента ${componentName} в проекте ${projectId}`);
            res.status(201).json({ message: 'Маппинг успешно создан.', mapping: newMapping });
        } else if (req.method === 'PATCH') {
            if (!componentId) {
                return res.status(400).json({ error: 'Не указан componentId для обновления.' });
            }

            const updatedMapping = await query
                .where({ id: componentId })
                .update({
                    functional_block_id: functionalBlockData.id, // Обновляем ссылку на функциональный блок
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
        logError(`Ошибка валидации данных для удаления компонента: ${error.details[0].message}`); // Логирование
        return res.status(400).send(error.details[0].message);
    }

    const { componentId } = value; // Извлечение ID компонента

    try {
        logInfo(`Удаляем маппинг компонента с ID ${componentId}`); // Логирование
        const result = await deleteComponent(componentId);
        if (!result) {
            logError(`Компонент с ID ${componentId} не найден`); // Логирование ошибки
            return res.status(404).send('Компонент не найден');
        }
        res.status(200).json({ message: 'Маппинг успешно удалён' }); // Успешный ответ
    } catch (error) {
        logError(`Ошибка при удалении маппинга компонента ${componentId}:`, error); // Логирование
        res.status(500).send('Ошибка при удалении маппинга');
    }
}