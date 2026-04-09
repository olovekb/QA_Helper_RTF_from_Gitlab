import { fetchWithAuth, authHeaders, buildTestCaseTreeEntityUrl, getTestCaseTreeEntityContent } from '../utils/allureAuth.js';
import config from '../config/index.js';
import { logInfo, logError, logWarn } from '../utils/logger.js';
import databasePool from '../db/pool.js';
import pLimit from 'p-limit';

const nocodeProjectIds = ['1', '307', '377'];
const allureLimit = pLimit(5);
const cache = new Map();
let currentProjectId = null;

/**
 * Получает иерархическую структуру проекта (только папки) из Allure API, включая все уровни вложенности,
 * с оптимизацией для скорости и сохранением всех функциональных блоков (Feature, Story, Scenario и т.д.) в БД
 * @param {string} projectId - Идентификатор проекта в Allure
 * @param {Object} [skipCriteria] - Критерии для пропуска узлов (например, { customFieldIdsToSkip: [], namePatternsToSkip: [] })
 * @returns {Promise<Object>} - Структура проекта с папками, содержащими name, customFieldId, их названия и вложенные дети
 * @throws {Error} - Если запрос не удался
 */
export async function getProjectStructure(projectId, skipCriteria = { customFieldIdsToSkip: [], namePatternsToSkip: [] }) {
    try {
        logInfo(`Запрашиваем иерархическую структуру папок проекта с ID ${projectId} из Allure API`);

        if (currentProjectId !== projectId) {
            cache.clear();
            logInfo(`Кэш очищен, так как projectId изменился с ${currentProjectId} на ${projectId}`);
            currentProjectId = projectId;
        }

        const treeCacheKey = `tree_${projectId}`;
        let treeId = cache.get(treeCacheKey);

        if (!treeId) {
            const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;

            logInfo(`Получаем treeId для проекта ${projectId} (без кэша)`);
            const treeResponse = await allureLimit(() => fetchWithAuth(treeUrl, {
                headers: {
                    ...authHeaders,
                    'Content-Type': 'application/json',
                },
            }));

            if (!treeResponse.ok) {
                const errorMessage = await treeResponse.text();
                logError(`Ошибка получения treeId для проекта ${projectId}: ${treeResponse.statusText}`, errorMessage); // Логирование ошибки
                throw new Error(`Не удалось получить treeId: ${treeResponse.statusText} - ${errorMessage}`);
            }

            const treeData = await treeResponse.json();
            logInfo(`Получен ответ от /api/tree для projectId ${projectId}`);


            let structureTree = null;
            if (nocodeProjectIds.includes(String(projectId))) {
                structureTree = treeData.content?.find(item => item.name === "Global Structure");
                if (!structureTree) {
                    structureTree = treeData.content?.find(item => item.name === "Structure");
                }
            } else {
                structureTree = treeData.content?.find(item => item.name === "Structure");
            }

            if (structureTree && structureTree.id) {
                treeId = structureTree.id;
                logInfo(`Найден treeId ${treeId} для проекта ${projectId} с name: "${structureTree.name}"`);
            } else {
                const searchName = nocodeProjectIds.includes(String(projectId)) ? '"Global Structure" или "Structure"' : '"Structure"';
                logWarn(`treeId с name: ${searchName} не найден в ответе для проекта ${projectId}, используем значение по умолчанию (0)`);
                treeId = 0;
            }

            if (!treeId) {
                const searchName = nocodeProjectIds.includes(String(projectId)) ? '"Global Structure" или "Structure"' : '"Structure"';
                throw new Error(`treeId не найден для проекта ${projectId} с name: ${searchName}`);
            }

            cache.set(treeCacheKey, treeId);
            logInfo(`Найден и закэширован treeId ${treeId} для проекта ${projectId}`);
        } else {
            logInfo(`Используем закэшированный treeId ${treeId} для проекта ${projectId}`);
        }

        const treeDetailCacheKey = `treeDetail_${treeId}`;
        let customFields = cache.get(treeDetailCacheKey);

        if (!customFields) {
            const treeDetailUrl = `${config.allureBaseUrl}/api/tree/${treeId}`;

            logInfo(`Получаем детали дерева с treeId ${treeId} для проекта ${projectId} (без кэша)`);
            const treeDetailResponse = await allureLimit(() => fetchWithAuth(treeDetailUrl, {
                headers: {
                    ...authHeaders,
                    'Content-Type': 'application/json',
                },
            }));

            if (!treeDetailResponse.ok) {
                const errorMessage = await treeDetailResponse.text();
                logError(`Ошибка получения деталей дерева для treeId ${treeId}: ${treeDetailResponse.statusText}`, errorMessage); // Логирование ошибки
                throw new Error(`Не удалось получить детали дерева: ${treeDetailResponse.statusText} - ${errorMessage}`);
            }

            const treeDetailData = await treeDetailResponse.json();
            customFields = treeDetailData.fields || [];
            cache.set(treeDetailCacheKey, customFields);
            logInfo(`Успешно получены custom fields для treeId ${treeId}: ${customFields.length} полей`);
        } else {
            logInfo(`Используем закэшированные custom fields для treeId ${treeId}: ${customFields.length} полей`);
        }
        const initialUrl = buildTestCaseTreeEntityUrl(config.allureBaseUrl, {
            projectId,
            treeId,
            page: 0,
            size: 100,
            pathPrefix: [],
            deleted: 'false',
        });

        logInfo(`Запрашиваем корневую структуру для projectId ${projectId}, treeId ${treeId}`);
        const initialStructureResponse = await allureLimit(() => fetchWithAuth(initialUrl, {
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
            },
        }));

        if (!initialStructureResponse.ok) {
            const errorMessage = await initialStructureResponse.text();
            logError(`Ошибка получения структуры проекта ${projectId} для treeId ${treeId}: ${initialStructureResponse.statusText}`, errorMessage);
            throw new Error(`Не удалось получить структуру проекта: ${initialStructureResponse.statusText} - ${errorMessage}`);
        }

        const initialData = await initialStructureResponse.json();
        logInfo(`Получен ответ от testcasetree/entity (корень) projectId ${projectId}`);

        const rootContent = getTestCaseTreeEntityContent(initialData);
        const hasEntityPageArray =
            Array.isArray(initialData.children?.content) || Array.isArray(initialData.content);
        if (!hasEntityPageArray) {
            logWarn(`Структура ответа для projectId ${projectId} без children.content/content-массива`);
            throw new Error('Некорректная структура ответа от Allure API');
        }


        if (nocodeProjectIds.includes(String(projectId))) {
            const customFieldsMap = new Map();
            customFields.forEach(field => {
                customFieldsMap.set(field.id, field.name);
            });
            logInfo(`[projectId=${projectId}] Доступные customFields (${customFields.length}):`);
            customFields.forEach(field => {
                logInfo(`[projectId=${projectId}] customField: id=${field.id}, name="${field.name}"`);
            });
            logInfo(`[projectId=${projectId}] Корневые узлы (${rootContent.length}):`);
            rootContent.forEach((node, idx) => {
                const customFieldName = customFieldsMap.get(node.customFieldId);
                logInfo(`[projectId=${projectId}] Корневой узел ${idx}: id=${node.id}, name="${node.name}", customFieldId=${node.customFieldId}, customFieldName="${customFieldName}", type=${node.type}`);
            });
        }

        const rootFolders = await getNestedFoldersParallel(projectId, [], treeId, customFields, skipCriteria, null);

        logInfo(`Успешно получена структура проекта ${projectId} с treeId ${treeId}`);

        return {
            projectId,
            folders: rootFolders,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Неизвестная ошибка');
        const errorStack = error instanceof Error ? error.stack : '';
        logError(`Ошибка обработки запроса структуры проекта ${projectId}:`, errorMessage);
        if (errorStack) {
            logError(`Стек ошибки для проекта ${projectId}:`, errorStack);
        }
        throw error instanceof Error ? error : new Error(errorMessage);
    }
}

