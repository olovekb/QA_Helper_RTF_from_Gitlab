import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js'; // Импорт функции авторизации и заголовков
import config from '../config/index.js'; // Импорт конфигурации проекта
import { logInfo, logError, logWarn } from '../utils/logger.js'; // Импорт функций логирования
import databasePool from '../db/pool.js'; // Импорт пула подключений к базе данных
import pLimit from 'p-limit';

// Глобальный кэш для хранения результатов запросов (очищается при необходимости)
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
        logInfo(`Запрашиваем иерархическую структуру папок проекта с ID ${projectId} из Allure API`); // Логирование запроса\

        // Очищаем кэш, если projectId изменился
        if (currentProjectId !== projectId) {
            cache.clear();
            logInfo(`Кэш очищен, так как projectId изменился с ${currentProjectId} на ${projectId}`);
            currentProjectId = projectId;
        }

        // Шаг 1: Получаем treeId для проекта через эндпоинт /api/tree (с кэшированием)
        const treeCacheKey = `tree_${projectId}`;
        let treeId = cache.get(treeCacheKey);

        if (!treeId) {
            const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;

            logInfo(`Получаем treeId для проекта ${projectId} (без кэша)`); // Логирование шага
            const treeResponse = await fetchWithAuth(treeUrl, {
                headers: {
                    ...authHeaders, // Используем глобальные заголовки с токеном
                    'Content-Type': 'application/json', // Тип контента
                },
            });

            if (!treeResponse.ok) {
                const errorMessage = await treeResponse.text();
                logError(`Ошибка получения treeId для проекта ${projectId}: ${treeResponse.statusText}`, errorMessage); // Логирование ошибки
                throw new Error(`Не удалось получить treeId: ${treeResponse.statusText} - ${errorMessage}`);
            }

            const treeData = await treeResponse.json();
            logInfo(`Ответ от /api/tree для projectId ${projectId}:`, JSON.stringify(treeData)); // Логирование ответа для отладки

            // Извлекаем treeId из ответа
            // Для проекта 307 ищем "Global Structure", для остальных - "Structure"
            let structureTree = null;
            if (projectId === '307') {
                structureTree = treeData.content?.find(item => item.name === "Global Structure");
                if (!structureTree) {
                    structureTree = treeData.content?.find(item => item.name === "Structure");
                }
            } else {
                structureTree = treeData.content?.find(item => item.name === "Structure");
            }
            
            if (structureTree && structureTree.id) {
                treeId = structureTree.id;
                logInfo(`Найден treeId ${treeId} для проекта ${projectId} с name: "${structureTree.name}"`); // Логирование успеха
            } else {
                const searchName = projectId === '307' ? '"Global Structure" или "Structure"' : '"Structure"';
                logWarn(`treeId с name: ${searchName} не найден в ответе для проекта ${projectId}, используем значение по умолчанию (0)`); // Логирование предупреждения
                treeId = 0; // Значение по умолчанию, если treeId не найден
            }

            if (!treeId) {
                const searchName = projectId === '307' ? '"Global Structure" или "Structure"' : '"Structure"';
                throw new Error(`treeId не найден для проекта ${projectId} с name: ${searchName}`);
            }

            cache.set(treeCacheKey, treeId); // Кэшируем treeId
            logInfo(`Найден и закэширован treeId ${treeId} для проекта ${projectId}`); // Логирование успеха
        } else {
            logInfo(`Используем закэшированный treeId ${treeId} для проекта ${projectId}`); // Логирование кэширования
        }

        // Шаг 2: Получаем структуру дерева для конкретного treeId через /api/tree/{treeId} (с кэшированием)
        const treeDetailCacheKey = `treeDetail_${treeId}`;
        let customFields = cache.get(treeDetailCacheKey);

        if (!customFields) {
            const treeDetailUrl = `${config.allureBaseUrl}/api/tree/${treeId}`;

            logInfo(`Получаем детали дерева с treeId ${treeId} для проекта ${projectId} (без кэша)`); // Логирование шага
            const treeDetailResponse = await fetchWithAuth(treeDetailUrl, {
                headers: {
                    ...authHeaders, // Используем глобальные заголовки с токеном
                    'Content-Type': 'application/json', // Тип контента
                },
            });

            if (!treeDetailResponse.ok) {
                const errorMessage = await treeDetailResponse.text();
                logError(`Ошибка получения деталей дерева для treeId ${treeId}: ${treeDetailResponse.statusText}`, errorMessage); // Логирование ошибки
                throw new Error(`Не удалось получить детали дерева: ${treeDetailResponse.statusText} - ${errorMessage}`);
            }

            const treeDetailData = await treeDetailResponse.json();
            logInfo(`Ответ от /api/tree/${treeId}:`, JSON.stringify(treeDetailData)); // Логирование ответа для отладки
            // Извлекаем поля (fields) из ответа, где содержатся customFieldId и их названия
            customFields = treeDetailData.fields || [];
            cache.set(treeDetailCacheKey, customFields); // Кэшируем customFields
            logInfo(`Успешно получены и закэшированы custom fields для treeId ${treeId}: ${customFields.length} полей`); // Логирование успеха
        } else {
            logInfo(`Используем закэшированные custom fields для treeId ${treeId}: ${customFields.length} полей`); // Логирование кэширования
        }

        // Шаг 3: Получаем полную структуру дерева тест-кейсов с параллельными запросами
        const structureUrl = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node`;
        const baseQueryParams = new URLSearchParams({
            treeId: treeId.toString(), // Используем полученный treeId
            page: '0', // Начальная страница
            size: '100', // Размер страницы, чтобы получить достаточно данных
            sort: 'nodeSortOrder,asc', // Сортировка, как в твоём примере
            deleted: 'false', // Фильтруем неудалённые узлы
        });

        // Выполняем начальный запрос структуры
        logInfo(`Запрашиваем корневую структуру для projectId ${projectId}, treeId ${treeId}`); // Логирование шага
        const initialStructureResponse = await fetchWithAuth(`${structureUrl}?${baseQueryParams.toString()}`, {
            headers: {
                ...authHeaders, // Используем глобальные заголовки с токеном
                'Content-Type': 'application/json', // Тип контента
            },
        });

        if (!initialStructureResponse.ok) {
            const errorMessage = await initialStructureResponse.text();
            logError(`Ошибка получения структуры проекта ${projectId} для treeId ${treeId}: ${initialStructureResponse.statusText}`, errorMessage); // Логирование ошибки
            throw new Error(`Не удалось получить структуру проекта: ${initialStructureResponse.statusText} - ${errorMessage}`);
        }

        const initialData = await initialStructureResponse.json();
        logInfo(`Ответ от /api/v2/project/${projectId}/test-case/tree/tree-node (корень):`, JSON.stringify(initialData)); // Логирование ответа для отладки

        // Проверяем структуру ответа перед сохранением
        if (!initialData.children || !initialData.children.content) {
            logWarn(`Структура ответа для projectId ${projectId} не содержит children.content:`, JSON.stringify(initialData));
            throw new Error('Некорректная структура ответа от Allure API');
        }

        // Логируем типы корневых узлов и customFields для проекта 307
        if (projectId === '307') {
            const customFieldsMap = new Map();
            customFields.forEach(field => {
                customFieldsMap.set(field.id, field.name);
            });
            logInfo(`[projectId=307] Доступные customFields (${customFields.length}):`);
            customFields.forEach(field => {
                logInfo(`[projectId=307] customField: id=${field.id}, name="${field.name}"`);
            });
            logInfo(`[projectId=307] Корневые узлы (${initialData.children.content.length}):`);
            initialData.children.content.forEach((node, idx) => {
                const customFieldName = customFieldsMap.get(node.customFieldId);
                logInfo(`[projectId=307] Корневой узел ${idx}: id=${node.id}, name="${node.name}", customFieldId=${node.customFieldId}, customFieldName="${customFieldName}", type=${node.type}`);
            });
        }

        // Сохраняем корневые функциональные блоки и их детей рекурсивно
        await saveFunctionalBlocks(projectId, initialData.children.content, null, customFields);

        // Рекурсивно получаем и сохраняем всю структуру, начиная с корневого узла, используя fetchAndSaveNestedBlocks
        for (const node of initialData.children.content) {
            if (node.type === 'GROUP') { // Сохраняем все узлы типа GROUP, независимо от наличия детей
                await fetchAndSaveNestedBlocks(projectId, node.id.toString(), treeId, customFields, skipCriteria);
            }
        }

        // Рекурсивно получаем всю структуру для клиента, параллельно, без пропуска
        const rootFolders = await getNestedFoldersParallel(projectId, null, treeId, customFields, skipCriteria);

        logInfo(`Успешно получена структура проекта ${projectId} с treeId ${treeId}`); // Логирование успеха

        return {
            projectId,
            folders: rootFolders, // Возвращаем только папки с полной вложенностью
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Неизвестная ошибка');
        const errorStack = error instanceof Error ? error.stack : '';
        logError(`Ошибка обработки запроса структуры проекта ${projectId}:`, errorMessage);
        if (errorStack) {
            logError(`Стек ошибки для проекта ${projectId}:`, errorStack);
        }
        throw error instanceof Error ? error : new Error(errorMessage); // Пробрасываем ошибку для обработки выше
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

    // Собираем данные для пакетной вставки/обновления
    const blocksToInsert = [];
    const blocksToUpdate = [];

    for (const node of nodes) {
        if (node.type === 'GROUP') {
            logInfo(`Обрабатываем узел типа GROUP с ID ${node.id}, name: ${node.name}, customFieldId: ${node.customFieldId}, parentId: ${parentId}, children count: ${node.children?.content?.length || 0}`);

            const existingBlock = await databasePool('functional_blocks')
                .where({ allure_id: node.id.toString(), project_id: projectId })
                .first();

            const blockData = {
                allure_id: node.id.toString(),
                project_id: projectId,
                name: node.name,
                custom_field_id: node.customFieldId || null,
                custom_field_name: customFieldsMap.get(node.customFieldId) || 'Неизвестное поле',
                parent_id: parentId,
                count: node.children?.content?.length || 0,
                created_at: databasePool.fn.now(),
                updated_at: databasePool.fn.now(),
            };

            if (!existingBlock) {
                blocksToInsert.push(blockData);
            } else {
                blocksToUpdate.push({ ...blockData, id: existingBlock.id });
            }
        } else {
            logWarn(`Пропущен узел с ID ${node.id} (type: ${node.type}, name: ${node.name}) — не является GROUP`);
        }
    }

    // Пакетная вставка новых блоков
    if (blocksToInsert.length > 0) {
        await databasePool('functional_blocks').insert(blocksToInsert);
        logInfo(`Пакетно создано ${blocksToInsert.length} новых функциональных блоков для проекта ${projectId}`);
    }

    // Пакетное обновление существующих блоков
    if (blocksToUpdate.length > 0) {
        await Promise.all(
            blocksToUpdate.map(block =>
                databasePool('functional_blocks')
                    .where({ id: block.id })
                    .update({
                        name: block.name,
                        custom_field_id: block.custom_field_id,
                        custom_field_name: block.custom_field_name,
                        count: block.count,
                        parent_id: block.parent_id,
                        updated_at: block.updated_at,
                    })
            )
        );
        logInfo(`Пакетно обновлено ${blocksToUpdate.length} функциональных блоков для проекта ${projectId}`);
    }

    // Рекурсивно сохраняем вложенные блоки
    for (const node of nodes) {
        if (node.type === 'GROUP' && node.children?.content?.length > 0) {
            const existingBlock = await databasePool('functional_blocks')
                .where({ allure_id: node.id.toString(), project_id: projectId })
                .first();
            await saveFunctionalBlocks(projectId, node.children.content, existingBlock.id, customFields);
        }
    }
}

/**
 * Получает и сохраняет вложенные блоки для указанного parentNodeId
 * @param {string} projectId - Идентификатор проекта в Allure
 * @param {string} parentNodeId - ID родительского узла
 * @param {number} treeId - Идентификатор дерева
 * @param {Array} customFields - Список пользовательских полей с id и названиями
 * @param {Object} skipCriteria - Критерии для пропуска узлов (например, { customFieldIdsToSkip: [], namePatternsToSkip: [] })
 */
async function fetchAndSaveNestedBlocks(projectId, parentNodeId, treeId, customFields, skipCriteria) {
    const structureUrl = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node`;
    const queryParams = new URLSearchParams({
        treeId: treeId.toString(),
        parentNodeId: parentNodeId,
        page: '0',
        size: '100',
        sort: 'nodeSortOrder,asc',
        deleted: 'false',
    });

    logInfo(`Запрашиваем вложенные блоки для projectId ${projectId}, treeId ${treeId}, parentNodeId ${parentNodeId}`);
    const structureResponse = await fetchWithAuth(`${structureUrl}?${queryParams.toString()}`, {
        headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
        },
    });

    if (!structureResponse.ok) {
        const errorMessage = await structureResponse.text();
        logError(`Ошибка получения вложенных блоков для projectId ${projectId}, parentNodeId ${parentNodeId}: ${structureResponse.statusText}`, errorMessage);
        throw new Error(`Не удалось получить вложенные блоки: ${structureResponse.statusText} - ${errorMessage}`);
    }

    const data = await structureResponse.json();
    logInfo(`Ответ для parentNodeId ${parentNodeId}: children.content.length = ${data.children?.content?.length || 0}`, JSON.stringify(data));

    const parentBlock = await databasePool('functional_blocks')
        .where({ allure_id: parentNodeId.toString(), project_id: projectId })
        .first();
    const parentId = parentBlock ? parentBlock.id : null;

    logInfo(`Сохраняем вложенные блоки для parentNodeId ${parentNodeId}, parentId: ${parentId}, nodes count: ${data.children?.content?.length || 0}`);

    if (data.children?.content && data.children.content.length > 0) {
        await saveFunctionalBlocks(projectId, data.children.content, parentId, customFields);
    } else {
        logWarn(`Нет вложенных узлов (children.content) для parentNodeId ${parentNodeId}`);
    }

    // Параллельно обрабатываем вложенные узлы
    const groupNodes = data.children?.content?.filter(node => node.type === 'GROUP') || [];
    const nestedPromises = groupNodes.map(node =>
        fetchAndSaveNestedBlocks(projectId, node.id.toString(), treeId, customFields, skipCriteria)
    );
    await Promise.all(nestedPromises);
}

