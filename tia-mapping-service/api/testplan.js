import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js';
import config from '../config/index.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { savePageComponentDependencies } from './components.js';

// Импортируем функцию getTreeId из launch.js (можно вынести в utils если нужно)
// Для простоты продублируем здесь
const cache = new Map();

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

        // 1. Собираем ID групп (уникальные)
        const allFolderIds = new Set();
        Object.values(componentMappings).forEach(folderIds => {
            if (Array.isArray(folderIds)) {
                folderIds.forEach(id => allFolderIds.add(parseInt(id, 10)));
            }
        });

        const groupsInclude = Array.from(allFolderIds).filter(id => !isNaN(id));

        if (groupsInclude.length === 0) {
            return res.status(400).json({
                error: 'Не найдены группы для тест-плана (groupsInclude пустой)',
                code: 'NO_GROUPS'
            });
        }

        // 2. Получаем TreeID
        const treeId = await getTreeId(projectId);

        // 3. Формируем название тест-плана
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

        // 4. Формируем тело запроса для testplan API
        // ВАЖНО: groupsInclude должен быть МАССИВОМ МАССИВОВ!
        // Каждый ID нужно обернуть в свой массив: [[19668], [12552]] вместо [19668, 12552]
        const groupsIncludeFormatted = groupsInclude.map(id => [id]);

        const requestBody = {
            projectId: parseInt(projectId, 10),
            treeSelection: {
                inverted: false,
                groupsInclude: groupsIncludeFormatted,  // Массив массивов!
                groupsExclude: [],
                leafsInclude: [],
                leafsExclude: [],
                kind: 'TreeSelectionDto'
            },
            treeId: treeId,  // Добавляем treeId как в curl
            name: testPlanName
        };

        logInfo(`Отправляем запрос создания тест-плана: ${testPlanName}`);
        logInfo(`groupsInclude исходный: ${JSON.stringify(groupsInclude)}`);
        logInfo(`groupsInclude форматированный (массив массивов): ${JSON.stringify(groupsIncludeFormatted)}`);
        logInfo(`Полное тело запроса: ${JSON.stringify(requestBody, null, 2)}`);

        // 5. Отправка запроса в Allure testplan API
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