/**
 * Сохраняет функциональные блоки (папки) в базу данных, включая вложенные уровни
 * @param {string} projectId - Идентификатор проекта в Allure
 * @param {Array} nodes - Узлы дерева из ответа Allure API
 * @param {string|null} parentId - ID родительского функционального блока (null для корня, UUID)
 * @param {Array} customFields - Список пользовательских полей с id и названиями
 */
async function saveFunctionalBlocks(projectId, nodes, parentId, customFields) {
    const customFieldsMap = new Map();
    customFields.forEach(field => {
        customFieldsMap.set(field.id, field.name);
    });

    const blocksToUpsert = [];
    for (const node of nodes) {
        if (node.type === 'GROUP') {
            blocksToUpsert.push({
                allure_id: node.id.toString(),
                project_id: projectId,
                name: node.name,
                custom_field_id: node.customFieldId || null,
                custom_field_name: customFieldsMap.get(node.customFieldId) || 'Неизвестное поле',
                parent_id: parentId,
                count: node.children?.content?.length || 0,
                node_type: node.type || 'GROUP',
                layer: node.layer || null,
                created_at: databasePool.fn.now(),
                updated_at: databasePool.fn.now(),
            });
        }
    }

    if (blocksToUpsert.length > 0) {
        const uniqueBlocksMap = new Map();
        blocksToUpsert.forEach(block => uniqueBlocksMap.set(block.allure_id, block));
        const uniqueBlocksToUpsert = Array.from(uniqueBlocksMap.values());

        const saved = await databasePool('functional_blocks')
            .insert(uniqueBlocksToUpsert)
            .onConflict(['allure_id', 'project_id'])
            .merge([
                'project_id',
                'name',
                'custom_field_id',
                'custom_field_name',
                'count',
                'parent_id',
                'node_type',
                'layer',
                'updated_at'
            ])
            .returning(['id', 'allure_id']);

        logInfo(`Пакетно загружено / обновлено ${uniqueBlocksToUpsert.length} функциональных блоков для проекта ${projectId}`);
        return saved;
    }
    return [];
}



