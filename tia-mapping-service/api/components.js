import { logInfo, logError, logWarn } from '../utils/logger.js'; // Импорт логгера для информационных и ошибочных сообщений
import databasePool from '../db/pool.js'; // Импорт пула подключений к базе данных
import Joi from 'joi'; // Импорт библиотеки для валидации

/**
 * Схема валидации данных для компонентов и маппинга
 * @type {Object}
 */
const componentValidationSchema = Joi.object({
    projectId: Joi.string().required().description('Идентификатор проекта'),
    componentType: Joi.string().valid('frontend', 'backend', 'page', 'component').required().description('Тип компонента: frontend/backend/page/component'),
    componentName: Joi.string().required().description('Название компонента'),
    functionalBlock: Joi.array().items(Joi.string()).required().description('Массив идентификаторов функциональных блоков для маппинга (может быть пустым)'),
    componentId: Joi.string().optional().description('Идентификатор компонента для обновления/удаления'),
    pageDependencies: Joi.array().items(Joi.object({
        pageName: Joi.string().required(),
        pageRoute: Joi.string().allow(null, '').optional(),
        componentName: Joi.string().required(),
        componentType: Joi.string().valid('component', 'page').default('component')
    })).optional().description('Массив связей Page -> компоненты'),
    releaseVersion: Joi.alternatives().try(
        Joi.string().allow(null, ''),
        Joi.array().items(Joi.string().allow(null, ''))
    ).optional().description('Версия релиза (например, "npp-2.214.0") или массив версий'),
    releaseVersions: Joi.array().items(Joi.string()).optional().description('Массив версий релизов (альтернатива releaseVersion)'),
    changeDate: Joi.string().isoDate().optional().allow(null, '').description('Дата изменения компонента в формате ISO 8601'),
    isBugFix: Joi.boolean().optional().description('Флаг анализа компонентов из бага'),
});

/**
 * Создание или обновление маппинга компонента
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
/**
 * Сохранение связей Page -> компоненты
 * @param {string} projectId - Идентификатор проекта
 * @param {Array} pageDependencies - Массив связей {pageName, pageRoute, componentName, componentType}
 */
/**
 * Найти или создать компонент в таблице components
 * @param {string} projectId - Идентификатор проекта
 * @param {string} componentType - Тип компонента
 * @param {string} componentName - Название компонента
 * @returns {Promise<Object>} - Объект компонента с id
 */
async function findOrCreateComponent(projectId, componentType, componentName) {
    // Ищем существующий компонент
    let component = await databasePool('components')
        .where({
            project_id: projectId,
            component_type: componentType,
            component_name: componentName,
        })
        .first();

    // Если не найден, создаём новый
    if (!component) {
        const [newComponent] = await databasePool('components')
            .insert({
                project_id: projectId,
                component_type: componentType,
                component_name: componentName,
                created_at: databasePool.fn.now(),
                updated_at: databasePool.fn.now(),
            })
            .returning('*');
        component = newComponent;
        logInfo(`Создан новый компонент: ${componentName} (${componentType}) для проекта ${projectId}`);
    }

    return component;
}

/**
 * Сохранение связей Page -> компоненты
 * @param {string} projectId - Идентификатор проекта
 * @param {Array} pageDependencies - Массив связей {pageName, pageRoute, componentName, componentType}
 */
