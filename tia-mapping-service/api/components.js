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
        componentType: Joi.string().valid('component', 'page').allow(null, '').optional()
    })).optional().description('Массив связей Page -> компоненты'),
    releaseVersion: Joi.alternatives().try(
        Joi.string().allow(null, ''),
        Joi.array().items(Joi.string().allow(null, ''))
    ).optional().description('Версия релиза (например, "npp-2.214.0") или массив версий'),
    releaseVersions: Joi.array().items(Joi.string()).optional().description('Массив версий релизов (альтернатива releaseVersion)'),
    changeDate: Joi.alternatives().try(
        Joi.string().isoDate(),
        Joi.string().allow(null, ''),
        Joi.valid(null, '')
    ).optional().description('Дата изменения компонента в формате ISO 8601'),
    isBugFix: Joi.boolean().optional().description('Флаг анализа компонентов из бага'),
    issueKey: Joi.string().allow(null, '').optional().description('Ключ задачи в Jira'),
    mrIid: Joi.alternatives().try(Joi.number(), Joi.string()).allow(null, '').optional().description('ID мерж-реквеста'),
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
    // Используем onConflict для атомарного поиска/создания
    // Это предотвращает ошибки дубликатов при параллельных запросах
    const [component] = await databasePool('components')
        .insert({
            project_id: projectId,
            component_type: componentType,
            component_name: componentName,
            created_at: databasePool.fn.now(),
            updated_at: databasePool.fn.now(),
        })
        .onConflict(['project_id', 'component_type', 'component_name'])
        .merge({
            updated_at: databasePool.fn.now() // Просто обновляем время, чтобы получить ID
        })
        .returning('*');

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

    // Нормализуем pageDependencies: устанавливаем default для componentType
    const normalizedDeps = pageDependencies.map(dep => ({
        ...dep,
        componentType: (dep.componentType && ['component', 'page'].includes(dep.componentType))
            ? dep.componentType
            : 'component' // Default если отсутствует, null, undefined или невалидное значение
    }));

    // Используем уникальный ключ для предотвращения дублирования
    // Удаление предварительных записей НЕ требуется, т.к. onConflict().merge() обновит существующие
    const uniqueDeps = new Map();
    for (const dep of normalizedDeps) {
        // Ключ теперь включает pageRoute и componentType для полной уникальности
        const key = `${projectId}_${dep.pageName}_${dep.pageRoute || ''}_${dep.componentName}_${dep.componentType || ''}`;
        if (!uniqueDeps.has(key)) {
            uniqueDeps.set(key, dep);
        }
    }

    // Используем уникальные зависимости
    const finalDeps = Array.from(uniqueDeps.values());

    // Создаём новые связи (убираем дубликаты)
    const uniqueDepsMap = new Map();
    for (const dep of finalDeps) {
        const key = `${projectId}_${dep.pageName}_${dep.pageRoute || ''}_${dep.componentName}_${dep.componentType || ''}`;
        if (!uniqueDepsMap.has(key)) {
            // Определяем реальный тип компонента для создания в таблице components
            // Если есть realComponentType (frontend/backend), используем его
            // Иначе пытаемся найти существующий компонент или используем 'frontend' по умолчанию
            let realComponentType = dep.realComponentType;
            if (!realComponentType || !['frontend', 'backend', 'page', 'component'].includes(realComponentType)) {
                // Пытаемся найти существующий компонент
                const existingComponent = await databasePool('components')
                    .where({
                        project_id: projectId,
                        component_name: dep.componentName
                    })
                    .first();

                if (existingComponent) {
                    realComponentType = existingComponent.component_type;
                } else {
                    // По умолчанию для нового формата TIA - frontend
                    realComponentType = 'frontend';
                }
            }

            // Находим или создаём компонент с реальным типом
            const component = await findOrCreateComponent(
                projectId,
                realComponentType, // 'frontend', 'backend', 'page' или 'component'
                dep.componentName
            );

            uniqueDepsMap.set(key, {
                project_id: projectId,
                page_name: dep.pageName,
                page_route: dep.pageRoute || null,
                component_name: dep.componentName,
                component_type: dep.componentType, // Уже нормализован выше
                component_id: component.id,
                created_at: databasePool.fn.now(),
                updated_at: databasePool.fn.now(),
            });
        }
    }

    const newDependencies = Array.from(uniqueDepsMap.values());

    if (newDependencies.length > 0) {
        // PostgreSQL has a limit of ~32767 parameters per query
        // Each row has 6 parameters, so we limit to 500 rows per batch (500 * 6 = 3000 params, well under limit)
        const BATCH_SIZE = 500;
        const totalBatches = Math.ceil(newDependencies.length / BATCH_SIZE);

        for (let i = 0; i < newDependencies.length; i += BATCH_SIZE) {
            const batch = newDependencies.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

            await databasePool('page_component_dependencies')
                .insert(batch)
                .onConflict(['project_id', 'component_id', 'page_name', 'page_route'])
                .merge({
                    component_type: databasePool.raw('EXCLUDED.component_type'),
                    component_name: databasePool.raw('EXCLUDED.component_name'),
                    updated_at: databasePool.fn.now(),
                });

            if (totalBatches > 1) {
                logInfo(`Batch ${batchNumber}/${totalBatches}: inserted ${batch.length} page dependencies`);
            }
        }
        logInfo(`Сохранено ${newDependencies.length} связей Page -> компоненты для проекта ${projectId}`);
    }
}

