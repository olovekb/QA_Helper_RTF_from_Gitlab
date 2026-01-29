import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js';
import config from '../config/index.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { savePageComponentDependencies } from './components.js';
import pLimit from 'p-limit';

// Кеш и лимит для параллельных запросов
const cache = new Map();
const limit = pLimit(5);

/**
 * Рекурсивно собирает данные всех листьев (тест-кейсов) для заданного узла (папки)
 */
async function collectAllLeaves(projectId, treeId, nodeId, visitedNodes = new Set()) {
    if (visitedNodes.has(nodeId)) return [];
    visitedNodes.add(nodeId);

    const leavesInfo = [];
    let page = 0;
    let hasMore = true;

    const MAX_PAGES = 50;
    while (hasMore && page < MAX_PAGES) {
        const url = `${config.allureBaseUrl}/api/v2/project/${projectId}/test-case/tree/tree-node?treeId=${treeId}&parentNodeId=${nodeId}&page=${page}&size=100`;
        logInfo(`[collectAllLeaves] Requesting: ${url}`);

        try {
            const response = await fetchWithAuth(url, { headers: { ...authHeaders }, timeout: 60000 });
            if (!response.ok) {
                logError(`Ошибка получения детей для узла ${nodeId}: ${response.statusText}`);
                break;
            }
            const data = await response.json();
            const children = data.children?.content || [];

            logInfo(`[collectAllLeaves] Node ${nodeId}: Found ${children.length} children. Page ${page}.`);

            children.filter(child => child.type === 'LEAF').forEach(leaf => {
                leavesInfo.push({
                    nodeId: leaf.id,
                    testCaseId: leaf.testCaseId
                });
            });

            const groupChildren = children.filter(child => child.type === 'GROUP');
            if (groupChildren.length > 0) {
                const nestedResults = await Promise.all(groupChildren.map(group =>
                    limit(() => collectAllLeaves(projectId, treeId, group.id, visitedNodes))
                ));
                nestedResults.forEach(res => leavesInfo.push(...res));
            }

            if (data.children?.last) {
                hasMore = false;
            } else {
                page++;
            }
        } catch (error) {
            logError(`Ошибка при запросе листьев для узла ${nodeId}:`, error.message);
            break;
        }
    }

    return leavesInfo;
}

/**
 * Получает treeId для проекта
 */
async function getTreeId(projectId) {
    try {
        const treeCacheKey = `tree_${projectId}`;
        let treeId = cache.get(treeCacheKey);

        if (!treeId) {
            const treeUrl = `${config.allureBaseUrl}/api/tree?projectId=${projectId}`;
            const treeResponse = await fetchWithAuth(treeUrl, {
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
            });

            if (!treeResponse.ok) {
                const errorMessage = await treeResponse.text();
                throw new Error(`Не удалось получить treeId: ${treeResponse.statusText}`);
            }

            const treeData = await treeResponse.json();
            let structureTree = null;
            if (String(projectId) === '307') {
                structureTree = treeData.content?.find(item => item.name === "Global Structure") || treeData.content?.find(item => item.name === "Structure");
            } else {
                structureTree = treeData.content?.find(item => item.name === "Structure");
            }

            treeId = (structureTree && structureTree.id) ? structureTree.id : (treeData.content?.[0]?.id || 0);
            if (!treeId) throw new Error(`treeId не найден для проекта ${projectId}`);
            cache.set(treeCacheKey, treeId);
        }
        return parseInt(treeId, 10);
    } catch (error) {
        logError(`Ошибка при получении treeId: ${error.message}`);
        throw error;
    }
}

/**
 * Создание тест-плана через API Allure
 */