/**
 * Рекурсивно получает папки и их вложенные дети из Allure API с параллельными запросами и возможностью пропуска
 * @param {string} projectId - Идентификатор проекта в Allure
 * @param {string|null} parentNodeId - ID родительского узла (null для корня)
 * @param {number} treeId - Идентификатор дерева
 * @param {Array} customFields - Список пользовательских полей с id и названиями
 * @param {Object} skipCriteria - Критерии для пропуска узлов (например, { customFieldIdsToSkip: [], namePatternsToSkip: [] })
 * @returns {Promise<Array>} - Массив отформатированных папок с их детьми
 */
async function getNestedFoldersParallel(projectId, parentNodeId, treeId, customFields, skipCriteria = { customFieldIdsToSkip: [], namePatternsToSkip: [] }) {
    const structureUrl = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node`;
    const limit = pLimit(10);
    const folders = [];
    const customFieldsMap = new Map();
    customFields.forEach(field => {
        customFieldsMap.set(field.id, field.name);
    });

    let page = 0;
    let hasMore = true;

    while (hasMore) {
        const queryParams = new URLSearchParams({
            treeId: treeId.toString(),
            page: page.toString(),
            size: '100',
            sort: 'nodeSortOrder,asc',
            deleted: 'false',
        });

        if (parentNodeId !== null) {
            queryParams.append('parentNodeId', parentNodeId.toString());
        }

        logInfo(`Запрашиваем вложенные папки для projectId ${projectId}, treeId ${treeId}, parentNodeId ${parentNodeId}, page ${page}`);
        const structureResponse = await fetchWithAuth(`${structureUrl}?${queryParams.toString()}`, {
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
            },
        });

        if (!structureResponse.ok) {
            const errorMessage = await structureResponse.text();
            logError(`Ошибка получения вложенных папок для projectId ${projectId}, parentNodeId ${parentNodeId}: ${structureResponse.statusText}`, errorMessage);
            throw new Error(`Не удалось получить вложенные папки: ${structureResponse.statusText} - ${errorMessage}`);
        }

        const data = await structureResponse.json();
        logInfo(`Ответ для parentNodeId ${parentNodeId}, page ${page}: children.content.length = ${data.children?.content?.length || 0}`, JSON.stringify(data));

        const groupNodes = data.children?.content?.filter(node => node.type === 'GROUP') || [];
        const folderPromises = groupNodes.map(node =>
            limit(async () => {
                try {
                    if (shouldSkipNode(node, skipCriteria)) {
                        logWarn(`Пропущен узел с ID ${node.id} (name: ${node.name}, customFieldId: ${node.customFieldId}) по критериям пропуска`);
                        return null;
                    }

                    const nodeCustomFieldName = customFieldsMap.get(node.customFieldId);
                    logInfo(`Обрабатываем узел projectId=${projectId}, id=${node.id}, name=${node.name}, customFieldId=${node.customFieldId}, customFieldName=${nodeCustomFieldName}, parentNodeId=${parentNodeId}`);
                    
                    // Для проекта 307: специальная обработка
                    if (projectId === '307') {
                        // Показываем Block и SubBlock, а также все узлы, которые находятся под ними
                        if (nodeCustomFieldName === 'Block' || nodeCustomFieldName === 'SubBlock') {
                            logInfo(`Найден Block/SubBlock для проекта 307: ${nodeCustomFieldName} - ${node.name}`);
                            // Для Block и SubBlock обрабатываем детей БЕЗ фильтрации, чтобы показать Feature, Story, Scenario, Code
                            const children = await getNestedFoldersParallel(projectId, node.id.toString(), treeId, customFields, skipCriteria);
                            const result = {
                                id: node.id,
                                name: node.name,
                                customFieldId: node.customFieldId || null,
                                customFieldName: nodeCustomFieldName,
                                count: node.children?.content?.length || 0,
                                children: children.filter(child => child !== null),
                            };
                            logInfo(`Возвращаем Block/SubBlock для проекта 307: ${nodeCustomFieldName} - ${node.name}, children count: ${result.children.length}`);
                            return result;
                        }
                        
                        // Для Feature, Story, Scenario, Code и других типов - показываем их, если они находятся под Block или SubBlock
                        // Но если они на корневом уровне (parentNodeId === null), пропускаем их
                        if (parentNodeId === null) {
                            // На корневом уровне пропускаем все, кроме Block и SubBlock
                            logInfo(`Пропускаем корневой узел ${nodeCustomFieldName} для проекта 307, обрабатываем детей: ${node.name}`);
                            const children = await getNestedFoldersParallel(projectId, node.id.toString(), treeId, customFields, skipCriteria);
                            const filteredChildren = children.filter(child => child !== null);
                            logInfo(`Для корневого узла ${nodeCustomFieldName} - ${node.name} найдено детей после фильтрации: ${filteredChildren.length}`);
                            // Возвращаем массив детей (поднимаем их на уровень выше)
                            return filteredChildren;
                        } else {
                            // Если это не корневой уровень, показываем все узлы (Feature, Story, Scenario, Code и т.д.)
                            logInfo(`Показываем узел ${nodeCustomFieldName} для проекта 307 (не корневой уровень): ${node.name}`);
                            const children = await getNestedFoldersParallel(projectId, node.id.toString(), treeId, customFields, skipCriteria);
                            return {
                                id: node.id,
                                name: node.name,
                                customFieldId: node.customFieldId || null,
                                customFieldName: nodeCustomFieldName,
                                count: node.children?.content?.length || 0,
                                children: children.filter(child => child !== null),
                            };
                        }
                    }

                    // Обычная обработка для всех остальных проектов
                    const children = await getNestedFoldersParallel(projectId, node.id.toString(), treeId, customFields, skipCriteria);
                    const folder = {
                        id: node.id,
                        name: node.name,
                        customFieldId: node.customFieldId || null,
                        customFieldName: nodeCustomFieldName || 'Неизвестное поле',
                        count: node.children?.content?.length || 0,
                        children: children.filter(child => child !== null),
                    };
                    
                    return folder;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : JSON.stringify(error) || 'Неизвестная ошибка');
                    logError(`Ошибка при обработке узла ${node.id} (${node.name}):`, errorMessage);
                    // Возвращаем null вместо проброса ошибки, чтобы не прерывать обработку других узлов
                    return null;
                }
            })
        );

        const resolvedFolders = await Promise.all(folderPromises);
        // Обрабатываем результаты: если это массив (для Feature в проекте 307), распаковываем его
        resolvedFolders.forEach((result, index) => {
            if (Array.isArray(result)) {
                // Если вернулся массив (дети Feature), добавляем их напрямую
                const validResults = result.filter(folder => folder !== null);
                logInfo(`[parentNodeId=${parentNodeId}] Добавляем ${validResults.length} детей из массива (индекс ${index})`);
                folders.push(...validResults);
            } else if (result !== null) {
                // Обычный узел
                logInfo(`[parentNodeId=${parentNodeId}] Добавляем узел: ${result.customFieldName} - ${result.name} (индекс ${index})`);
                folders.push(result);
            } else {
                logInfo(`[parentNodeId=${parentNodeId}] Пропущен null результат (индекс ${index})`);
            }
        });
        logInfo(`[parentNodeId=${parentNodeId}] Итого папок после обработки: ${folders.length}`);

        // Проверяем, есть ли ещё страницы
        hasMore = data.children?.content?.length === 100; // Если вернулось 100 узлов, возможно, есть ещё
        page++;
    }

    logInfo(`Отформатировано папок для parentNodeId ${parentNodeId}: ${folders.length}`, JSON.stringify(folders));
    return folders;
}

/**
 * Проверяет, нужно ли пропустить узел на основе заданных критериев
 * @param {Object} node - Узел дерева (GROUP)
 * @param {Object} skipCriteria - Критерии пропуска (например, { customFieldIdsToSkip: [], namePatternsToSkip: [] })
 * @returns {boolean} - True, если узел нужно пропустить
 */
function shouldSkipNode(node, skipCriteria) {
    const { customFieldIdsToSkip = [], namePatternsToSkip = [] } = skipCriteria;

    // Проверяем customFieldId (по умолчанию не пропускаем ничего)
    if (customFieldIdsToSkip.includes(node.customFieldId)) {
        return true;
    }

    // Проверяем name по регулярным выражениям
    for (const pattern of namePatternsToSkip) {
        if (pattern.test(node.name)) {
            return true;
        }
    }

    return false;
}