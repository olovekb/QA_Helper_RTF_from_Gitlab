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
    // Валидация входных данных
    const { error, value } = componentValidationSchema.validate(req.body);
    if (error) {
        logError(`Ошибка валидации данных для компонента: ${error.details[0].message}`); // Логирование ошибки валидации
        return res.status(400).send(error.details[0].message); // Отправка ошибки клиенту
    }

    const { projectId, componentType, functionalBlock, componentId } = value; // Извлечение валидированных данных

    try {
        let result;
        if (componentId) {
            // Обновление существующего маппинга
            logInfo(`Обновляем маппинг компонента с ID ${componentId} для проекта ${projectId}`); // Логирование
            result = await updateComponent(componentId, functionalBlock);
            if (!result) {
                logError(`Компонент с ID ${componentId} не найден`); // Логирование ошибки
                return res.status(404).send('Компонент не найден');
            }
            res.status(200).json({ message: 'Маппинг успешно обновлён', data: result }); // Успешный ответ
        } else {
            // Создание нового маппинга
            logInfo(`Создаём новый маппинг для компонента ${value.name} в проекте ${projectId}`); // Логирование
            const existingComponents = await getComponents(projectId);
            const componentExists = existingComponents.find(c => c.name === value.name && c.componentType === componentType);
            if (componentExists) {
                logError(`Компонент ${value.name} уже существует в проекте ${projectId}`); // Логирование ошибки
                return res.status(400).send('Компонент уже существует');
            }
            result = await createComponent(projectId, componentType, value.name, functionalBlock);
            res.status(201).json({ message: 'Маппинг успешно добавлен', data: { id: result } }); // Успешный ответ
        }
    } catch (error) {
        logError(`Ошибка при обработке маппинга для проекта ${projectId}:`, error); // Логирование ошибки
        res.status(500).send('Ошибка при обновлении/добавлении маппинга');
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