export async function createTestPlanAPI(req, res) {
    const { projectId, componentMappings, jiraLink, pageDependencies } = req.body;

    if (!projectId || !componentMappings) {
        return res.status(400).json({ error: 'Необходимо указать projectId и componentMappings.' });
    }

    const allOriginalFolderIds = new Set();
    Object.values(componentMappings).forEach(blockIds => {
        if (Array.isArray(blockIds)) {
            blockIds.forEach(idVal => {
                const id = parseInt(idVal, 10);
                if (!isNaN(id)) allOriginalFolderIds.add(id);
            });
        }
    });

    if (allOriginalFolderIds.size === 0) {
        return res.status(400).json({ error: 'Не найдены функциональные блоки для тест-плана' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendEvent = (type, data = {}) => res.write(JSON.stringify({ type, ...data }) + '\n');

    try {
        sendEvent('init', { totalBlocks: allOriginalFolderIds.size });

        const treeId = await getTreeId(projectId);

        let testPlanName = 'Регресс тестирование';
        if (jiraLink) {
            const match = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
            testPlanName = `Регресс тестирование ${match ? match[1] : jiraLink.split('/').pop()}`;
        } else {
            testPlanName = `Регресс тестирование ${new Date().toLocaleDateString('ru-RU')}`;
        }

        const allNodeIds = new Set();
        const allTestCaseIds = new Set();
        const folderIds = Array.from(allOriginalFolderIds);

        let processedCount = 0;
        const totalFolders = folderIds.length;

        const updateLeafProgress = () => {
            processedCount++;
            if (processedCount % 5 === 0 || processedCount === totalFolders) {
                sendEvent('progress', {
                    current: processedCount,
                    total: totalFolders,
                    message: `Сбор тест-кейсов: обработано ${processedCount} из ${totalFolders} папок`
                });
            }
        };

        const leavesPromises = folderIds.map(folderId =>
            limit(async () => {
                try {
                    const leavesInfo = await collectAllLeaves(projectId, treeId, folderId);
                    leavesInfo.forEach(info => {
                        allNodeIds.add(info.nodeId);
                        allTestCaseIds.add(info.testCaseId);
                    });
                    updateLeafProgress();
                } catch (e) {
                    logError(`Ошибка сбора листьев для папки ${folderId}:`, e.message);
                }
            })
        );

        await Promise.all(leavesPromises);

        const finalNodeIds = Array.from(allNodeIds);
        const finalTestCaseIds = Array.from(allTestCaseIds);

        logInfo(`Собрано ${finalNodeIds.length} узлов и ${finalTestCaseIds.length} тест-кейсов`);

        if (finalTestCaseIds.length === 0) {
            throw new Error('Не найдено ни одного тест-кейса в выбранных папках');
        }

        // Шотган подход: плоский groupsInclude (как в launch.js) + подробные списки тест-кейсов
        const requestBody = {
            selection: {
                projectId: parseInt(projectId, 10),
                treeId: parseInt(treeId, 10),
                inverted: false,
                groupsInclude: folderIds,        // ПЛОСКИЙ МАССИВ (как в launch.js!)
                groupsExclude: [],
                leavesInclude: finalNodeIds,     // Node IDs
                leafsInclude: finalNodeIds,      // Alias
                testCasesInclude: finalTestCaseIds, // Global TestCase IDs
                leavesExclude: [],
                testCasesExclude: [],
                path: [],
                deleted: false,
                search: ""
            },
            testPlanName: testPlanName,
            // Для bulk testplan create некоторые версии ожидают tree в корне
            tree: { id: parseInt(treeId, 10) }
        };

        logInfo(`Запрос на создание тест-плана: ${JSON.stringify(requestBody)}`);

        const testPlanUrl = `${config.allureBaseUrl}/api/testcase/bulk/testplan/create`;
        const response = await fetchWithAuth(testPlanUrl, {
            method: 'POST',
            body: JSON.stringify(requestBody),
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            timeout: 60000
        });

        const text = await response.text();

        if (!response.ok) {
            let errorDetails = text;
            try { errorDetails = JSON.parse(text).message; } catch (e) { }
            logError(`Ошибка API Allure (${response.status}):`, text);
            sendEvent('error', { error: 'Ошибка при создании тест-плана в Allure', details: errorDetails });
            res.end();
            return;
        }

        const data = JSON.parse(text);

        if (pageDependencies && pageDependencies.length > 0) {
            savePageComponentDependencies(projectId, pageDependencies).catch(e => logWarn(`Связи не сохранены: ${e.message}`));
        }

        logInfo(`Тест-план создан: ID ${data.id}, тестов: ${data.testCasesCount || 0}`);
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
