import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js';
import config from '../config/index.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { savePageComponentDependencies } from './components.js';
import databasePool from '../db/pool.js';
import pLimit from 'p-limit'; // Импорт p-limit

// Импортируем функцию getTreeId из launch.js (можно вынести в utils если нужно)
// Для простоты продублируем здесь
const cache = new Map();
const limit = pLimit(10); // Ограничение параллельных запросов

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

    while (hasMore) {
        // Запрашиваем детей узла (и группы и листья)
        const url = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node?treeId=${treeId}&parentNodeId=${nodeId}&page=${page}&size=100`;

        try {
            const response = await fetchWithAuth(url, { headers: { ...authHeaders } });
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

    try {
        if (!projectId || !componentMappings) {
            return res.status(400).json({
                error: 'Необходимо указать projectId и componentMappings.',
                code: 'MISSING_PARAMETERS'
            });
        }

        logInfo(`Создание тест-плана: projectId=${projectId}, jiraLink=${jiraLink || 'не указана'}, components=${Object.keys(componentMappings).length}`);

        // 1. Собираем уникальные ID функциональных блоков из componentMappings
        const allBlockIds = new Set();
        Object.values(componentMappings).forEach(blockIds => {
            if (Array.isArray(blockIds)) {
                blockIds.forEach(id => allBlockIds.add(parseInt(id, 10)));
            }
        });

        const uniqueBlockIds = Array.from(allBlockIds).filter(id => !isNaN(id));

        if (uniqueBlockIds.length === 0) {
            return res.status(400).json({
                error: 'Не найдены функциональные блоки для тест-плана',
                code: 'NO_BLOCKS'
            });
        }

        logInfo(`Собрано ${uniqueBlockIds.length} уникальных ID функциональных блоков`);

        // 2. Получаем TreeID (нужен для запроса структуры)
        const treeId = await getTreeId(projectId);

        // 3. Собираем ID всех тест-кейсов (листьев) рекурсивно для каждого выбранного блока
        logInfo(`Начинаем сбор тест-кейсов для ${uniqueBlockIds.length} функциональных блоков...`);

        const allLeafIds = new Set();
        const collectedLeavesPromises = uniqueBlockIds.map(blockId =>
            limit(async () => {
                try {
                    const leaves = await collectAllLeaves(projectId, treeId, blockId);
                    logInfo(`Для блока ${blockId} найдено ${leaves.length} тест-кейсов`);
                    return leaves;
                } catch (e) {
                    logError(`Ошибка сбора листьев для блока ${blockId}: ${e.message}`);
                    return [];
                }
            })
        );

        const leavesResults = await Promise.all(collectedLeavesPromises);
        leavesResults.forEach(leaves => leaves.forEach(id => allLeafIds.add(id)));

        const leafsInclude = Array.from(allLeafIds);

        if (leafsInclude.length === 0) {
            return res.status(400).json({
                error: 'Не найдено ни одного тест-кейса в выбранных функциональных блоках',
                code: 'NO_TEST_CASES'
            });
        }

        logInfo(`Всего собрано ${leafsInclude.length} уникальных ID тест-кейсов`);

        // 4. Формируем название тест-плана
        let testPlanName = 'Регресс тестирование';
        if (jiraLink) {
            const jiraIssueKeyMatch = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
            const jiraIssueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : jiraLink.split('/').pop();
            testPlanName = `Регресс тестирование ${jiraIssueKey}`;
        } else {
            // Если задача не указана, добавляем текущую дату
            const today = new Date().toLocaleDateString('ru-RU');
            testPlanName = `Регресс тестирование ${today}`;
        }

        // 5. Формируем тело запроса для testplan API
        // Используем leafsInclude с плоским списком ID тест-кейсов - это надежный способ
        const requestBody = {
            projectId: parseInt(projectId, 10),
            treeSelection: {
                inverted: false,
                groupsInclude: [],
                groupsExclude: [],
                leafsInclude: leafsInclude,  // Массив ID тест-кейсов
                leafsExclude: [],
                kind: 'TreeSelectionDto'
            },
            treeId: treeId,
            name: testPlanName
        };

        logInfo(`Отправляем запрос создания тест-плана: ${testPlanName}`);
        logInfo(`leafsInclude содержит ${leafsInclude.length} тест-кейсов (первые 10): ${JSON.stringify(leafsInclude.slice(0, 10))}`);
        logInfo(`Полное тело запроса: ${JSON.stringify(requestBody, null, 2)}`);

        // 6. Отправка запроса в Allure testplan API
        const testPlanUrl = `${config.allureBaseUrl}/api/testplan`;
        const testPlanResponse = await fetchWithAuth(testPlanUrl, {
            method: 'POST',
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const responseText = await testPlanResponse.text();

        // 6. Обработка результата
        if (!testPlanResponse.ok) {
            let errorData = {};
            try { errorData = JSON.parse(responseText); } catch (e) { }

            logError(`Ошибка создания тест-плана: ${testPlanResponse.status}`, responseText);

            return res.status(testPlanResponse.status).json({
                error: 'Ошибка при создании тест-плана в Allure',
                code: 'ALLURE_API_ERROR',
                details: errorData.message || responseText.substring(0, 200)
            });
        }

        // 7. Успех
        const responseData = JSON.parse(responseText);
        logInfo(`Тест-план создан! ID: ${responseData.id}, Тест-кейсов: ${responseData.testCasesCount || 'N/A'}`);

        // 8. Сохраняем связи Page -> Components (асинхронно)
        if (pageDependencies && pageDependencies.length > 0) {
            try {
                await savePageComponentDependencies(projectId, pageDependencies);
            } catch (depError) {
                logWarn(`Связи не сохранены (некритично): ${depError.message}`);
            }
        }

        res.status(200).json({
            id: responseData.id,
            testCasesCount: responseData.testCasesCount || 0
        });

    } catch (error) {
        logError(`FATAL error createTestPlanAPI: ${error.message}`);
        res.status(500).json({
            error: 'Ошибка создания тест-плана',
            details: error.message
        });
    }
}
