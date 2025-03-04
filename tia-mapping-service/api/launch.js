// api/launch.js
import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js'; // Импорт утилит для аутентификации
import config from '../config/index.js'; // Импорт конфигурации проекта
import { logError, logInfo, logWarn } from '../utils/logger.js'; // Импорт логгера
import databasePool from '../db/pool.js'; // Импорт пула подключений к базе данных (если нужно)

// Глобальный кэш для хранения результатов запросов (аналогично structure.js)
const cache = new Map();

async function logResponse(response, url, requestBody = null) {
    // Клонируем response, чтобы сохранить оригинальный поток
    const clonedResponse = response.clone();
    let responseText = '';
    try {
        responseText = await clonedResponse.text(); // Читаем тело из клона
    } catch (error) {
        logWarn(`Не удалось получить текст ответа от ${url}: ${error.message}`);
        responseText = 'Не удалось прочитать тело ответа';
    }
    logInfo(`Ответ от ${url}: Status ${response.status}, Body: ${responseText}`);
    if (requestBody) {
        logInfo(`Запрос на ${url} с телом: ${JSON.stringify(requestBody)}`);
    }
    return response; // Возвращаем оригинальный response
}

/**
 * Получение treeId для проекта, аналогично structure.js
 * @param {string} projectId - Идентификатор проекта
 * @returns {Promise<number>} - treeId проекта
 */
async function getTreeId(projectId) {
    try {
        logInfo(`Получаем treeId для проекта ${projectId} (проверяем кэш)`); // Логирование шага
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
                throw new Error(`treeId не найден для проекта ${projectId}`);
            }

            cache.set(treeCacheKey, treeId); // Кэшируем treeId
            logInfo(`Найден и закэширован treeId ${treeId} для проекта ${projectId}`); // Логирование успеха
        } else {
            logInfo(`Используем закэшированный treeId ${treeId} для проекта ${projectId}`); // Логирование кэширования
        }

        return parseInt(treeId, 10);
    } catch (error) {
        logError(`Ошибка при получении treeId для проекта ${projectId}: ${error.message}`, error.stack || '');
        throw error;
    }
}

