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
        if (!projectId || !componentMappings) {
            return res.status(400).json({
                error: 'Необходимо указать projectId и componentMappings.',
                code: 'MISSING_PARAMETERS'
            });
        }

        logInfo(`Входные данные: projectId=${projectId}, jiraLink=${jiraLink || 'не указана'}, components=${Object.keys(componentMappings).length}`);

        // 1. Собираем ID групп (уникальные)
        const allFolderIds = new Set();
        Object.values(componentMappings).forEach(folderIds => {
            if (Array.isArray(folderIds)) {
                folderIds.forEach(id => allFolderIds.add(parseInt(id, 10)));
            }
        });

        const groupsInclude = Array.from(allFolderIds).filter(id => !isNaN(id));

        if (groupsInclude.length === 0) {
            throw new Error('Не найдены группы для запуска (groupsInclude пустой)');
        }

        // 2. Параллельно получаем TreeID, IntegrationID и JobID (Экономим время и запросы)
        let jobId = null;
        try {
            jobId = await getJobId(projectId);
            logInfo(`Предварительно получен JobId: ${jobId}`);
        } catch (e) {
            logWarn(`Не удалось получить JobId заранее: ${e.message}. Попробуем без него.`);
        }

        // b) Получаем Tree ID
        const treeId = await getTreeId(projectId);

        // c) Получаем Integration ID (Jira)
        let integrationId = 67; // Дефолт
        try {
            const integrationUrl = `${config.allureBaseUrl}/api/integration/suggest?operation=issue_suggest&projectId=${projectId}`;
            const intResp = await fetchWithAuth(integrationUrl, { method: 'GET', headers: authHeaders });
            if (intResp.ok) {
                const intData = await intResp.json();
                const jiraInt = intData.content.find(i => i.name === 'Jira');
                if (jiraInt) integrationId = jiraInt.id;
            }
        } catch (e) {
            logWarn(`Ошибка получения IntegrationID: ${e.message}. Используем дефолт ${integrationId}`);
        }

        // 3. Подготовка Issue Key (если jiraLink указан)
        let launchName = 'Регресс тестирование';
        let issues = [];

        if (jiraLink) {
            const jiraIssueKeyMatch = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
            const jiraIssueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : jiraLink.split('/').pop();
            launchName = `Регресс тестирование ${jiraIssueKey}`;
            issues = [{ integrationId, name: jiraIssueKey }];
        } else {
            // Если задача не указана, добавляем текущую дату
            const today = new Date().toLocaleDateString('ru-RU');
            launchName = `Регресс тестирование ${today}`;
        }

        // 4. Формируем тело запроса (Сразу с jobsMapping!)
        let requestBody = {
            selection: {
                inverted: false, // Explicit list работает стабильнее, чем "Run All"
                groupsInclude,
                groupsExclude: [],
                testCasesInclude: [],
                testCasesExclude: [],
                leavesInclude: [],
                leavesExclude: [],
                projectId: parseInt(projectId, 10),
                treeId: treeId,
                deleted: false,
            },
            launchName,
            issues,
        };

        // Если удалось получить JobID, добавляем его сразу
        if (jobId) {
            requestBody.jobsMapping = [{ toId: jobId }];

            try {
                await setJobsMapping(projectId, treeId, jobId);
            } catch (e) {
                logWarn('Не удалось предварительно установить jobsMapping, надеемся на body');
            }
        }

        logInfo(`Отправляем запрос создания лаунча (Групп: ${groupsInclude.length})`);

        // 5. Отправка запроса с Retry (на случай сетевых морганий)
        const testPlanUrl = `${config.allureBaseUrl}/api/v2/test-case/bulk/run/new`;
        let testPlanResponse;
        let responseText;
        const MAX_RETRIES = 2; // Меньше ретраев, чтобы не дудосить

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                testPlanResponse = await fetchWithAuth(testPlanUrl, {
                    method: 'POST',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                });

                responseText = await testPlanResponse.text();

                if (testPlanResponse.ok) break; // Успех!

                // Если 504/502 - ждем и пробуем еще раз
                if ([502, 503, 504].includes(testPlanResponse.status) && attempt < MAX_RETRIES) {
                    logWarn(`Попытка ${attempt} неудачна (${testPlanResponse.status}). Ждем 5 сек...`);
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                break; // Иначе выходим и обрабатываем ошибку
            } catch (e) {
                logWarn(`Сетевая ошибка: ${e.message}`);
                if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 5000));
                else throw e;
            }
        }

        // 6. Обработка результата
        if (!testPlanResponse.ok) {
            // Если все равно ошибка, пробуем последний шанс - распарсить ошибку jobsMapping
            // (вдруг мы не смогли получить jobId на шаге 2a)
            let errorData = {};
            try { errorData = JSON.parse(responseText); } catch (e) { }

            // Проверка на отсутствие тест-кейсов (специфическая ошибка от Allure)
            if (errorData.message && errorData.message.includes('test-case-bulk.nothing-to-run')) {
                return res.status(400).json({
                    error: 'На выбранных блоках отсутствуют тест-кейсы. Добавьте хотя бы один для возможности создания тест-плана.',
                    code: 'NO_TEST_CASES'
                });
            }

            if (errorData.errors && errorData.errors.some(e => e.field === 'jobsMapping')) {
                // Этого происходить не должно, так как мы получили jobId на шаге 2a.
                // Но если случилось - кидаем ошибку, ретраить смысла нет, сервер устал.
                return res.status(500).json({
                    error: 'Не удалось получить настройки проекта (jobsMapping). Проверьте конфигурацию проекта в Allure.',
                    code: 'JOBS_MAPPING_ERROR',
                    details: errorData.message || 'Требуется jobsMapping'
                });
            }

            // Общая ошибка от Allure с деталями
            return res.status(testPlanResponse.status).json({
                error: 'Ошибка при создании тест-плана в Allure',
                code: 'ALLURE_API_ERROR',
                details: errorData.message || responseText.substring(0, 200)
            });
        }

        // 7. Успех
        const responseData = JSON.parse(responseText);
        logInfo(`Тест-план создан! ID: ${responseData.id}`);

        // 8. Сохраняем связи (асинхронно, не блокируем ответ, но логируем ошибку если что)
        if (pageDependencies && pageDependencies.length > 0) {
            // Запускаем без await, чтобы быстрее отдать ответ клиенту? 
            // Нет, лучше подождать, чтобы гарантировать консистентность, но обернуть в try
            try {
                await savePageComponentDependencies(projectId, pageDependencies);
            } catch (depError) {
                logWarn(`Связи не сохранены (некритично): ${depError.message}`);
            }
        }

        res.status(200).json({ id: responseData.id });

    } catch (error) {
        logError(`FATAL error createTestPlan: ${error.message}`);
        res.status(500).json({ error: 'Ошибка создания тест-плана', details: error.message });
    }
}

