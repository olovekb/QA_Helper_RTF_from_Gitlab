import { fetchWithAuth, authHeaders } from '../utils/allureAuth.js'; // Импорт утилит для аутентификации
import config from '../config/index.js'; // Импорт конфигурации проекта
import { logError, logInfo, logWarn } from '../utils/logger.js'; // Импорт логгера
import { savePageComponentDependencies } from './components.js'; // Импорт функции для сохранения связей Page -> компоненты


// Глобальный кэш для хранения результатов запросов
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
 * Получение treeId для проекта
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
 * Получение jobId для проекта
 * @param {string} projectId - Идентификатор проекта
 * @returns {Promise<number>} - jobId проекта
 */
async function getJobId(projectId) {
    try {
        const jobSuggestUrl = `${config.allureBaseUrl}/api/job/suggest?projectId=${projectId}&size=20`;
        logInfo(`Отправляем запрос на ${jobSuggestUrl} для получения jobId`);

        const jobResponse = await fetchWithAuth(jobSuggestUrl, {
            method: 'GET',
            headers: authHeaders, // Используем заголовки авторизации
        });

        await logResponse(jobResponse, jobSuggestUrl);

        if (!jobResponse.ok) {
            throw new Error(`Не удалось получить jobId: ${jobResponse.status} - ${jobResponse.statusText}`);
        }

        const jobData = await jobResponse.json();
        logInfo(`Полученные данные job: ${JSON.stringify(jobData)}`);

        const job = jobData.content?.[0];
        if (!job || !job.id) {
            throw new Error('Job не найден в ответе API');
        }

        const jobId = job.id;
        logInfo(`Найден jobId: ${jobId} для проекта ${projectId}`);
        return jobId;
    } catch (error) {
        logError(`Ошибка при получении jobId для проекта ${projectId}: ${error.message}`, error.stack || '');
        throw error;
    }
}

/**
 * Установка jobsMapping для тест-кейсов
 * @param {number} projectId - Идентификатор проекта
 * @param {number} treeId - Идентификатор дерева
 * @param {number} jobId - Идентификатор джобы
 * @returns {Promise<void>}
 */
async function setJobsMapping(projectId, treeId, jobId) {
    try {
        const statsUrl = `${config.allureBaseUrl}/api/v2/test-case/bulk/job/stats`;
        const requestBody = {
            selection: {
                inverted: true,
                groupsInclude: [],
                groupsExclude: [],
                testCasesInclude: [],
                testCasesExclude: [],
                leavesInclude: [],
                leavesExclude: [],
                projectId: parseInt(projectId, 10),
                treeId: parseInt(treeId, 10),
                deleted: false,
            },
            jobsMapping: [
                {
                    toId: jobId,
                },
            ],
        };

        logInfo(`Отправляем запрос на ${statsUrl} с телом: ${JSON.stringify(requestBody)}`);
        const statsResponse = await fetchWithAuth(statsUrl, {
            method: 'POST',
            headers: {
                ...authHeaders,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        await logResponse(statsResponse, statsUrl, requestBody);

        if (!statsResponse.ok) {
            const errorText = await statsResponse.text();
            throw new Error(`Не удалось установить jobsMapping: ${statsResponse.status} - ${statsResponse.statusText}, Body: ${errorText}`);
        }

        logInfo(`Успешно установлено jobsMapping для проекта ${projectId} с jobId ${jobId}`);
    } catch (error) {
        logError(`Ошибка при установке jobsMapping для проекта ${projectId}: ${error.message}`, error.stack || '');
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
    const { projectId, jiraLink, componentMappings, pageDependencies } = req.body;

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

        // Получаем динамический treeId для проекта
        const treeId = await getTreeId(projectId);
        logInfo(`Динамически получен treeId: ${treeId} для projectId: ${projectId}`);

        // Получаем integrationId для Jira с использованием аутентификации
        const integrationUrl = `${config.allureBaseUrl}/api/integration/suggest?operation=issue_suggest&projectId=${projectId}`;
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
        let requestBody = {
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

        logInfo('Request body for test plan (initial):', JSON.stringify(requestBody));

        // Отправляем POST-запрос для создания тест-плана с аутентификацией
        const testPlanUrl = `${config.allureBaseUrl}/api/v2/test-case/bulk/run/new`;
        logInfo(`Отправляем запрос на ${testPlanUrl}`);
        let testPlanResponse = await fetchWithAuth(testPlanUrl, {
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
        await logResponse(testPlanResponse, testPlanUrl, requestBody);

        let responseData;
        try {
            if (!testPlanResponse.ok) {
                const errorText = await testPlanResponse.text();
                const errorData = JSON.parse(errorText); // Парсим текст ошибки как JSON

                // Проверяем, есть ли ошибка jobsMapping
                if (errorData.errors && errorData.errors.some(error => error.field === 'jobsMapping' && error.defaultMessage === 'test-case-bulk.no-job-assigned')) {
                    logWarn('Обнаружена ошибка jobsMapping. Получаем и устанавливаем jobId...');

                    // Получаем jobId для проекта
                    const jobId = await getJobId(projectId);

                    // Устанавливаем jobsMapping
                    await setJobsMapping(projectId, treeId, jobId);

                    // Повторно формируем запрос с jobsMapping
                    requestBody = {
                        ...requestBody,
                        jobsMapping: [
                            {
                                toId: jobId,
                            },
                        ],
                    };

                    logInfo('Request body for test plan (with jobsMapping):', JSON.stringify(requestBody));

                    // Повторно отправляем запрос на создание тест-плана
                    testPlanResponse = await fetchWithAuth(testPlanUrl, {
                        method: 'POST',
                        headers: {
                            ...authHeaders,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(requestBody),
                    });

                    // Логируем повторный запрос
                    logInfo(`Повторный запрос на ${testPlanUrl} с телом: ${JSON.stringify(requestBody)}`);
                    await logResponse(testPlanResponse, testPlanUrl, requestBody);
                } else if (errorData.errors && errorData.errors.some(error => error.field === 'selection' && error.defaultMessage === 'test-case-bulk.nothing-to-run')) {
                    // Возвращаем точное сообщение для клиента
                    return res.status(400).json({ error: 'На выбранных блоках отсутствуют тест-кейсы. Добавьте хотя бы один для возможности создания тест-плана.' });
                } else {
                    throw new Error(`Не удалось создать тест-план: ${testPlanResponse.status} - ${testPlanResponse.statusText}, Body: ${errorText}`);
                }
            }

            // Проверяем, что тело ответа не undefined
            responseData = await testPlanResponse.json();
            logInfo(`Полученные данные тест-плана: ${JSON.stringify(responseData)}`);
        } catch (jsonError) {
            throw new Error(`Не удалось разобрать ответ как JSON: ${jsonError.message}, Response Text: ${await testPlanResponse.text()}`);
        }

        // Извлекаем только id из ответа
        const launchId = responseData.id;
        if (!launchId) {
            throw new Error('Поле id не найдено в ответе, данные: ' + JSON.stringify(responseData));
        }

        // Сохраняем связи Page -> компоненты, если они переданы
        if (pageDependencies && pageDependencies.length > 0) {
            try {
                await savePageComponentDependencies(projectId, pageDependencies);
                logInfo(`Сохранены связи Page -> компоненты для проекта ${projectId}`);
            } catch (depError) {
                logWarn(`Ошибка при сохранении связей Page -> компоненты: ${depError.message}`);
                // Не прерываем создание тест-плана, если сохранение связей не удалось
            }
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