export async function savePageComponentDependencies(projectId, pageDependencies) {
    if (!pageDependencies || pageDependencies.length === 0) {
        return;
    }

    // Удаляем существующие связи для этих страниц и компонентов
    // Используем уникальный ключ для предотвращения дублирования
    const uniqueDeps = new Map();
    for (const dep of pageDependencies) {
        const key = `${projectId}_${dep.pageName}_${dep.componentName}`;
        if (!uniqueDeps.has(key)) {
            uniqueDeps.set(key, dep);
        }
    }

    for (const dep of uniqueDeps.values()) {
        await databasePool('page_component_dependencies')
            .where({
                project_id: projectId,
                page_name: dep.pageName,
                component_name: dep.componentName
            })
            .del();
    }

    // Создаём новые связи (убираем дубликаты)
    const uniqueDepsMap = new Map();
    for (const dep of pageDependencies) {
        const key = `${projectId}_${dep.pageName}_${dep.componentName}`;
        if (!uniqueDepsMap.has(key)) {
            // Находим или создаём компонент
            const component = await findOrCreateComponent(
                projectId,
                dep.componentType || 'component',
                dep.componentName
            );

            uniqueDepsMap.set(key, {
                project_id: projectId,
                page_name: dep.pageName,
                page_route: dep.pageRoute || null,
                component_name: dep.componentName,
                component_type: dep.componentType || 'component',
                component_id: component.id,
                created_at: databasePool.fn.now(),
                updated_at: databasePool.fn.now(),
            });
        }
    }

    const newDependencies = Array.from(uniqueDepsMap.values());

    if (newDependencies.length > 0) {
        // Используем onConflict для предотвращения дублирования при повторной вставке
        await databasePool('page_component_dependencies')
            .insert(newDependencies)
            .onConflict(['project_id', 'page_name', 'component_name'])
            .merge({
                page_route: databasePool.raw('EXCLUDED.page_route'),
                component_type: databasePool.raw('EXCLUDED.component_type'),
                component_id: databasePool.raw('EXCLUDED.component_id'),
                updated_at: databasePool.fn.now(),
            });
        logInfo(`Сохранено ${newDependencies.length} связей Page -> компоненты для проекта ${projectId}`);
    }
}