export async function handleComponentMapping(req, res) {
    const { projectId, componentType, componentName, functionalBlock, pageDependencies, releaseVersion, releaseVersions, changeDate, isBugFix, issueKey, mrIid } = req.body;
    const componentId = req.params.componentId; // Для PATCH

    try {
        // Логируем входящие данные для отладки
        logInfo(`Входящий запрос: pageDependencies=${JSON.stringify(pageDependencies)}`);

        // Нормализуем pageDependencies перед валидацией (устанавливаем default для componentType)
        let normalizedPageDependencies = pageDependencies;
        if (normalizedPageDependencies && Array.isArray(normalizedPageDependencies)) {
            normalizedPageDependencies = normalizedPageDependencies.map((dep, index) => {
                // Обрабатываем все возможные случаи: отсутствует, null, undefined, '', невалидное значение
                let normalizedComponentType = dep.componentType;

                // Проверяем, что значение либо отсутствует, либо невалидно
                if (normalizedComponentType === undefined ||
                    normalizedComponentType === null ||
                    normalizedComponentType === '' ||
                    (typeof normalizedComponentType === 'string' && !['component', 'page'].includes(normalizedComponentType))) {
                    normalizedComponentType = 'component';
                }

                logInfo(`Нормализация pageDependencies[${index}]: было="${dep.componentType}" (тип: ${typeof dep.componentType}), стало="${normalizedComponentType}"`);

                return {
                    ...dep,
                    componentType: normalizedComponentType
                };
            });
        }

        logInfo(`После нормализации: pageDependencies=${JSON.stringify(normalizedPageDependencies)}`);

        // Нормализуем changeDate: преобразуем в ISO формат если нужно, или устанавливаем null
        let normalizedChangeDate = changeDate;
        if (normalizedChangeDate === '' || normalizedChangeDate === null || normalizedChangeDate === undefined) {
            normalizedChangeDate = null;
        } else if (typeof normalizedChangeDate === 'string' && normalizedChangeDate.trim() !== '') {
            // Пытаемся преобразовать различные форматы дат в ISO
            try {
                // Формат "2026-01-22 14:31:18 +0500" -> ISO
                const dateMatch = normalizedChangeDate.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/);
                if (dateMatch) {
                    const [, date, time, tz] = dateMatch;
                    // Преобразуем timezone offset из +0500 в +05:00
                    const tzFormatted = tz.slice(0, 3) + ':' + tz.slice(3);
                    normalizedChangeDate = `${date}T${time}${tzFormatted}`;
                } else {
                    // Пытаемся распарсить как есть (может быть уже ISO)
                    const parsedDate = new Date(normalizedChangeDate);
                    if (isNaN(parsedDate.getTime())) {
                        logWarn(`Не удалось распарсить дату: ${normalizedChangeDate}, устанавливаем null`);
                        normalizedChangeDate = null;
                    } else {
                        // Преобразуем в ISO строку
                        normalizedChangeDate = parsedDate.toISOString();
                    }
                }
            } catch (err) {
                logWarn(`Ошибка при нормализации даты ${normalizedChangeDate}: ${err.message}, устанавливаем null`);
                normalizedChangeDate = null;
            }
        }

        // Валидация входных данных
        const { error, value } = componentValidationSchema.validate({
            projectId,
            componentType,
            componentName,
            functionalBlock,
            pageDependencies: normalizedPageDependencies,
            releaseVersion,
            releaseVersions,
            changeDate: normalizedChangeDate,
            isBugFix,
            issueKey,
            mrIid
        }, {
            abortEarly: false, // Показывать все ошибки валидации
            stripUnknown: true, // Удалять неизвестные поля
            convert: true // Включаем автоматическое преобразование типов
        });

        if (error) {
            const errorMessages = error.details.map(d => d.message).join('; ');
            logError(`Ошибка валидации данных для маппинга компонента: ${errorMessages}`);
            logError(`Полученные данные (оригинал): pageDependencies=${JSON.stringify(pageDependencies)}`);
            logError(`Полученные данные (нормализованные): pageDependencies=${JSON.stringify(normalizedPageDependencies)}`);
            logError(`Детали ошибки: ${JSON.stringify(error.details, null, 2)}`);
            return res.status(400).json({ error: errorMessages });
        }

        // Используем нормализованные значения из валидации
        const validatedPageDependencies = value.pageDependencies;
        const validatedChangeDate = value.changeDate; // Может быть null или ISO строка
        const validatedIssueKey = value.issueKey;
        const validatedMrIid = value.mrIid;

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
        if (isBugFix === true && (normalizedReleaseVersions.length > 0 || validatedChangeDate || validatedIssueKey || validatedMrIid)) {
            try {
                const defectsToInsert = [];

                // Если есть версии, создаём запись для каждой версии
                if (normalizedReleaseVersions.length > 0) {
                    for (const version of normalizedReleaseVersions) {
                        defectsToInsert.push({
                            component_id: component.id,
                            release_version: version || null,
                            change_date: validatedChangeDate || null,
                            issue_key: validatedIssueKey || null,
                            mr_iid: validatedMrIid || null,
                            is_bug_fix: true
                        });
                    }
                } else if (validatedChangeDate) {
                    // Если версий нет, но есть дата, создаём одну запись
                    defectsToInsert.push({
                        component_id: component.id,
                        release_version: null,
                        change_date: validatedChangeDate || null,
                        issue_key: validatedIssueKey || null,
                        mr_iid: validatedMrIid || null,
                        is_bug_fix: true
                    });
                }

                if (defectsToInsert.length > 0) {
                    // Используем onConflict для дедупликации с новым индексом idx_component_defects_unique_v3
                    // Индекс включает: component_id, change_date, issue_key, mr_iid, release_version
                    await databasePool('component_defects')
                        .insert(defectsToInsert.map(r => ({
                            component_id: r.component_id,
                            release_version: r.release_version,
                            change_date: r.change_date,
                            issue_key: r.issue_key,
                            is_bug_fix: r.is_bug_fix,
                            mr_iid: r.mr_iid,
                            created_at: databasePool.fn.now()
                        })))
                        .onConflict(['component_id', 'change_date', 'issue_key', 'mr_iid', 'release_version'])
                        .ignore();
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
            if (validatedPageDependencies && validatedPageDependencies.length > 0) {
                await savePageComponentDependencies(projectId, validatedPageDependencies);

                // 5.5. Автоматический маппинг функциональных блоков из связанных Page
                // Если компонент связан с Page, которая уже имеет маппинг с функциональными блоками,
                // автоматически передаём эти блоки компоненту

                // Получаем уже созданные связи компонента (после шага 4)
                const existingBlockIds = new Set(
                    (await databasePool('component_functional_blocks')
                        .where({ component_id: component.id })
                        .select('functional_block_id'))
                        .map(fb => fb.functional_block_id)
                );

                const autoMappedBlocks = new Set();

                for (const pageDep of validatedPageDependencies) {
                    const pageName = pageDep.pageName;

                    const pageComponent = await databasePool('components')
                        .whereIn('component_type', ['page', 'frontend', 'component'])
                        .andWhere({
                            project_id: projectId,
                            component_name: pageName
                        })
                        .orderByRaw("CASE WHEN component_type = 'page' THEN 0 ELSE 1 END") // Приоритет 'page'
                        .first();

                    if (pageComponent) {
                        // Находим функциональные блоки через новую структуру
                        const pageFunctionalBlocks = await databasePool('component_functional_blocks')
                            .join('functional_blocks', 'component_functional_blocks.functional_block_id', 'functional_blocks.id')
                            .where({
                                'component_functional_blocks.component_id': pageComponent.id,
                                'functional_blocks.project_id': projectId
                            })
                            .select('functional_blocks.id', 'functional_blocks.allure_id');

                        for (const fb of pageFunctionalBlocks) {
                            if (!existingBlockIds.has(fb.id)) {
                                autoMappedBlocks.add(fb.id);
                            }
                        }
                    }

                    // Если не найдено в новой структуре, проверяем старую (component_mappings)
                    if (autoMappedBlocks.size === 0) {
                        const oldPageMappings = await databasePool('component_mappings')
                            .join('functional_blocks', 'component_mappings.functional_block_id', 'functional_blocks.id')
                            .whereIn('component_mappings.component_type', ['page', 'frontend', 'component'])
                            .andWhere({
                                'component_mappings.project_id': projectId,
                                'component_mappings.component_name': pageName,
                                'functional_blocks.project_id': projectId
                            })
                            .orderByRaw("CASE WHEN component_type = 'page' THEN 0 ELSE 1 END") // Приоритет 'page'
                            .select('functional_blocks.id', 'functional_blocks.allure_id');

                        for (const fb of oldPageMappings) {
                            if (!existingBlockIds.has(fb.id)) {
                                autoMappedBlocks.add(fb.id);
                            }
                        }
                    }
                }

                // Создаём автоматические связи для найденных функциональных блоков
                if (autoMappedBlocks.size > 0) {
                    const autoLinks = [];
                    for (const fbId of autoMappedBlocks) {
                        autoLinks.push({
                            component_id: component.id,
                            functional_block_id: fbId,
                            created_at: databasePool.fn.now(),
                        });
                    }

                    if (autoLinks.length > 0) {
                        await databasePool('component_functional_blocks')
                            .insert(autoLinks)
                            .onConflict(['component_id', 'functional_block_id'])
                            .ignore();
                        logInfo(`Автоматически создано ${autoLinks.length} связей компонент-функциональные блоки для компонента ${componentName} из связанных Page в проекте ${projectId}`);
                    }
                }
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
 * Получение маппингов функциональных блоков для Page по имени
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function getPageMappings(req, res) {
    const { projectId: queryProjectId, pageNames: queryPageNames } = req.query;
    const { projectId: bodyProjectId, pageNames: bodyPageNames } = req.body || {};

    const projectId = queryProjectId || bodyProjectId;
    const pageNames = queryPageNames || bodyPageNames;

    try {
        if (!projectId) {
            return res.status(400).json({ error: 'Необходимо указать projectId.' });
        }

        // pageNames может прийти как массив или как строка (если один элемент)
        // Express автоматически парсит повторяющиеся query параметры в массив
        let pageNamesArray = [];
        if (pageNames) {
            if (Array.isArray(pageNames)) {
                // Фильтруем только строки, убираем объекты
                pageNamesArray = pageNames.filter(name => name && typeof name === 'string' && name !== '[object Object]');
            } else if (typeof pageNames === 'string' && pageNames !== '[object Object]') {
                pageNamesArray = [pageNames];
            }
        }

        logInfo(`Получен запрос маппингов для Page: projectId=${projectId}, pageNames Count=${pageNamesArray.length}`);

        const pageMappings = {};

        // 1. Получаем все компоненты типа 'page' для заданных имен (новая структура)
        const pageComponents = await databasePool('components')
            .whereIn('component_name', pageNamesArray)
            .andWhere({
                project_id: projectId
            });

        const pageComponentIds = pageComponents.map(c => c.id);

        // Получаем все ID для каждого имени страницы (поддержка нескольких типов с одним именем)
        const nameToIdsMap = new Map();
        pageComponents.forEach(c => {
            if (!nameToIdsMap.has(c.component_name)) {
                nameToIdsMap.set(c.component_name, []);
            }
            nameToIdsMap.get(c.component_name).push(c.id);
        });

        // 2. Получаем все маппинги для этих компонентов (новая структура)
        let allNewMappings = [];
        if (pageComponentIds.length > 0) {
            allNewMappings = await databasePool('component_functional_blocks')
                .join('functional_blocks', 'component_functional_blocks.functional_block_id', 'functional_blocks.id')
                .whereIn('component_functional_blocks.component_id', pageComponentIds)
                .select(
                    'component_functional_blocks.component_id',
                    'functional_blocks.allure_id',
                    'functional_blocks.name as functional_block_name'
                );
        }

        // 3. Получаем все маппинги из старой структуры
        const allOldMappings = await databasePool('component_mappings')
            .join('functional_blocks', 'component_mappings.functional_block_id', 'functional_blocks.id')
            .whereIn('component_name', pageNamesArray)
            .andWhere({
                'component_mappings.project_id': projectId
            })
            .select(
                'component_mappings.component_name',
                'functional_blocks.allure_id',
                'functional_blocks.name as functional_block_name'
            );

        // 4. Группируем результаты
        for (const pageName of pageNamesArray) {
            const uniqueMappings = new Map();

            // Из новой структуры
            const compIds = nameToIdsMap.get(pageName) || [];
            if (compIds.length > 0) {
                allNewMappings
                    .filter(m => compIds.includes(m.component_id))
                    .forEach(m => {
                        uniqueMappings.set(m.allure_id, {
                            functional_block_allure_id: m.allure_id,
                            functional_block_name: m.functional_block_name
                        });
                    });
            }

            // Из старой структуры
            allOldMappings
                .filter(m => m.component_name === pageName)
                .forEach(m => {
                    const allureId = m.allure_id;
                    if (!uniqueMappings.has(allureId)) {
                        uniqueMappings.set(allureId, {
                            functional_block_allure_id: allureId,
                            functional_block_name: m.functional_block_name
                        });
                    }
                });

            pageMappings[pageName] = Array.from(uniqueMappings.values());
        }

        res.status(200).json({ pageMappings });
    } catch (error) {
        logError(`Ошибка при получении маппингов для Page в проекте ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении маппингов.', details: error.message });
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

        // Шаг 2: Получаем маппинги из старой структуры (для тех, кто еще не мигрировал)
        const oldMappings = await databasePool('component_mappings')
            .join('functional_blocks', 'component_mappings.functional_block_id', 'functional_blocks.id')
            .where({ 'component_mappings.project_id': projectId })
            .select(
                'component_mappings.project_id',
                'component_mappings.component_type',
                'component_mappings.component_name',
                'functional_blocks.id as functional_block_id',
                'functional_blocks.allure_id as functional_block_allure_id',
                'functional_blocks.name as functional_block_name',
                'functional_blocks.custom_field_name as functional_block_custom_field_name'
            );

        // Добавляем данные из старой структуры
        oldMappings.forEach(row => {

            const existingEntry = Array.from(componentMap.values()).find(c =>
                c.component_name === row.component_name
            );

            if (existingEntry) {
                // Добавляем блок, если его еще нет в списке функциональных блоков этого компонента
                const blockExists = existingEntry.functional_blocks.some(fb => fb.functional_block_id === row.functional_block_id);
                if (!blockExists) {
                    existingEntry.functional_blocks.push({
                        functional_block_id: row.functional_block_id,
                        functional_block_allure_id: row.functional_block_allure_id,
                        functional_block_name: row.functional_block_name,
                        functional_block_custom_field_name: row.functional_block_custom_field_name
                    });
                }
            } else {
                // Если компонента нет в новой таблице (например, удален из кода, но есть в базе), 
                // добавляем его целиком как "исторический"
                const key = `old_${row.component_name}_${row.component_type}`;
                componentMap.set(key, {
                    component_id: null,
                    project_id: row.project_id,
                    component_type: row.component_type,
                    component_name: row.component_name,
                    functional_blocks: [{
                        functional_block_id: row.functional_block_id,
                        functional_block_allure_id: row.functional_block_allure_id,
                        functional_block_name: row.functional_block_name,
                        functional_block_custom_field_name: row.functional_block_custom_field_name
                    }]
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