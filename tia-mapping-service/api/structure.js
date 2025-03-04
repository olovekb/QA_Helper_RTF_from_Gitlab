// api/structure.js
import fetch from 'node-fetch'; // Импорт fetch для HTTP-запросов
import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js'; // Импорт функции авторизации и заголовков
import config from '../config/index.js'; // Импорт конфигурации проекта
import { logInfo, logError, logWarn } from '../utils/logger.js'; // Импорт функций логирования
import databasePool from '../db/pool.js'; // Импорт пула подключений к базе данных

// Глобальный кэш для хранения результатов запросов (очищается при необходимости)
const cache = new Map();

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
        logInfo(`Запрашиваем иерархическую структуру папок проекта с ID ${projectId} из Allure API`); // Логирование запроса

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
            // Извлекаем treeId из ответа, предполагая, что это поле 'id' в объекте 'content[0]'
            treeId = treeData.content?.[0]?.id || 0; // Используем 0 как запасной вариант, если id не найден
            if (!treeId) {
                logWarn(`treeId не найден в ответе для проекта ${projectId}, используем значение по умолчанию (0)`); // Логирование предупреждения
                treeId = 0; // Значение по умолчанию, если treeId не определён
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

        // Сохраняем корневые функциональные блоки и их детей рекурсивно
        await saveFunctionalBlocks(projectId, initialData.children.content, null, customFields);

        // Рекурсивно получаем всю структуру, начиная с корневого узла, параллельно, без пропуска
        const rootFolders = await getNestedFoldersParallel(projectId, null, treeId, customFields, skipCriteria);

        logInfo(`Успешно получена структура проекта ${projectId} с treeId ${treeId}`); // Логирование успеха

        return {
            projectId,
            folders: rootFolders, // Возвращаем только папки с полной вложенностью
        };
    } catch (error) {
        logError(`Ошибка обработки запроса структуры проекта ${projectId}:`, error.message || 'Неизвестная ошибка'); // Логирование ошибки с проверкой на undefined
        throw error; // Пробрасываем ошибку для обработки выше
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

    for (const node of nodes) {
        if (node.type === 'GROUP') {
            logInfo(`Обрабатываем узел типа GROUP с ID ${node.id}, name: ${node.name}, customFieldId: ${node.customFieldId}, parentId: ${parentId}`); // Лог для отладки
            try {
                // Проверяем, существует ли функциональный блок в базе данных по allure_id
                const existingBlock = await databasePool('functional_blocks')
                    .where({ allure_id: node.id.toString(), project_id: projectId })
                    .first();

                if (!existingBlock) {
                    // Создаём новый функциональный блок (id генерируется автоматически как UUID)
                    await databasePool('functional_blocks').insert({
                        allure_id: node.id.toString(), // Сохраняем ID из Allure как строку
                        project_id: projectId,
                        name: node.name,
                        custom_field_id: node.customFieldId || null,
                        custom_field_name: customFieldsMap.get(node.customFieldId) || 'Неизвестное поле',
                        parent_id: parentId, // Ссылка на родительский блок (UUID)
                        count: node.children?.content?.length || 0,
                        created_at: databasePool.fn.now(),
                        updated_at: databasePool.fn.now(),
                    });

                    logInfo(`Создан новый функциональный блок с allure_id ${node.id} для проекта ${projectId} с parent_id ${parentId}`);
                } else {
                    // Обновляем существующий блок, если нужно (например, count или name изменились)
                    await databasePool('functional_blocks')
                        .where({ allure_id: node.id.toString(), project_id: projectId })
                        .update({
                            name: node.name,
                            custom_field_id: node.customFieldId || null,
                            custom_field_name: customFieldsMap.get(node.customFieldId) || 'Неизвестное поле',
                            count: node.children?.content?.length || 0,
                            parent_id: parentId,
                            updated_at: databasePool.fn.now(),
                        });

                    logInfo(`Обновлён функциональный блок с allure_id ${node.id} для проекта ${projectId} с parent_id ${parentId}`);
                }

                // Рекурсивно сохраняем вложенные блоки, если есть children
                if (node.children?.content?.length > 0) {
                    const existingBlockId = existingBlock ? existingBlock.id : null; // Получаем UUID id существующего блока
                    await saveFunctionalBlocks(projectId, node.children.content, existingBlockId, customFields);
                }
            } catch (dbError) {
                logError(`Ошибка при сохранении/обновлении функционального блока с allure_id ${node.id} для проекта ${projectId}:`, dbError.message);
                throw new Error(`Ошибка базы данных: ${dbError.message}`);
            }
        } else {
            logWarn(`Пропущен узел с ID ${node.id} (type: ${node.type}, name: ${node.name}) — не является GROUP`); // Лог для узлов, не являющихся GROUP
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

    logInfo(`Запрашиваем вложенные блоки для projectId ${projectId}, treeId ${treeId}, parentNodeId ${parentNodeId}`); // Логирование шага
    const structureResponse = await fetchWithAuth(`${structureUrl}?${queryParams.toString()}`, {
        headers: {
            ...authHeaders, // Используем глобальные заголовки с токеном
            'Content-Type': 'application/json', // Тип контента
        },
    });

    if (!structureResponse.ok) {
        const errorMessage = await structureResponse.text();
        logError(`Ошибка получения вложенных блоков для projectId ${projectId}, parentNodeId ${parentNodeId}: ${structureResponse.statusText}`, errorMessage); // Логирование ошибки
        throw new Error(`Не удалось получить вложенные блоки: ${structureResponse.statusText} - ${errorMessage}`);
    }

    const data = await structureResponse.json();
    logInfo(`Ответ для parentNodeId ${parentNodeId}:`, JSON.stringify(data)); // Логирование ответа для отладки

    // Получаем или устанавливаем parentId для текущего уровня
    const parentBlock = await databasePool('functional_blocks')
        .where({ allure_id: parentNodeId, project_id: projectId })
        .first();
    const parentId = parentBlock ? parentBlock.id : null; // Получаем UUID id родительского блока

    // Сохраняем вложенные блоки с правильным parentId
    await saveFunctionalBlocks(projectId, data.children?.content || [], parentId, customFields);

    // Рекурсивно обрабатываем вложенные узлы
    for (const node of data.children?.content || []) {
        if (node.type === 'GROUP' && node.children?.content?.length > 0) {
            await fetchAndSaveNestedBlocks(projectId, node.id.toString(), treeId, customFields, skipCriteria);
        }
    }
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
    const queryParams = new URLSearchParams({
        treeId: treeId.toString(),
        page: '0',
        size: '100',
        sort: 'nodeSortOrder,asc',
        deleted: 'false',
    });

    if (parentNodeId !== null) {
        queryParams.append('parentNodeId', parentNodeId.toString());
    }

    logInfo(`Запрашиваем вложенные папки для projectId ${projectId}, treeId ${treeId}, parentNodeId ${parentNodeId}`); // Логирование шага
    const structureResponse = await fetchWithAuth(`${structureUrl}?${queryParams.toString()}`, {
        headers: {
            ...authHeaders, // Используем глобальные заголовки с токеном
            'Content-Type': 'application/json', // Тип контента
        },
    });

    if (!structureResponse.ok) {
        const errorMessage = await structureResponse.text();
        logError(`Ошибка получения вложенных папок для projectId ${projectId}, parentNodeId ${parentNodeId}: ${structureResponse.statusText}`, errorMessage); // Логирование ошибки
        throw new Error(`Не удалось получить вложенные папки: ${structureResponse.statusText} - ${errorMessage}`);
    }

    const data = await structureResponse.json();
    logInfo(`Ответ для parentNodeId ${parentNodeId}:`, JSON.stringify(data)); // Логирование ответа для отладки

    const folders = [];
    const customFieldsMap = new Map();
    customFields.forEach(field => {
        customFieldsMap.set(field.id, field.name);
    });

    // Получаем все узлы параллельно
    const groupNodes = data.children?.content?.filter(node => node.type === 'GROUP') || [];
    const folderPromises = groupNodes.map(async (node) => {
        // Проверяем, нужно ли пропустить этот узел (по умолчанию не пропускаем ничего)
        if (shouldSkipNode(node, skipCriteria)) {
            logWarn(`Пропущен узел с ID ${node.id} (name: ${node.name}, customFieldId: ${node.customFieldId}) по критериям пропуска`); // Логирование пропуска
            return null;
        }

        const children = await getNestedFoldersParallel(projectId, node.id.toString(), treeId, customFields, skipCriteria);
        return {
            id: node.id,
            name: node.name,
            customFieldId: node.customFieldId || null,
            customFieldName: customFieldsMap.get(node.customFieldId) || 'Неизвестное поле',
            count: node.children?.content?.length || 0,
            children: children.filter(child => child !== null), // Фильтруем null (пропущенные узлы)
        };
    });

    const resolvedFolders = await Promise.all(folderPromises);
    folders.push(...resolvedFolders.filter(folder => folder !== null)); // Фильтруем null (пропущенные узлы)

    logInfo(`Отформатировано папок для parentNodeId ${parentNodeId}: ${folders.length}`, JSON.stringify(folders)); // Логирование для отладки
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