/**
 * Создание тест-плана
 * @param {Object} req - Объект запроса Express с данными для тест-плана
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 */
export async function createTestPlan(req, res) {
    const { projectId, jiraLink, componentMappings } = req.body;

    try {
        if (!projectId || !jiraLink || !componentMappings) {
            return res.status(400).json({ error: 'Необходимо указать projectId, jiraLink и componentMappings.' });
        }

        // Логируем входные данные для отладки
        logInfo(`Входные данные для создания тест-плана: projectId=${projectId}, jiraLink=${jiraLink}, componentMappings=${JSON.stringify(componentMappings)}`);

        // Собираем все уникальные folderIds из componentMappings
        const allFolderIds = new Set();
        Object.values(componentMappings).forEach(folderIds => {
            if (!Array.isArray(folderIds)) {
                logWarn(`componentMappings содержит некорректные данные для какого-то компонента: ${JSON.stringify(componentMappings)}`);
                throw new Error('Некорректный формат componentMappings: folderIds должны быть массивом');
            }
            folderIds.forEach(id => allFolderIds.add(id));
        });
        const groupsInclude = Array.from(allFolderIds).map(id => {
            const parsedId = parseInt(id, 10);
            if (isNaN(parsedId)) {
                logWarn(`Невозможно преобразовать ID в число: ${id}`);
            }
            return parsedId;
        }).filter(id => !isNaN(id)); // Фильтруем NaN значения

        if (groupsInclude.length === 0) {
            throw new Error('Не найдены группы для включения (groupsInclude пустой)');
        }

        // Получаем динамический treeId для проекта, как в structure.js
        const treeId = await getTreeId(projectId);
        logInfo(`Динамически получен treeId: ${treeId} для projectId: ${projectId}`);

        // Получаем integrationId для Jira с использованием аутентификации
        const integrationUrl = `https://abanking.qatools.cloud/api/integration/suggest?operation=issue_suggest&projectId=${projectId}`;
        logInfo(`Отправляем запрос на ${integrationUrl}`);
        const integrationResponse = await fetchWithAuth(integrationUrl, {
            method: 'GET',
            headers: authHeaders, // Используем заголовки авторизации
        });

        // Логируем и возвращаем оригинальный response
        const loggedIntegrationResponse = await logResponse(integrationResponse, integrationUrl);

        if (!loggedIntegrationResponse.ok) {
            throw new Error(`Не удалось получить integrationId: ${loggedIntegrationResponse.status} - ${loggedIntegrationResponse.statusText}`);
        }

        let integrationData;
        try {
            // Читаем JSON напрямую из оригинального response
            integrationData = await loggedIntegrationResponse.json();
            logInfo(`Полученные данные интеграции: ${JSON.stringify(integrationData)}`);
        } catch (jsonError) {
            throw new Error(`Не удалось разобрать ответ интеграции как JSON: ${jsonError.message}, Response Text: ${await loggedIntegrationResponse.text()}`);
        }

        const jiraIntegration = integrationData.content.find(integration => integration.name === 'Jira');
        if (!jiraIntegration) {
            throw new Error('Интеграция Jira не найдена в ответе API');
        }
        const integrationId = jiraIntegration.id || 67; // Укажи дефолтное значение, если не найден
        logInfo(`Найден integrationId для Jira: ${integrationId}`);

        // Извлекаем имя задачи из jiraLink (например, "SBK-20930" из "https://jira.abanking.ru/browse/SBK-20930")
        const jiraIssueKeyMatch = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
        const jiraIssueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : jiraLink.split('/').pop();
        if (!jiraIssueKey || !/^[A-Z]+-\d+$/.test(jiraIssueKey)) {
            throw new Error(`Некорректный формат jiraLink: ${jiraLink}. Ожидается формат вида https://jira.abanking.ru/browse/CTMM-528`);
        }
        logInfo(`Извлечён jiraIssueKey: ${jiraIssueKey}`);

        // Формируем тело запроса для создания тест-плана
        const requestBody = {
            selection: {
                inverted: false,
                groupsInclude,
                groupsExclude: [],
                testCasesInclude: [],
                testCasesExclude: [],
                leavesInclude: [],
                leavesExclude: [],
                projectId: parseInt(projectId, 10), // Убедимся, что это число
                treeId: treeId, // Используем динамически полученный treeId
                deleted: false,
            },
            launchName: `Регресс тестирование ${jiraIssueKey}`,
            issues: [
                {
                    integrationId,
                    name: jiraIssueKey,
                },
            ],
        };

        // Выводим тело запроса в консоль для проверки в Swagger (опционально, если нужно)
        console.log('Тело запроса для тестирования в Swagger:');
        console.log(JSON.stringify(requestBody, null, 2)); // Форматированный JSON для удобства копирования

        logInfo('Request body for test plan:', JSON.stringify(requestBody));

        // Отправляем POST-запрос для создания тест-плана с аутентификацией
        const testPlanUrl = 'https://abanking.qatools.cloud/api/v2/test-case/bulk/run/new';
        logInfo(`Отправляем запрос на ${testPlanUrl}`);
        const testPlanResponse = await fetchWithAuth(testPlanUrl, {
            method: 'POST',
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        // Логируем запрос перед отправкой
        logInfo(`Отправлен запрос на ${testPlanUrl} с телом: ${JSON.stringify(requestBody)}`);

        // Логируем ответ от API для диагностики
        const loggedTestPlanResponse = await logResponse(testPlanResponse, testPlanUrl, requestBody);

        if (!loggedTestPlanResponse.ok) {
            const errorText = await loggedTestPlanResponse.text();
            throw new Error(`Не удалось создать тест-план: ${loggedTestPlanResponse.status} - ${loggedTestPlanResponse.statusText}, Body: ${errorText}`);
        }

        // Проверяем, что тело ответа не undefined
        let responseData;
        try {
            // Читаем JSON напрямую из оригинального response
            responseData = await loggedTestPlanResponse.json();
            logInfo(`Полученные данные тест-плана: ${JSON.stringify(responseData)}`);
        } catch (jsonError) {
            throw new Error(`Не удалось разобрать ответ как JSON: ${jsonError.message}, Response Text: ${await loggedTestPlanResponse.text()}`);
        }

        // Извлекаем только id из ответа (например, 13947 или 13948)
        const launchId = responseData.id;
        if (!launchId) {
            throw new Error('Поле id не найдено в ответе, данные: ' + JSON.stringify(responseData));
        }

        logInfo(`Тест-план успешно создан для проекта ${projectId}, Launch ID: ${launchId}`);
        res.status(200).json({ id: launchId }); // Возвращаем только id для клиента
    } catch (error) {
        const errorMessage = error.message || 'Неизвестная ошибка';
        const errorDetails = error.stack || '';
        logError(`Ошибка при создании тест-плана для проекта ${projectId}: ${errorMessage}`, errorDetails);
        res.status(500).json({ error: 'Произошла ошибка при создании тест-плана.', details: errorMessage });
    }
}