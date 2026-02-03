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
    componentType: Joi.string().valid('frontend', 'backend', 'component', 'service', 'page').optional().description('Тип компонента (сторона системы)')
});

/**
 * Получение данных для тепловой карты дефектов
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function getHeatmapData(req, res) {
    try {
        const { projectId, startDate, endDate, isBugFix, componentType } = req.query;

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
            componentType: componentType || undefined
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
                databasePool.raw('COUNT(component_defects.id) as defect_count'),
                databasePool.raw('ARRAY_AGG(DISTINCT component_defects.issue_key) FILTER (WHERE component_defects.issue_key IS NOT NULL) as issue_keys')
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
            query = query.where(builder => {
                // Если есть "Без версии", добавляем условие OR release_version IS NULL
                if (parsedReleaseVersions.includes('Без версии')) {
                    builder.whereNull('component_defects.release_version');

                    // Если есть другие версии кроме "Без версии"
                    const concreteVersions = parsedReleaseVersions.filter(v => v !== 'Без версии');
                    if (concreteVersions.length > 0) {
                        builder.orWhereIn('component_defects.release_version', concreteVersions);
                    }
                } else {
                    // Стандартная фильтрация
                    builder.whereIn('component_defects.release_version', parsedReleaseVersions);
                }
            });
        }

        // Фильтр по типу (баги или общий)
        if (parsedIsBugFix !== undefined) {
            query = query.where('component_defects.is_bug_fix', parsedIsBugFix);
        }

        // Фильтр по типу компонента (Front/Back)
        if (componentType) {
            query = query.where('components.component_type', componentType);
        }

        const results = await query;

        // --- PAGE STATS ---
        // Total unique pages for this project
        const totalPagesResult = await databasePool('page_component_dependencies as pcd')
            .join('components as c', 'pcd.component_id', 'c.id')
            .where({ 'c.project_id': projectId })
            .distinct('pcd.page_name');

        const totalProjectPagesCount = totalPagesResult.length;

        // Affected pages (with filters)
        let affectedPagesQuery = databasePool('component_defects as cd')
            .join('components as c', 'cd.component_id', 'c.id')
            .join('page_component_dependencies as pcd', 'pcd.component_id', 'c.id')
            .where({ 'c.project_id': projectId })
            .distinct('pcd.page_name');

        // Apply same filters as for component defects
        if (startDate && endDate) {
            affectedPagesQuery = affectedPagesQuery.whereBetween('cd.change_date', [startDate, endDate]);
        } else if (startDate) {
            affectedPagesQuery = affectedPagesQuery.where('cd.change_date', '>=', startDate);
        } else if (endDate) {
            affectedPagesQuery = affectedPagesQuery.where('cd.change_date', '<=', endDate);
        }

        if (parsedReleaseVersions && parsedReleaseVersions.length > 0) {
            affectedPagesQuery = affectedPagesQuery.whereIn('cd.release_version', parsedReleaseVersions);
        }

        if (parsedIsBugFix !== undefined) {
            affectedPagesQuery = affectedPagesQuery.where('cd.is_bug_fix', parsedIsBugFix);
        }

        if (componentType) {
            affectedPagesQuery = affectedPagesQuery.where('c.component_type', componentType);
        }

        const affectedPagesResult = await affectedPagesQuery;
        const affectedPagesCount = affectedPagesResult.length;

        // Группируем по компонентам и считаем количество уникальных загрузок
        // Каждая уникальная комбинация (release_version, change_date) = одна загрузка компонента в маппинг
        const componentMap = new Map();
        let totalDefects = 0;

        results.forEach(row => {
            const componentName = row.component_name;
            const count = parseInt(row.defect_count, 10);
            totalDefects += count;
            componentMap.set(componentName, {
                count,
                issueKeys: row.issue_keys || []
            });
        });

        // Преобразуем в массив для ответа
        const heatmapData = Array.from(componentMap.entries())
            .map(([componentName, data]) => ({
                componentName,
                count: data.count,
                issueKeys: data.issueKeys,
                percentage: totalDefects > 0 ? ((data.count / totalDefects) * 100).toFixed(1) : '0.0',
            }))
            .sort((a, b) => b.count - a.count); // Сортируем по убыванию количества

        logInfo(`Получено ${heatmapData.length} компонентов для тепловой карты, всего уникальных загрузок: ${totalDefects}. Pages: ${affectedPagesCount}/${totalProjectPagesCount}`);

        res.status(200).json({
            totalDefects,
            components: heatmapData,
            pageStats: {
                totalProjectPages: totalProjectPagesCount,
                affectedPages: affectedPagesCount,
                coveragePercent: totalProjectPagesCount > 0 ? ((affectedPagesCount / totalProjectPagesCount) * 100).toFixed(1) : '0.0'
            },
            filters: {
                projectId,
                startDate: startDate || null,
                endDate: endDate || null,
                releaseVersions: parsedReleaseVersions || null,
                isBugFix: parsedIsBugFix !== undefined ? parsedIsBugFix : null,
                componentType: componentType || null
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

        // Получаем версии, включая NULL (для которых нет версии)
        let query = databasePool('component_defects')
            .join('components', 'component_defects.component_id', 'components.id')
            .where({ 'components.project_id': projectId })
            .distinct('component_defects.release_version')
            .orderBy('component_defects.release_version', 'desc');

        // Фильтр по дате для ограничения списка версий
        if (startDate) {
            query = query.where('component_defects.change_date', '>=', startDate);
        }
        if (endDate) {
            query = query.where('component_defects.change_date', '<=', endDate);
        }

        const results = await query;

        // Преобразуем результаты: null -> 'Без версии'
        const versions = results.map(row => row.release_version || 'Без версии');

        // Убираем дубликаты, если 'Без версии' встретилось несколько раз (хотя distinct должен сработать, но null и '' могут быть разными)
        const uniqueVersions = [...new Set(versions)];

        res.status(200).json({ versions: uniqueVersions });
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
        const { projectId, startDate, endDate, isBugFix, componentType } = req.query;

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
            componentType: componentType || undefined
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

        if (componentType) {
            query = query.where('c.component_type', componentType);
        }

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
                databasePool.raw('COUNT(DISTINCT cd.id) as total_defects'),
                databasePool.raw('ARRAY_AGG(DISTINCT cd.issue_key) FILTER (WHERE cd.issue_key IS NOT NULL) as issue_keys')
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
                issueKeys: row.issue_keys || []
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
        // ВАЖНО: Каждый дефект должен быть посчитан только ОДИН РАЗ глобально,
        // а не для каждого роута, с которым связан компонент.
        // Для этого сначала получаем уникальные дефекты и назначаем каждому "основной" роут.

        // Сначала получаем все уникальные дефекты и их роуты
        let defectRouteQuery = databasePool('component_defects as cd')
            .join('components as c', 'cd.component_id', 'c.id')
            .join('page_component_dependencies as pcd', 'pcd.component_id', 'c.id')
            .where({ 'c.project_id': projectId })
            .whereNotNull('pcd.page_route')
            .where('pcd.page_route', '!=', '');

        // Применяем фильтры к дефектам
        if (startDate && endDate) {
            defectRouteQuery = defectRouteQuery.whereBetween('cd.change_date', [startDate, endDate]);
        } else if (startDate) {
            defectRouteQuery = defectRouteQuery.where('cd.change_date', '>=', startDate);
        } else if (endDate) {
            defectRouteQuery = defectRouteQuery.where('cd.change_date', '<=', endDate);
        }

        if (parsedReleaseVersions && parsedReleaseVersions.length > 0) {
            defectRouteQuery = defectRouteQuery.whereIn('cd.release_version', parsedReleaseVersions);
        }

        if (parsedIsBugFix !== undefined) {
            defectRouteQuery = defectRouteQuery.where('cd.is_bug_fix', parsedIsBugFix);
        }

        if (componentType) {
            defectRouteQuery = defectRouteQuery.where('c.component_type', componentType);
        }

        // Получаем для каждого дефекта первый (алфавитно) роут - так каждый дефект будет посчитан только один раз
        const defectToRouteSubquery = defectRouteQuery
            .select('cd.id as defect_id', databasePool.raw('MIN(pcd.page_route) as primary_route'))
            .groupBy('cd.id');

        // Теперь группируем по роутам и считаем
        const routesResults = await databasePool
            .from(defectToRouteSubquery.as('defect_routes'))
            .select('primary_route as page_route')
            .count('defect_id as total_defects')
            .groupBy('primary_route')
            .orderBy('total_defects', 'desc');

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


        // --- СТАТИСТИКА ПО СТРАНИЦАМ (PAGES) ---
        // Аналогично роутам, но группируем по page_name

        // 1. Строим базовый запрос для дефектов, связанных со страницами
        let defectPageQuery = databasePool('component_defects as cd')
            .join('components as c', 'cd.component_id', 'c.id')
            .join('page_component_dependencies as pcd', 'pcd.component_id', 'c.id')
            .where({ 'c.project_id': projectId })
            .whereNotNull('pcd.page_name')
            .where('pcd.page_name', '!=', '');

        // 2. Применяем те же фильтры
        if (startDate && endDate) {
            defectPageQuery = defectPageQuery.whereBetween('cd.change_date', [startDate, endDate]);
        } else if (startDate) {
            defectPageQuery = defectPageQuery.where('cd.change_date', '>=', startDate);
        } else if (endDate) {
            defectPageQuery = defectPageQuery.where('cd.change_date', '<=', endDate);
        }

        if (parsedReleaseVersions && parsedReleaseVersions.length > 0) {
            defectPageQuery = defectPageQuery.whereIn('cd.release_version', parsedReleaseVersions);
        }

        if (parsedIsBugFix !== undefined) {
            defectPageQuery = defectPageQuery.where('cd.is_bug_fix', parsedIsBugFix);
        }

        if (componentType) {
            defectPageQuery = defectPageQuery.where('c.component_type', componentType);
        }

        // 3. Для каждого дефекта берем первую страницу (чтобы не дублировать дефект, если компонент на 2 страницах)
        // ИЛИ можно считать "вхождений" дефектов (как в функциональных блоках).
        // В функциональных блоках: "Считает сумму дефектов всех компонентов, связанных с каждым функциональным блоком" - там дублирование разрешено (Logic + UI).
        // Если хотим "Test Coverage" pie chart, то сумма должна быть 100%. Значит дефект должен принадлежать ОДНОЙ категории.
        // Для роутов мы делали MIN(page_route). Сделаем так же для страниц, чтобы сумма сходилась.

        const pagesResults = await defectPageQuery
            .select(
                'pcd.page_name as page_name',
                'pcd.page_route as page_route',
                databasePool.raw('ARRAY_AGG(DISTINCT cd.issue_key) FILTER (WHERE cd.issue_key IS NOT NULL) as issue_keys')
            )
            .count('cd.id as total_defects')
            .groupBy('pcd.page_name', 'pcd.page_route')
            .orderBy('total_defects', 'desc');

        // Считаем общее количество дефектов по страницам
        let totalPagesDefects = 0;
        const pagesMap = new Map();

        pagesResults.forEach(row => {
            const defectCount = parseInt(row.total_defects, 10);
            totalPagesDefects += defectCount;

            pagesMap.set(row.page_name, {
                pageName: row.page_name,
                pageRoute: row.page_route,
                defectCount: defectCount,
                issueKeys: row.issue_keys || []
            });
        });

        const pagesData = Array.from(pagesMap.values())
            .map(page => ({
                ...page,
                percentage: totalPagesDefects > 0 ? ((page.defectCount / totalPagesDefects) * 100).toFixed(1) : '0.0',
            }))
            .sort((a, b) => b.defectCount - a.defectCount);


        logInfo(`Получено ${functionalBlocksData.length} функц. блоков, ${routesData.length} роутов и ${pagesData.length} страниц. Всего дефектов: ${totalDefects}`);

        res.status(200).json({
            totalDefects,
            functionalBlocks: functionalBlocksData,
            routes: routesData,
            pages: pagesData, // New data
            totalRoutesDefects,
            totalPagesDefects, // New metric
            filters: {
                projectId,
                startDate: startDate || null,
                endDate: endDate || null,
                releaseVersions: parsedReleaseVersions || null,
                isBugFix: parsedIsBugFix !== undefined ? parsedIsBugFix : null,
                componentType: componentType || null
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
            const componentTypeMap = new Map(); // compName -> type

            items.forEach(item => {
                if (item.affected_components && Array.isArray(item.affected_components)) {
                    item.affected_components.forEach(comp => {
                        if (typeof comp === 'string') {
                            allComponentNames.add(comp);
                            if (!componentTypeMap.has(comp)) componentTypeMap.set(comp, 'frontend');
                        } else if (comp && typeof comp === 'object') {
                            allComponentNames.add(comp.name);
                            componentTypeMap.set(comp.name, comp.type || 'frontend');
                        }
                    });
                }
            });

            // 2. Гарантируем, что все компоненты созданы в таблице components
            for (const name of allComponentNames) {
                const type = componentTypeMap.get(name) || 'frontend';
                await trx('components')
                    .insert({
                        project_id: projectId,
                        component_name: name,
                        component_type: type,
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
                        // Фильтруем null/undefined значения
                        const validFbIds = fbIds.filter(fbId => fbId != null && fbId !== '');

                        // Удаляем старые маппинги этого компонента перед вставкой новых
                        await trx('component_functional_blocks')
                            .where({ component_id: compId })
                            .del();

                        if (validFbIds.length > 0) {
                            const mappingInserts = validFbIds.map(fbId => ({
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
                    // Используем onConflict для дедупликации - индекс idx_component_defects_unique_v3
                    // включает: component_id, change_date, issue_key, mr_iid, release_version
                    await trx('component_defects')
                        .insert(chunk)
                        .onConflict(['component_id', 'change_date', 'issue_key', 'mr_iid', 'release_version'])
                        .ignore();
                }
            }

            // 6. Обрабатываем зависимости страниц (Page Dependencies) из items
            // Если в item есть pages с depends_on_components, сохраняем их
            const pageDepInserts = [];
            items.forEach(item => {
                if (item.pages && Array.isArray(item.pages)) {
                    item.pages.forEach(page => {
                        const pageName = page.page_meta?.name;
                        const pageRoute = page.page_meta?.route || '';

                        if (pageName && page.depends_on_components && Array.isArray(page.depends_on_components)) {
                            page.depends_on_components.forEach(compName => {
                                const compId = nameToIdMap.get(compName);
                                if (compId) {
                                    // Проверяем, не добавляли ли мы уже такую зависимость в этом батче
                                    const exists = pageDepInserts.some(p =>
                                        p.component_id === compId && p.page_name === pageName && p.page_route === pageRoute
                                    );

                                    if (!exists) {
                                        const compType = componentTypeMap.get(compName) || 'frontend';
                                        pageDepInserts.push({
                                            project_id: projectId,
                                            component_id: compId,
                                            component_name: compName,
                                            component_type: compType,
                                            page_name: pageName,
                                            page_route: pageRoute
                                        });
                                    }
                                }
                            });
                        }
                    });
                }
            });

            if (pageDepInserts.length > 0) {
                // Вставляем зависимости страниц, игнорируя дубликаты
                // Предполагаем, что есть уникальный индекс или ограничение (обычно component_id + page_name)
                // Если уникального индекса нет, то может быть дублирование. 
                // Но лучше попробовать insert.
                const pdChunkSize = 500;
                for (let i = 0; i < pageDepInserts.length; i += pdChunkSize) {
                    const chunk = pageDepInserts.slice(i, i + pdChunkSize);

                    // Используем onConflict. Теперь используем idx_page_deps_unique_v2
                    // которое включает: project_id, component_id, page_name, page_route
                    await trx('page_component_dependencies')
                        .insert(chunk)
                        .onConflict(['project_id', 'component_id', 'page_name', 'page_route'])
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