/**
 * Рекурсивно получает папки и их вложенные дети из Allure API с параллельными запросами и возможностью пропуска
 * @param {string} projectId - Идентификатор проекта в Allure
 * @param {number[]} pathPrefix - Путь от корня дерева до папки, чьи прямые дети запрашиваются ([] для корня)
 * @param {number} treeId - Идентификатор дерева
 * @param {Array} customFields - Список пользовательских полей с id и названиями
 * @param {Object} [skipCriteria] - Критерии для пропуска узлов (например, { customFieldIdsToSkip: [], namePatternsToSkip: [] })
 * @returns {Promise<Array>} - Массив отформатированных папок с их детьми
 */
async function getNestedFoldersParallel(projectId, pathPrefix, treeId, customFields, skipCriteria = { customFieldIdsToSkip: [], namePatternsToSkip: [] }, dbParentId = null) {
    const folders = [];
    const customFieldsMap = new Map();
    customFields.forEach(field => {
        customFieldsMap.set(field.id, field.name);
    });

    let page = 0;
    let hasMore = true;

    while (hasMore) {
        const entityUrl = buildTestCaseTreeEntityUrl(config.allureBaseUrl, {
            projectId,
            treeId,
            page,
            size: 100,
            pathPrefix,
            deleted: 'false',
        });

        logInfo(`Запрашиваем вложенные папки для projectId ${projectId}, treeId ${treeId}, path ${JSON.stringify(pathPrefix)}, page ${page}`);
        const structureResponse = await allureLimit(() => fetchWithAuth(entityUrl, {
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
            },
        }));

        if (!structureResponse.ok) {
            const errorMessage = await structureResponse.text();
            logError(`Ошибка получения вложенных папок для projectId ${projectId}, path ${JSON.stringify(pathPrefix)}: ${structureResponse.statusText}`, errorMessage);
            throw new Error(`Не удалось получить вложенные папки: ${structureResponse.statusText} - ${errorMessage}`);
        }

        const data = await structureResponse.json();
        const pageContent = getTestCaseTreeEntityContent(data);
        logInfo(`Ответ для path ${JSON.stringify(pathPrefix)}, page ${page}: получено ${pageContent.length} узлов`);

        let savedBlocksMapping = new Map();
        if (pageContent.length > 0) {
            const saved = await allureLimit(() => saveFunctionalBlocks(projectId, pageContent, dbParentId, customFields));
            saved.forEach(b => savedBlocksMapping.set(b.allure_id, b.id));
        }

        const interestingNodes = pageContent.filter(node => node.type === 'GROUP');
        const folderPromises = interestingNodes.map(async (node) => {
            try {
                const childPath = [...pathPrefix, Number(node.id)];
                const nodeCustomFieldName = customFieldsMap.get(node.customFieldId);
                const layer = node.layer || null;
                const currentDbId = savedBlocksMapping.get(node.id.toString()) || null;

                if (shouldSkipNode(node, skipCriteria)) {
                    logWarn(`Пропущен узел с ID ${node.id} (name: ${node.name}) по критериям пропуска`);
                    return null;
                }

                logInfo(`Обрабатываем узел [${node.type}] projectId=${projectId}, id=${node.id}, name=${node.name}`);

                if (nocodeProjectIds.includes(String(projectId))) {
                    if (nodeCustomFieldName === 'Block' || nodeCustomFieldName === 'SubBlock') {
                        const children = await getNestedFoldersParallel(projectId, childPath, treeId, customFields, skipCriteria, currentDbId);
                        return {
                            id: node.id,
                            name: node.name,
                            customFieldId: node.customFieldId || null,
                            customFieldName: nodeCustomFieldName,
                            count: children.length,
                            node_type: node.type,
                            layer: layer,
                            children: children.filter(child => child !== null),
                        };
                    }

                    if (pathPrefix.length === 0) {
                        const children = await getNestedFoldersParallel(projectId, childPath, treeId, customFields, skipCriteria, currentDbId);
                        return children.filter(child => child !== null);
                    } else {
                        const children = await getNestedFoldersParallel(projectId, childPath, treeId, customFields, skipCriteria, currentDbId);
                        return {
                            id: node.id,
                            name: node.name,
                            customFieldId: node.customFieldId || null,
                            customFieldName: nodeCustomFieldName,
                            count: children.length,
                            node_type: node.type,
                            layer: layer,
                            children: children.filter(child => child !== null),
                        };
                    }
                }

                const children = await getNestedFoldersParallel(projectId, childPath, treeId, customFields, skipCriteria, currentDbId);
                return {
                    id: node.id,
                    name: node.name,
                    customFieldId: node.customFieldId || null,
                    customFieldName: nodeCustomFieldName || 'Неизвестное поле',
                    count: children.length,
                    node_type: node.type,
                    layer: layer,
                    children: children.filter(child => child !== null),
                };

            } catch (error) {
                logError(`Ошибка при обработке узла ${node.id} (${node.name}):`, error.message);
                return null;
            }
        });

        const resolvedFolders = await Promise.all(folderPromises);
        resolvedFolders.forEach((result) => {
            if (Array.isArray(result)) {
                folders.push(...result.filter(f => f !== null));
            } else if (result !== null) {
                folders.push(result);
            }
        });

        hasMore = pageContent.length === 100;
        page++;
    }
    return folders;
}

/**
 * Проверяет, нужно ли пропустить узел на основе заданных критериев
 * @param {Object} node - Узел дерева (GROUP)
 * @param {Object} skipCriteria - Критерии пропуска ({ customFieldIdsToSkip: [], namePatternsToSkip: [] })
 * @returns {boolean} - True, если узел нужно пропустить
 */
function shouldSkipNode(node, skipCriteria) {
    const { customFieldIdsToSkip = [], namePatternsToSkip = [] } = skipCriteria;

    if (customFieldIdsToSkip.length > 0 && customFieldIdsToSkip.includes(node.customFieldId)) {
        return true;
    }

    if (namePatternsToSkip.length > 0) {
        const nodeName = (node.name || '').toLowerCase();
        if (namePatternsToSkip.some(pattern => nodeName.includes(pattern.toLowerCase()))) {
            return true;
        }
    }

    return false;
}
