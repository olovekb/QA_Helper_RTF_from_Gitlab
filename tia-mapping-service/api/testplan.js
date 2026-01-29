import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js';
import config from '../config/index.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { savePageComponentDependencies } from './components.js';
import databasePool from '../db/pool.js';
import pLimit from 'p-limit'; // Импорт p-limit

// Импортируем функцию getTreeId из launch.js (можно вынести в utils если нужно)
// Для простоты продублируем здесь
const cache = new Map();
const limit = pLimit(5); // Ограничение параллельных запросов (снижено с 20 до 5 для стабильности)

/**
 * Рекурсивно собирает ID всех листьев (тест-кейсов) для заданного узла (папки)
 * @param {string} projectId
 * @param {number} treeId
 * @param {number} nodeId
 * @param {Set<number>} visitedNodes - защита от циклов
 * @returns {Promise<Array<number>>}
 */
async function collectAllLeaves(projectId, treeId, nodeId, visitedNodes = new Set()) {
    if (visitedNodes.has(nodeId)) return [];
    visitedNodes.add(nodeId);

    const leaves = [];
    let page = 0;
    let hasMore = true;

    const MAX_PAGES = 50; // Защита от бесконечного цикла
    while (hasMore && page < MAX_PAGES) {
        // Запрашиваем детей узла (и группы и листья)
        const url = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node?treeId=${treeId}&parentNodeId=${nodeId}&page=${page}&size=100`;

        try {
            // logInfo(`[DEBUG] Запрос детей для узла ${nodeId}, стр ${page}`);
            // Увеличиваем таймаут до 60 секунд для запросов API Allure
            const response = await fetchWithAuth(url, { headers: { ...authHeaders }, timeout: 60000 });
            // logInfo(`[DEBUG] Ответ получен для узла ${nodeId}, стр ${page}`);
            if (!response.ok) {
                logError(`Ошибка получения детей для узла ${nodeId}: ${response.statusText}`);
                break;
            }

            const data = await response.json();
            const children = data.children?.content || [];

            // 1. Собираем листья текущего уровня (Важно: берем testCaseId, а не id узла!)
            children.filter(child => child.type === 'LEAF').forEach(leaf => leaves.push(leaf.testCaseId));

            // 2. Рекурсивно обрабатываем подпапки
            const groupChildren = children.filter(child => child.type === 'GROUP');
            if (groupChildren.length > 0) {
                const nestedLeavesResults = await Promise.all(groupChildren.map(group =>
                    limit(() => collectAllLeaves(projectId, treeId, group.id, visitedNodes))
                ));
                nestedLeavesResults.forEach(nestedLeaves => leaves.push(...nestedLeaves));
            }

            // Пагинация
            if (children.length < 100) hasMore = false;
            page++;
        } catch (error) {
            logError(`Ошибка при запросе листьев для узла ${nodeId}:`, error.message);
            break;
        }
    }

    return leaves;
}

async function getTreeId(projectId) {
    try {
        logInfo(`Получаем treeId для проекта ${projectId} (проверяем кэш)`);
        const treeCacheKey = `tree_${projectId}`;
        let treeId = cache.get(treeCacheKey);

        if (!treeId) {
            const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;
            logInfo(`Получаем treeId для проекта ${projectId} (без кэша)`);
            const treeResponse = await fetchWithAuth(treeUrl, {
                headers: {
                    ...authHeaders,
                    'Content-Type': 'application/json',
                },
            });

            if (!treeResponse.ok) {
                const errorMessage = await treeResponse.text();
                logError(`Ошибка получения treeId для проекта ${projectId}: ${treeResponse.statusText}`, errorMessage);
                throw new Error(`Не удалось получить treeId: ${treeResponse.statusText} - ${errorMessage}`);
            }

            const treeData = await treeResponse.json();
            treeId = treeData.content?.[0]?.id || 0;
            if (!treeId) {
                logWarn(`treeId не найден в ответе для проекта ${projectId}`);
                throw new Error(`treeId не найден для проекта ${projectId}`);
            }

            cache.set(treeCacheKey, treeId);
            logInfo(`Найден и закэширован treeId ${treeId} для проекта ${projectId}`);
        } else {
            logInfo(`Используем закэшированный treeId ${treeId} для проекта ${projectId}`);
        }

        return parseInt(treeId, 10);
    } catch (error) {
        logError(`Ошибка при получении treeId для проекта ${projectId}: ${error.message}`, error.stack || '');
        throw error;
    }
}



/**
 * Создание тест-плана через API Allure
 * @param {Object} req - Объект запроса Express
 * @param {Object} res - Объект ответа Express
 */
export async function createTestPlanAPI(req, res) {
    const { projectId, componentMappings, jiraLink, pageDependencies } = req.body;

    if (!projectId || !componentMappings) {
        return res.status(400).json({
            error: 'Необходимо указать projectId и componentMappings.',
            code: 'MISSING_PARAMETERS'
        });
    }

    // 1. Собираем ID групп. Если переданы полные пути (groupsIncludePaths), используем их.
    // Иначе собираем ID из componentMappings (fallback для старых клиентов или прямых вызовов)
    const groupsInclude = [];

    if (req.body.groupsIncludePaths && Array.isArray(req.body.groupsIncludePaths) && req.body.groupsIncludePaths.length > 0) {
        logInfo(`Используем переданные полные пути (groupsIncludePaths): ${req.body.groupsIncludePaths.length} путей`);
        req.body.groupsIncludePaths.forEach(path => {
            if (Array.isArray(path)) {
                const validPath = path.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
                if (validPath.length > 0) groupsInclude.push(validPath);
            }
        });
    } else {
        logInfo(`groupsIncludePaths не переданы, используем fallback logic (одиночные ID)`);
        const processedIds = new Set();
        Object.values(componentMappings).forEach(blockIds => {
            if (Array.isArray(blockIds)) {
                blockIds.forEach(idVal => {
                    const id = parseInt(idVal, 10);
                    if (!isNaN(id) && !processedIds.has(id)) {
                        processedIds.add(id);
                        groupsInclude.push([id]); // [[ID]] - путь из одного элемента
                    }
                });
            }
        });
    }

    if (groupsInclude.length === 0) {
        return res.status(400).json({
            error: 'Не найдены функциональные блоки для тест-плана',
            code: 'NO_BLOCKS'
        });
    }

    logInfo(`Создание тест-плана (nested groups): projectId=${projectId}, групп=${groupsInclude.length}`);

    // Настраиваем стриминг (чтобы клиент видел прогресс)
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendEvent = (type, data = {}) => res.write(JSON.stringify({ type, ...data }) + '\n');

    try {
        sendEvent('init', { totalBlocks: groupsInclude.length });

        // 2. Получаем TreeID
        const treeId = await getTreeId(projectId);

        // 3. Формируем название
        let testPlanName = 'Регресс тестирование';
        if (jiraLink) {
            const match = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
            testPlanName = `Регресс тестирование ${match ? match[1] : jiraLink.split('/').pop()}`;
        } else {
            testPlanName = `Регресс тестирование ${new Date().toLocaleDateString('ru-RU')}`;
        }

        sendEvent('progress', { current: groupsInclude.length, total: groupsInclude.length, message: 'Отправка запроса в Allure...' });

        // 4. Тело запроса - ВАЖНО: передаем groupsInclude вложенными массивами (как в UI)
        // Allure API требует List<List<Long>> (пути?), а не плоский список.
        const treeSelection = {
            inverted: false,
            groupsInclude: groupsInclude,
            groupsExclude: [],
            leafsInclude: [],
            leafsExclude: [],
            kind: 'TreeSelectionDto'
        };

        const requestBody = {
            projectId: parseInt(projectId, 10),
            treeSelection: treeSelection,
            treeId: treeId,
            name: testPlanName
        };

        logInfo(`Отправляем запрос создания тест-плана (структура обновлена): ${JSON.stringify(requestBody)}`);

        // 5. Запрос к Allure
        // Возвращаем /api/testplan, так как /api/rs/testplan мб не тем энпоинтом
        const testPlanUrl = `${config.allureBaseUrl}/api/testplan`;

        const response = await fetchWithAuth(testPlanUrl, {
            method: 'POST',
            body: JSON.stringify(requestBody),
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            timeout: 60000 // 60s timeout
        });

        const text = await response.text();

        if (!response.ok) {
            let errorDetails = text;
            try { errorDetails = JSON.parse(text).message; } catch (e) { }

            logError(`Ошибка API Allure: ${response.status}`, text);
            sendEvent('error', {
                error: 'Ошибка при создании тест-плана в Allure',
                code: 'ALLURE_API_ERROR',
                details: errorDetails
            });
            res.end();
            return;
        }

        const data = JSON.parse(text);

        // 6. Сохраняем связи (фон)
        if (pageDependencies && pageDependencies.length > 0) {
            try {
                savePageComponentDependencies(projectId, pageDependencies).catch(e => logWarn(`Связи не сохранены (фон): ${e.message}`));
            } catch (depError) {
                logWarn(`Связи не сохранены: ${depError.message}`);
            }
        }

        logInfo(`Тест-план создан: ID ${data.id}`);
        sendEvent('result', {
            id: data.id,
            testCasesCount: data.testCasesCount || 0
        });
        res.end();

    } catch (error) {
        logError(`FATAL error createTestPlanAPI: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Внутренняя ошибка сервера', details: error.message });
        } else {
            sendEvent('error', { error: 'Внутренняя ошибка сервера', details: error.message });
            res.end();
        }
    }
}
