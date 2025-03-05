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
    functionalBlock: Joi.array().items(Joi.string()).min(1).required().description('Массив идентификаторов функциональных блоков для маппинга'),
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
        const { error } = componentValidationSchema.validate({ projectId, componentType, componentName, functionalBlock });
        if (error) {
            logError(`Ошибка валидации данных для маппинга компонента: ${error.details[0].message}`);
            return res.status(400).json({ error: error.details[0].message });
        }

        logInfo(`Получен запрос на маппинг компонента: projectId=${projectId}, componentType=${componentType}, componentName=${componentName}, functionalBlock=${JSON.stringify(functionalBlock)}`);

        // Нормализуем functionalBlock в массив строк
        const functionalBlocks = functionalBlock.map(block => block.toString());

        // Проверяем существование каждого функционального блока
        for (const blockId of functionalBlocks) {
            const functionalBlockData = await databasePool('functional_blocks')
                .where({ allure_id: blockId, project_id: projectId })
                .first();

            if (!functionalBlockData) {
                logWarn(`Функциональный блок с allure_id ${blockId} для проекта ${projectId} не найден`);
                return res.status(404).json({ error: `Функциональный блок с allure_id ${blockId} не найден для проекта ${projectId}.` });
            }
        }

        let query = databasePool('component_mappings'); // Используем таблицу component_mappings для маппинга

        if (req.method === 'POST') {
            // Проверяем, существуют ли маппинги для этого компонента и проекта
            const existingMappings = await query
                .where({
                    project_id: projectId,
                    component_type: componentType,
                    component_name: componentName,
                })
                .select();

            if (existingMappings.length > 0) {
                // Удаляем существующие маппинги для этого компонента
                await query
                    .where({
                        project_id: projectId,
                        component_type: componentType,
                        component_name: componentName,
                    })
                    .del();

                logInfo(`Удалены существующие маппинги для компонента ${componentName} в проекте ${projectId}`);
            }

            // Создаём новые маппинги для каждого функционального блока
            const newMappings = [];
            for (const blockId of functionalBlocks) {
                const functionalBlockData = await databasePool('functional_blocks')
                    .where({ allure_id: blockId, project_id: projectId })
                    .first();
                newMappings.push({
                    project_id: projectId,
                    component_type: componentType,
                    component_name: componentName,
                    functional_block_id: functionalBlockData.id,
                    created_at: databasePool.fn.now(),
                    updated_at: databasePool.fn.now(),
                });
            }

            await query.insert(newMappings);

            // Возвращаем только простые данные, избегая циклических ссылок
            const responseMappings = newMappings.map(mapping => ({
                project_id: mapping.project_id,
                component_type: mapping.component_type,
                component_name: mapping.component_name,
                functional_block_id: mapping.functional_block_id,
            }));

            logInfo(`Создан(ы) новый(ые) маппинг(и) для компонента ${componentName} в проекте ${projectId} с функциональными блоками: ${functionalBlocks.join(', ')}`);
            res.status(201).json({ message: 'Маппинги успешно созданы.', mappings: responseMappings });
        } else if (req.method === 'PATCH') {
            if (!componentId) {
                return res.status(400).json({ error: 'Не указан componentId для обновления.' });
            }

            // Для PATCH используем только первый функциональный блок из массива
            const blockId = functionalBlocks[0];
            const functionalBlockData = await databasePool('functional_blocks')
                .where({ allure_id: blockId, project_id: projectId })
                .first();

            if (!functionalBlockData) {
                return res.status(404).json({ error: `Функциональный блок с allure_id ${blockId} не найден для проекта ${projectId}.` });
            }

            const updatedMapping = await query
                .where({ id: componentId })
                .update({
                    functional_block_id: functionalBlockData.id,
                    updated_at: databasePool.fn.now(),
                })
                .returning('*');

            if (!updatedMapping.length) {
                return res.status(404).json({ error: `Маппинг с ID ${componentId} не найден.` });
            }

            // Возвращаем только простые данные
            const responseMapping = {
                project_id: updatedMapping[0].project_id,
                component_type: updatedMapping[0].component_type,
                component_name: updatedMapping[0].component_name,
                functional_block_id: updatedMapping[0].functional_block_id,
            };

            logInfo(`Обновлён маппинг для компонента с ID ${componentId} в проекте ${projectId}`);
            res.status(200).json({ message: 'Маппинг успешно обновлён.', mapping: responseMapping });
        }
    } catch (error) {
        logError(`Ошибка при обработке маппинга для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при создании/обновлении маппинга.', details: error.message });
    }
}

/**
 * Получение всех маппингов компонентов для проекта с дополнительной информацией о блоках
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function getComponentMappings(req, res) {
    const { projectId } = req.query;

    try {
        if (!projectId) {
            return res.status(400).json({ error: 'Необходимо указать projectId.' });
        }

        logInfo(`Получаем маппинги для проекта ${projectId}`);

        const mappings = await databasePool('component_mappings')
            .where({ 'component_mappings.project_id': projectId })
            .join('functional_blocks', 'component_mappings.functional_block_id', 'functional_blocks.id')
            .select(
                'component_mappings.project_id',
                'component_mappings.component_type',
                'component_mappings.component_name',
                'component_mappings.functional_block_id',
                'functional_blocks.allure_id as functional_block_allure_id',
                'functional_blocks.name as functional_block_name',
                'functional_blocks.custom_field_name as functional_block_custom_field_name'
            );

        res.status(200).json({ mappings });
    } catch (error) {
        logError(`Ошибка при получении маппингов для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении маппингов.', details: error.message });
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