import { logInfo, logError } from '../utils/logger.js';
import databasePool from '../db/pool.js';
import Joi from 'joi';

/**
 * Схема валидации для запроса тепловой карты
 */
const heatmapValidationSchema = Joi.object({
    projectId: Joi.string().required().description('Идентификатор проекта'),
    startDate: Joi.string().isoDate().optional().allow(null, '').description('Начальная дата для фильтрации (ISO 8601)'),
    endDate: Joi.string().isoDate().optional().allow(null, '').description('Конечная дата для фильтрации (ISO 8601)'),
    releaseVersions: Joi.array().items(Joi.string()).optional().description('Массив версий релизов для фильтрации'),
    isBugFix: Joi.boolean().optional().description('Фильтр по типу: true - только баги, false - общий, undefined - все'),
});

/**
 * Получение данных для тепловой карты дефектов
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function getHeatmapData(req, res) {
    try {
        const { projectId, startDate, endDate, isBugFix } = req.query;

        // releaseVersions может прийти как массив или как строка
        let releaseVersions = req.query.releaseVersions;
        if (releaseVersions && !Array.isArray(releaseVersions)) {
            releaseVersions = [releaseVersions];
        }

        // Валидация входных данных
        const parsedReleaseVersions = releaseVersions && releaseVersions.length > 0 ? releaseVersions : undefined;
        const parsedIsBugFix = isBugFix !== undefined && isBugFix !== '' ? isBugFix === 'true' : undefined;

        const { error } = heatmapValidationSchema.validate({
            projectId,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            releaseVersions: parsedReleaseVersions,
            isBugFix: parsedIsBugFix,
        });

        if (error) {
            logError(`Ошибка валидации данных для тепловой карты: ${error.details[0].message}`);
            return res.status(400).json({ error: error.details[0].message });
        }

        logInfo(`Получение данных тепловой карты для проекта ${projectId}, isBugFix=${parsedIsBugFix}, releaseVersions=${parsedReleaseVersions?.join(',') || 'all'}`);

        // Строим запрос к БД через новую структуру
        // Считаем количество записей в component_defects (каждая запись = одна загрузка от CI/CD)
        let query = databasePool('component_defects')
            .join('components', 'component_defects.component_id', 'components.id')
            .where({ 'components.project_id': projectId })
            .select(
                'components.component_name',
                databasePool.raw('COUNT(component_defects.id) as defect_count')
            )
            .groupBy('components.component_name');

        // Фильтр по диапазону дат (мягкий фильтр - если указан только один конец диапазона, он все равно работает)
        if (startDate && endDate) {
            query = query.whereBetween('component_defects.change_date', [startDate, endDate]);
        } else if (startDate) {
            query = query.where('component_defects.change_date', '>=', startDate);
        } else if (endDate) {
            query = query.where('component_defects.change_date', '<=', endDate);
        }

        // Фильтр по версиям релиза
        if (parsedReleaseVersions && parsedReleaseVersions.length > 0) {
            query = query.whereIn('component_defects.release_version', parsedReleaseVersions);
        }

        // Фильтр по типу (баги или общий)
        if (parsedIsBugFix !== undefined) {
            query = query.where('component_defects.is_bug_fix', parsedIsBugFix);
        }

        const results = await query;

        // Группируем по компонентам и считаем количество уникальных загрузок
        // Каждая уникальная комбинация (release_version, change_date) = одна загрузка компонента в маппинг
        const componentMap = new Map();
        let totalDefects = 0;

        results.forEach(row => {
            const componentName = row.component_name;
            const count = parseInt(row.defect_count, 10);
            totalDefects += count;
            componentMap.set(componentName, count);
        });

        // Преобразуем в массив для ответа
        const heatmapData = Array.from(componentMap.entries())
            .map(([componentName, count]) => ({
                componentName,
                count,
                percentage: totalDefects > 0 ? ((count / totalDefects) * 100).toFixed(1) : '0.0',
            }))
            .sort((a, b) => b.count - a.count); // Сортируем по убыванию количества

        logInfo(`Получено ${heatmapData.length} компонентов для тепловой карты, всего уникальных загрузок: ${totalDefects}`);

        res.status(200).json({
            totalDefects,
            components: heatmapData,
            filters: {
                projectId,
                startDate: startDate || null,
                endDate: endDate || null,
                releaseVersions: parsedReleaseVersions || null,
                isBugFix: parsedIsBugFix !== undefined ? parsedIsBugFix : null,
            },
        });
    } catch (error) {
        logError(`Ошибка при получении данных тепловой карты:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении данных тепловой карты.', details: error.message });
    }
}

/**
 * Получение списка доступных версий релизов для проекта
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function getReleaseVersions(req, res) {
    try {
        const { projectId, startDate, endDate } = req.query;

        if (!projectId) {
            return res.status(400).json({ error: 'Необходимо указать projectId.' });
        }

        let query = databasePool('component_defects')
            .join('components', 'component_defects.component_id', 'components.id')
            .where({ 'components.project_id': projectId })
            .select('component_defects.release_version')
            .distinct()
            .whereNotNull('component_defects.release_version')
            .orderBy('component_defects.release_version', 'desc');

        // Фильтр по дате для ограничения списка версий
        if (startDate) {
            query = query.where('component_defects.change_date', '>=', startDate);
        }
        if (endDate) {
            query = query.where('component_defects.change_date', '<=', endDate);
        }

        const results = await query;
        const versions = results.map(row => row.release_version).filter(v => v);

        res.status(200).json({ versions });
    } catch (error) {
        logError(`Ошибка при получении списка версий:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении списка версий.', details: error.message });
    }
}

/**
 * Получение данных для тепловой карты Test Coverage (функциональные блоки)
 * Считает сумму дефектов всех компонентов, связанных с каждым функциональным блоком
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function getTestCoverageData(req, res) {
    try {
        const { projectId, startDate, endDate, isBugFix } = req.query;

        // releaseVersions может прийти как массив или как строка
        let releaseVersions = req.query.releaseVersions;
        if (releaseVersions && !Array.isArray(releaseVersions)) {
            releaseVersions = [releaseVersions];
        }

        // Валидация входных данных
        const parsedReleaseVersions = releaseVersions && releaseVersions.length > 0 ? releaseVersions : undefined;
        const parsedIsBugFix = isBugFix !== undefined && isBugFix !== '' ? isBugFix === 'true' : undefined;

        const { error } = heatmapValidationSchema.validate({
            projectId,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            releaseVersions: parsedReleaseVersions,
            isBugFix: parsedIsBugFix,
        });

        if (error) {
            logError(`Ошибка валидации данных для Test Coverage: ${error.details[0].message}`);
            return res.status(400).json({ error: error.details[0].message });
        }

        logInfo(`Получение данных Test Coverage для проекта ${projectId}, isBugFix=${parsedIsBugFix}, releaseVersions=${parsedReleaseVersions?.join(',') || 'all'}`);

        // Строим запрос: для каждого функционального блока суммируем дефекты всех связанных компонентов
        let query = databasePool('functional_blocks as fb')
            .join('component_functional_blocks as cfb', 'fb.id', 'cfb.functional_block_id')
            .join('components as c', 'cfb.component_id', 'c.id')
            .leftJoin('component_defects as cd', 'cd.component_id', 'c.id')
            .where({ 'fb.project_id': projectId });

        // Применяем фильтры к дефектам
        if (startDate && endDate) {
            query = query.whereBetween('cd.change_date', [startDate, endDate]);
        } else if (startDate) {
            query = query.where('cd.change_date', '>=', startDate);
        } else if (endDate) {
            query = query.where('cd.change_date', '<=', endDate);
        }

        if (parsedReleaseVersions && parsedReleaseVersions.length > 0) {
            query = query.whereIn('cd.release_version', parsedReleaseVersions);
        }

        query = query
            .select(
                'fb.id as functional_block_id',
                'fb.allure_id as functional_block_allure_id',
                'fb.name as functional_block_name',
                'fb.custom_field_name as functional_block_custom_field_name',
                databasePool.raw('COUNT(DISTINCT cd.id) as total_defects')
            )
            .groupBy('fb.id', 'fb.allure_id', 'fb.name', 'fb.custom_field_name')
            .having(databasePool.raw('COUNT(DISTINCT cd.id)'), '>', 0)
        if (parsedIsBugFix !== undefined) {
            query = query.where('cd.is_bug_fix', parsedIsBugFix);
        }

        const results = await query;

        // Считаем общее количество дефектов
        let totalDefects = 0;
        const functionalBlocksMap = new Map();

        results.forEach(row => {
            const defectCount = parseInt(row.total_defects, 10);
            totalDefects += defectCount;

            functionalBlocksMap.set(row.functional_block_id, {
                functionalBlockId: row.functional_block_id,
                functionalBlockAllureId: row.functional_block_allure_id,
                functionalBlockName: row.functional_block_name,
                functionalBlockCustomFieldName: row.functional_block_custom_field_name,
                defectCount: defectCount,
            });
        });

        // Преобразуем в массив с процентами
        const functionalBlocksData = Array.from(functionalBlocksMap.values())
            .map(fb => ({
                ...fb,
                percentage: totalDefects > 0 ? ((fb.defectCount / totalDefects) * 100).toFixed(1) : '0.0',
            }))
            .sort((a, b) => b.defectCount - a.defectCount);

        // Теперь получаем данные по роутам
        let routesQuery = databasePool('page_component_dependencies as pcd')
            .join('components as c', 'pcd.component_id', 'c.id')
            .leftJoin('component_defects as cd', 'cd.component_id', 'c.id')
            .where({ 'pcd.project_id': projectId })
            .whereNotNull('pcd.page_route')
            .where('pcd.page_route', '!=', '');

        // Применяем фильтры к дефектам
        if (startDate && endDate) {
            routesQuery = routesQuery.whereBetween('cd.change_date', [startDate, endDate]);
        } else if (startDate) {
            routesQuery = routesQuery.where('cd.change_date', '>=', startDate);
        } else if (endDate) {
            routesQuery = routesQuery.where('cd.change_date', '<=', endDate);
        }

        if (parsedReleaseVersions && parsedReleaseVersions.length > 0) {
            routesQuery = routesQuery.whereIn('cd.release_version', parsedReleaseVersions);
        }

        if (parsedIsBugFix !== undefined) {
            routesQuery = routesQuery.where('cd.is_bug_fix', parsedIsBugFix);
        }

        routesQuery = routesQuery
            .select(
                'pcd.page_route',
                databasePool.raw('COUNT(DISTINCT cd.id) as total_defects')
            )
            .groupBy('pcd.page_route')
            .having(databasePool.raw('COUNT(DISTINCT cd.id)'), '>', 0)
            .orderBy('total_defects', 'desc');

        const routesResults = await routesQuery;

        // Считаем общее количество дефектов по роутам
        let totalRoutesDefects = 0;
        const routesMap = new Map();

        routesResults.forEach(row => {
            const defectCount = parseInt(row.total_defects, 10);
            totalRoutesDefects += defectCount;

            routesMap.set(row.page_route, {
                route: row.page_route,
                defectCount: defectCount,
            });
        });

        // Преобразуем в массив с процентами
        const routesData = Array.from(routesMap.values())
            .map(route => ({
                ...route,
                percentage: totalRoutesDefects > 0 ? ((route.defectCount / totalRoutesDefects) * 100).toFixed(1) : '0.0',
            }))
            .sort((a, b) => b.defectCount - a.defectCount);

        logInfo(`Получено ${functionalBlocksData.length} функциональных блоков и ${routesData.length} роутов для Test Coverage, всего дефектов: ${totalDefects}`);

        res.status(200).json({
            totalDefects,
            functionalBlocks: functionalBlocksData,
            routes: routesData,
            totalRoutesDefects,
            filters: {
                projectId,
                startDate: startDate || null,
                endDate: endDate || null,
                releaseVersions: parsedReleaseVersions || null,
                isBugFix: parsedIsBugFix !== undefined ? parsedIsBugFix : null,
            },
        });
    } catch (error) {
        logError(`Ошибка при получении данных Test Coverage:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при получении данных Test Coverage.', details: error.message });
    }
}

/**
 * Массовый импорт истории дефектов из JSON-отчетов TIA
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function bulkImportHistory(req, res) {
    const { projectId, items, mappings } = req.body;

    if (!projectId || !items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Необходимо указать projectId и массив items.' });
    }

    try {
        logInfo(`Начало массового импорта истории для проекта ${projectId}. Количество записей: ${items.length}`);

        await databasePool.transaction(async (trx) => {
            // 1. Собираем все уникальные компоненты из всех записей
            const allComponentNames = new Set();
            items.forEach(item => {
                if (item.affected_components && Array.isArray(item.affected_components)) {
                    item.affected_components.forEach(name => allComponentNames.add(name));
                }
            });

            // 2. Гарантируем, что все компоненты созданы в таблице components
            for (const name of allComponentNames) {
                await trx('components')
                    .insert({
                        project_id: projectId,
                        component_name: name,
                        component_type: 'component', // По умолчанию.
                    })
                    .onConflict(['project_id', 'component_type', 'component_name'])
                    .ignore();
            }

            // 3. Получаем ID всех компонентов проекта
            const components = await trx('components')
                .where({ project_id: projectId })
                .select('id', 'component_name');

            const nameToIdMap = new Map(components.map(c => [c.component_name, c.id]));

            // 4. Обновляем маппинги функциональных блоков (если переданы)
            if (mappings && typeof mappings === 'object') {
                for (const [compName, fbIds] of Object.entries(mappings)) {
                    const compId = nameToIdMap.get(compName);
                    if (compId && Array.isArray(fbIds)) {
                        // Удаляем старые маппинги этого компонента перед вставкой новых
                        await trx('component_functional_blocks')
                            .where({ component_id: compId })
                            .del();

                        if (fbIds.length > 0) {
                            const mappingInserts = fbIds.map(fbId => ({
                                component_id: compId,
                                functional_block_id: fbId
                            }));
                            await trx('component_functional_blocks').insert(mappingInserts);
                        }
                    }
                }
            }

            // 5. Вставляем историю дефектов
            const defectInserts = [];
            items.forEach(item => {
                if (item.affected_components && Array.isArray(item.affected_components)) {
                    item.affected_components.forEach(compName => {
                        const compId = nameToIdMap.get(compName);
                        if (compId) {
                            defectInserts.push({
                                component_id: compId,
                                release_version: item.release_version || null,
                                change_date: item.change_date || null,
                                issue_key: item.issue_key || null,
                                is_bug_fix: item.is_bug_fix !== undefined ? item.is_bug_fix : true,
                                mr_iid: item.mr_iid || null,
                                mr_title: item.mr_title || null,
                                source_branch: item.source_branch || null,
                                target_branch: item.target_branch || null,
                                merged_at: item.merged_at || null,
                                web_url: item.web_url || null
                            });
                        }
                    });
                }
            });

            if (defectInserts.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < defectInserts.length; i += chunkSize) {
                    const chunk = defectInserts.slice(i, i + chunkSize);
                    await trx('component_defects')
                        .insert(chunk)
                        .onConflict(['component_id', 'mr_iid', 'change_date', 'release_version'])
                        .ignore();
                }
            }
        });

        logInfo(`Массовый импорт успешно завершен для проекта ${projectId}`);
        res.status(200).json({ message: 'Импорт успешно завершен.' });
    } catch (error) {
        logError(`Ошибка при массовом импорте истории для проекта ${projectId}:`, error.message);
        res.status(500).json({ error: 'Произошла ошибка при импорте.', details: error.message });
    }
}

