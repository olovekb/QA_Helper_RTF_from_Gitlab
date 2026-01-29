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

        // Логируем входные данные
        logInfo(`Входные данные для создания тест-плана: projectId=${projectId}, jiraLink=${jiraLink}, componentMappings length=${Object.keys(componentMappings).length}`);

        // Собираем все уникальные folderIds из componentMappings
        const allFolderIds = new Set();
        Object.values(componentMappings).forEach(folderIds => {
            if (!Array.isArray(folderIds)) {
                logWarn(`componentMappings содержит некорректные данные: ${JSON.stringify(componentMappings)}`);
                throw new Error('Некорректный формат componentMappings: folderIds должны быть массивом');
            }
            folderIds.forEach(id => allFolderIds.add(id));
        });

        const groupsInclude = Array.from(allFolderIds)
            .map(id => {
                const parsedId = parseInt(id, 10);
                if (isNaN(parsedId)) logWarn(`Невозможно преобразовать ID в число: ${id}`);
                return parsedId;
            })
            .filter(id => !isNaN(id));

        if (groupsInclude.length === 0) {
            throw new Error('Не найдены группы для включения (groupsInclude пустой)');
        }

        // Получаем treeId
        const treeId = await getTreeId(projectId);
        logInfo(`Динамически получен treeId: ${treeId} для projectId: ${projectId}`);

        // Получаем integrationId для Jira
        const integrationUrl = `${config.allureBaseUrl}/api/integration/suggest?operation=issue_suggest&projectId=${projectId}`;
        const integrationResponse = await fetchWithAuth(integrationUrl, { method: 'GET', headers: authHeaders });

        // Читаем тело ответа интеграции один раз
        const integrationText = await integrationResponse.text();
        logInfo(`Ответ интеграции: Status ${integrationResponse.status}`);

        if (!integrationResponse.ok) {
            throw new Error(`Не удалось получить integrationId: ${integrationResponse.status} - ${integrationResponse.statusText}`);
        }

        let integrationData;
        try {
            integrationData = JSON.parse(integrationText);
        } catch (e) {
            throw new Error(`Не удалось разобрать ответ интеграции как JSON: ${e.message}`);
        }

        const jiraIntegration = integrationData.content.find(integration => integration.name === 'Jira');
        // Используем 67 как дефолт, если не найдено
        const integrationId = jiraIntegration ? jiraIntegration.id : 67;
        logInfo(`Найден integrationId для Jira: ${integrationId}`);

        // Извлекаем имя задачи
        const jiraIssueKeyMatch = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
        const jiraIssueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : jiraLink.split('/').pop();
        if (!jiraIssueKey || !/^[A-Z]+-\d+$/.test(jiraIssueKey)) {
            throw new Error(`Некорректный формат jiraLink: ${jiraLink}`);
        }
        logInfo(`Извлечён jiraIssueKey: ${jiraIssueKey}`);

        // --- УМНАЯ СТРАТЕГИЯ ВЫБОРКИ ---
        let selection;
        const THRESHOLD = 100; // Порог переключения на стратегию "Весь проект"

        if (groupsInclude.length > THRESHOLD) {
            logInfo(`Оптимизация: Слишком много групп (${groupsInclude.length}). Переключаемся на inverted: true (Весь проект) для предотвращения таймаутов.`);
            selection = {
                inverted: true,
                groupsInclude: [], // Пустой список при inverted: true = Все тесты проекта
                groupsExclude: [],
                testCasesInclude: [],
                testCasesExclude: [],
                leavesInclude: [],
                leavesExclude: [],
                projectId: parseInt(projectId, 10),
                treeId: treeId,
                deleted: false,
            };
        } else {
            // Стандартная стратегия для небольших выборок
            selection = {
                inverted: false,
                groupsInclude,
                groupsExclude: [],
                testCasesInclude: [],
                testCasesExclude: [],
                leavesInclude: [],
                leavesExclude: [],
                projectId: parseInt(projectId, 10),
                treeId: treeId,
                deleted: false,
            };
        }

        // Формируем тело запроса
        let requestBody = {
            selection: selection,
            launchName: `Регресс тестирование ${jiraIssueKey}`,
            issues: [{ integrationId, name: jiraIssueKey }],
        };

        logInfo('Request body for test plan (initial size):', JSON.stringify(requestBody).length);

        // --- ПЕРВЫЙ ЗАПРОС НА СОЗДАНИЕ (С РЕТРАЯМИ) ---
        const testPlanUrl = `${config.allureBaseUrl}/api/v2/test-case/bulk/run/new`;
        logInfo(`Отправляем запрос на ${testPlanUrl}`);

        let testPlanResponse;
        let responseText;
        const MAX_RETRIES = 3; // Максимальное количество попыток

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                testPlanResponse = await fetchWithAuth(testPlanUrl, {
                    method: 'POST',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                });

                // Читаем тело ответа сразу (ОДИН РАЗ)
                responseText = await testPlanResponse.text();

                // Если статус 504/502 и попытки еще есть — ждем и идем на следующий круг
                if ((testPlanResponse.status === 504 || testPlanResponse.status === 502) && attempt < MAX_RETRIES) {
                    logWarn(`Попытка ${attempt} завершилась ошибкой ${testPlanResponse.status}. Ждем 3 секунды и повторяем...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }

                // Если статус не 504/502 или попытки кончились — выходим из цикла
                logInfo(`Ответ от ${testPlanUrl} (Попытка ${attempt}): Status ${testPlanResponse.status}, Body length: ${responseText.length}`);
                break;

            } catch (networkError) {
                // Обработка сетевых сбоев (когда fetch падает с исключением)
                logWarn(`Сетевая ошибка при попытке ${attempt}: ${networkError.message}`);
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }
                throw networkError;
            }
        }

        let responseData;

        // Обработка ошибок первого запроса
        if (!testPlanResponse.ok) {
            // Если после всех попыток все равно 504/502
            if (testPlanResponse.status === 504 || testPlanResponse.status === 502) {
                throw new Error(`Allure TestOps Unavailable (${testPlanResponse.status}). Сервер перегружен или недоступен.`);
            }

            let errorData = {};
            try {
                errorData = JSON.parse(responseText);
            } catch (e) {
                // Если не JSON (например, HTML от Nginx), оставляем errorData пустым
                logWarn('Ответ об ошибке не является валидным JSON');
            }

            // Сценарий 1: Ошибка jobsMapping
            if (errorData.errors && errorData.errors.some(error => error.field === 'jobsMapping' && error.defaultMessage === 'test-case-bulk.no-job-assigned')) {
                logWarn('Обнаружена ошибка jobsMapping. Получаем и устанавливаем jobId...');

                const jobId = await getJobId(projectId);
                await setJobsMapping(projectId, treeId, jobId);

                // Обновляем тело запроса
                requestBody = {
                    ...requestBody,
                    jobsMapping: [{ toId: jobId }],
                };

                logInfo('Повторная отправка запроса с jobsMapping...');

                // Даем серверу небольшую паузу перед повторным запросом
                await new Promise(r => setTimeout(r, 1000));

                // Повторный запрос (без цикла ретраев, считаем что одного раза хватит после фикса)
                testPlanResponse = await fetchWithAuth(testPlanUrl, {
                    method: 'POST',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                });

                responseText = await testPlanResponse.text();
                logInfo(`Ответ повторного запроса: Status ${testPlanResponse.status}`);

                if (!testPlanResponse.ok) {
                    if (testPlanResponse.status === 504 || testPlanResponse.status === 502) {
                        throw new Error(`Allure TestOps Timeout (${testPlanResponse.status}) при повторном запросе.`);
                    }
                    throw new Error(`Не удалось создать тест-план (повторно): ${testPlanResponse.status}, Body: ${responseText}`);
                }
            }
            // Сценарий 2: Пустая выборка
            else if (errorData.errors && errorData.errors.some(error => error.field === 'selection' && error.defaultMessage === 'test-case-bulk.nothing-to-run')) {
                return res.status(400).json({ error: 'На выбранных блоках отсутствуют тест-кейсы. Добавьте хотя бы один для создания тест-плана.' });
            }
            // Сценарий 3: Прочие ошибки
            else {
                throw new Error(`Не удалось создать тест-план: ${testPlanResponse.status} - ${testPlanResponse.statusText}, Body: ${responseText}`);
            }
        }

        // Парсим успешный ответ (из уже прочитанного текста)
        try {
            responseData = JSON.parse(responseText);
        } catch (jsonError) {
            throw new Error(`Не удалось разобрать успешный ответ как JSON: ${jsonError.message}`);
        }

        const launchId = responseData.id;
        if (!launchId) {
            throw new Error('Поле id не найдено в ответе: ' + JSON.stringify(responseData));
        }

        // Сохраняем связи Page -> компоненты
        if (pageDependencies && pageDependencies.length > 0) {
            try {
                await savePageComponentDependencies(projectId, pageDependencies);
                logInfo(`Сохранены связи Page -> компоненты для проекта ${projectId}`);
            } catch (depError) {
                logWarn(`Ошибка при сохранении связей: ${depError.message}`);
            }
        }

        logInfo(`Тест-план успешно создан, Launch ID: ${launchId}`);
        res.status(200).json({ id: launchId });

    } catch (error) {
        const errorMessage = error.message || 'Неизвестная ошибка';
        const errorDetails = error.stack || '';
        logError(`Ошибка при создании тест-плана для проекта ${projectId}: ${errorMessage}`, errorDetails);
        res.status(500).json({ error: 'Произошла ошибка при создании тест-плана.', details: errorMessage });
    }
}