export async function handleComponentMapping(req, res) {
    const { projectId, componentType, componentName, functionalBlock, pageDependencies, releaseVersion, releaseVersions, changeDate, isBugFix } = req.body;
    const componentId = req.params.componentId; // Для PATCH

    try {
        // Валидация входных данных
        const { error } = componentValidationSchema.validate({ projectId, componentType, componentName, functionalBlock, pageDependencies, releaseVersion, releaseVersions, changeDate, isBugFix });
        if (error) {
            logError(`Ошибка валидации данных для маппинга компонента: ${error.details[0].message}`);
            return res.status(400).json({ error: error.details[0].message });
        }

        // Нормализуем releaseVersions: если передан releaseVersion (строка или массив), используем его, иначе releaseVersions
        let normalizedReleaseVersions = [];
        if (releaseVersions && Array.isArray(releaseVersions)) {
            normalizedReleaseVersions = releaseVersions.filter(v => v); // Убираем пустые значения
        } else if (releaseVersion) {
            if (Array.isArray(releaseVersion)) {
                normalizedReleaseVersions = releaseVersion.filter(v => v);
            } else {
                normalizedReleaseVersions = [releaseVersion];
            }
        }

        logInfo(`Получен запрос на маппинг компонента: projectId=${projectId}, componentType=${componentType}, componentName=${componentName}, functionalBlock=${JSON.stringify(functionalBlock)}, releaseVersions=${JSON.stringify(normalizedReleaseVersions)}, isBugFix=${isBugFix}`);

        // Нормализуем functionalBlock в массив строк
        const functionalBlocks = functionalBlock.map(block => block.toString());

        // 1. Находим или создаём компонент в таблице components
        const component = await findOrCreateComponent(projectId, componentType, componentName);

        // 2. Если isBugFix === true, сохраняем в component_defects для каждой версии (только добавляем, не удаляем и не меняем)
        if (isBugFix === true && (normalizedReleaseVersions.length > 0 || changeDate)) {
            try {
                const defectsToInsert = [];
                
                // Если есть версии, создаём запись для каждой версии
                if (normalizedReleaseVersions.length > 0) {
                    for (const version of normalizedReleaseVersions) {
                        defectsToInsert.push({
                            component_id: component.id,
                            release_version: version || null,
                            change_date: changeDate || null,
                            created_at: databasePool.fn.now(),
                        });
                    }
                } else if (changeDate) {
                    // Если версий нет, но есть дата, создаём одну запись
                    defectsToInsert.push({
                        component_id: component.id,
                        release_version: null,
                        change_date: changeDate || null,
                        created_at: databasePool.fn.now(),
                    });
                }

                if (defectsToInsert.length > 0) {
                    // Используем onConflict для дедупликации - только добавляем, не меняем существующие
                    await databasePool('component_defects')
                        .insert(defectsToInsert)
                        .onConflict(['component_id', 'release_version', 'change_date'])
                        .ignore(); // Игнорируем дубликаты (только добавляем новые)
                    logInfo(`Сохранено ${defectsToInsert.length} дефектов для компонента ${componentName} (${componentType}) в проекте ${projectId}`);
                }
            } catch (defectError) {
                // Игнорируем ошибки дубликатов (они уже обработаны через onConflict)
                logWarn(`Не удалось сохранить дефекты для компонента ${componentName}: ${defectError.message}`);
            }
        }

        if (req.method === 'POST') {
            // 3. Удаляем существующие связи компонент-функциональные блоки
            const deletedCount = await databasePool('component_functional_blocks')
                .where({ component_id: component.id })
                .del();

            if (deletedCount > 0) {
                logInfo(`Удалены существующие связи (${deletedCount}) для компонента ${componentName} в проекте ${projectId}`);
            }

            // 4. Если переданы функциональные блоки, создаём новые связи
            if (functionalBlocks.length > 0) {
                // Проверяем существование каждого функционального блока
                const newLinks = [];
                for (const blockId of functionalBlocks) {
                    const functionalBlockData = await databasePool('functional_blocks')
                        .where({ allure_id: blockId, project_id: projectId })
                        .first();

                    if (!functionalBlockData) {
                        logWarn(`Функциональный блок с allure_id ${blockId} для проекта ${projectId} не найден`);
                        return res.status(404).json({ error: `Функциональный блок с allure_id ${blockId} не найден для проекта ${projectId}.` });
                    }

                    newLinks.push({
                        component_id: component.id,
                        functional_block_id: functionalBlockData.id,
                        created_at: databasePool.fn.now(),
                    });
                }

                if (newLinks.length > 0) {
                    await databasePool('component_functional_blocks')
                        .insert(newLinks)
                        .onConflict(['component_id', 'functional_block_id'])
                        .ignore();
                    logInfo(`Создано ${newLinks.length} новых связей для компонента ${componentName} в проекте ${projectId}`);
                }
            } else {
                logInfo(`Все связи удалены для компонента ${componentName} в проекте ${projectId} (передан пустой массив функциональных блоков)`);
            }

            // 5. Сохраняем связи Page -> компоненты, если они переданы
            if (pageDependencies && pageDependencies.length > 0) {
                await savePageComponentDependencies(projectId, pageDependencies);
            }

            // 6. Получаем актуальные связи из БД для ответа
            const currentLinks = await databasePool('component_functional_blocks')
                .where({ component_id: component.id })
                .join('functional_blocks', 'component_functional_blocks.functional_block_id', 'functional_blocks.id')
                .select(
                    'functional_blocks.allure_id as functional_block_allure_id',
                    'functional_blocks.name as functional_block_name'
                );

            // Возвращаем только простые данные
            const responseMappings = currentLinks.map(link => ({
                functional_block_allure_id: link.functional_block_allure_id,
                functional_block_name: link.functional_block_name,
            }));

            if (functionalBlocks.length > 0) {
                res.status(201).json({ 
                    message: 'Маппинги успешно созданы.', 
                    mappings: responseMappings,
                    component_id: component.id 
                });
            } else {
                res.status(200).json({ 
                    message: 'Все маппинги успешно удалены.', 
                    mappings: [],
                    component_id: component.id 
                });
            }
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

            // Обновляем связь в component_functional_blocks
            await databasePool('component_functional_blocks')
                .where({ component_id: component.id })
                .del();

            await databasePool('component_functional_blocks')
                .insert({
                    component_id: component.id,
                    functional_block_id: functionalBlockData.id,
                    created_at: databasePool.fn.now(),
                })
                .onConflict(['component_id', 'functional_block_id'])
                .ignore();

            logInfo(`Обновлён маппинг для компонента с ID ${component.id} в проекте ${projectId}`);
            res.status(200).json({ 
                message: 'Маппинг успешно обновлён.', 
                component_id: component.id 
            });
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

        // Получаем маппинги из новой структуры
        const mappings = await databasePool('components')
            .where({ 'components.project_id': projectId })
            .leftJoin('component_functional_blocks', 'components.id', 'component_functional_blocks.component_id')
            .leftJoin('functional_blocks', 'component_functional_blocks.functional_block_id', 'functional_blocks.id')
            .select(
                'components.id as component_id',
                'components.project_id',
                'components.component_type',
                'components.component_name',
                'functional_blocks.id as functional_block_id',
                'functional_blocks.allure_id as functional_block_allure_id',
                'functional_blocks.name as functional_block_name',
                'functional_blocks.custom_field_name as functional_block_custom_field_name'
            );

        // Группируем по компонентам (один компонент может иметь несколько функциональных блоков)
        const componentMap = new Map();
        mappings.forEach(row => {
            const key = `${row.component_id}`;
            if (!componentMap.has(key)) {
                componentMap.set(key, {
                    component_id: row.component_id,
                    project_id: row.project_id,
                    component_type: row.component_type,
                    component_name: row.component_name,
                    functional_blocks: []
                });
            }
            
            if (row.functional_block_id) {
                componentMap.get(key).functional_blocks.push({
                    functional_block_id: row.functional_block_id,
                    functional_block_allure_id: row.functional_block_allure_id,
                    functional_block_name: row.functional_block_name,
                    functional_block_custom_field_name: row.functional_block_custom_field_name
                });
            }
        });

        // Преобразуем в массив для обратной совместимости (старый формат)
        const responseMappings = [];
        componentMap.forEach(component => {
            if (component.functional_blocks.length > 0) {
                // Создаём отдельную запись для каждого функционального блока
                component.functional_blocks.forEach(fb => {
                    responseMappings.push({
                        project_id: component.project_id,
                        component_type: component.component_type,
                        component_name: component.component_name,
                        functional_block_id: fb.functional_block_id,
                        functional_block_allure_id: fb.functional_block_allure_id,
                        functional_block_name: fb.functional_block_name,
                        functional_block_custom_field_name: fb.functional_block_custom_field_name
                    });
                });
            } else {
                // Компонент без маппинга
                responseMappings.push({
                    project_id: component.project_id,
                    component_type: component.component_type,
                    component_name: component.component_name,
                    functional_block_id: null,
                    functional_block_allure_id: null,
                    functional_block_name: null,
                    functional_block_custom_field_name: null
                });
            }
        });

        res.status(200).json({ mappings: responseMappings });
    } catch (error) {
        logError(`Ошибка при получении маппингов для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении маппингов.', details: error.message });
    }
}

/**
 * Сохранение связей Page -> компоненты (отдельный endpoint)
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function savePageDependencies(req, res) {
    const { projectId, pageDependencies } = req.body;

    try {
        if (!projectId) {
            return res.status(400).json({ error: 'Необходимо указать projectId.' });
        }

        if (!pageDependencies || !Array.isArray(pageDependencies)) {
            return res.status(400).json({ error: 'Необходимо указать pageDependencies как массив.' });
        }

        await savePageComponentDependencies(projectId, pageDependencies);
        res.status(200).json({ message: 'Связи Page -> компоненты успешно сохранены.' });
    } catch (error) {
        logError(`Ошибка при сохранении связей Page -> компоненты для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при сохранении связей.', details: error.message });
    }
}

/**
 * Получение явных связей: функциональный блок -> Page -> дочерний компонент
 * @param {Object} req - Объект запроса
 * @param {Object} res - Объект ответа
 * @returns {void}
 */
export async function getFunctionalBlockPageComponentLinks(req, res) {
    const { projectId, functionalBlockId, pageName, componentName } = req.query;

    try {
        let query = databasePool('functional_block_page_component_links as fbpc')
            .join('functional_blocks as fb', 'fbpc.functional_block_id', 'fb.id')
            .join('component_mappings as cm_page', 'fbpc.page_mapping_id', 'cm_page.id')
            .join('page_component_dependencies as pcd', 'fbpc.page_component_dependency_id', 'pcd.id')
            .select(
                'fbpc.id',
                'fbpc.project_id',
                'fb.id as functional_block_id',
                'fb.allure_id as functional_block_allure_id',
                'fb.name as functional_block_name',
                'cm_page.id as page_mapping_id',
                'cm_page.component_name as page_name',
                'pcd.id as page_component_dependency_id',
                'pcd.component_name as component_name',
                'pcd.page_route',
                'fbpc.created_at',
                'fbpc.updated_at'
            );

        if (projectId) {
            query = query.where('fbpc.project_id', projectId);
        }
        if (functionalBlockId) {
            query = query.where('fbpc.functional_block_id', functionalBlockId);
        }
        if (pageName) {
            query = query.where('fbpc.page_name', pageName);
        }
        if (componentName) {
            query = query.where('fbpc.component_name', componentName);
        }

        const links = await query;
        logInfo(`Получено ${links.length} связей функциональный блок -> Page -> компонент для проекта ${projectId || 'всех'}`);
        res.status(200).json({ links });
    } catch (error) {
        logError(`Ошибка при получении связей функциональный блок -> Page -> компонент:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении связей.', details: error.message });
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