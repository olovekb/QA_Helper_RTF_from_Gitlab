import { fetchWithAuth, authHeaders, buildTestCaseTreeEntityUrl, getTestCaseTreeEntityContent } from '../utils/allureAuth.js';
import config from '../config/index.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { savePageComponentDependencies } from './components.js';
import databasePool from '../db/pool.js';
import { resolveGroupPathFromDb } from '../utils/testCaseTreeEntity.js';


const cache = new Map();

async function logResponse(response, url, requestBody = null) {
    const clonedResponse = response.clone();
    let responseText = '';
    try {
        responseText = await clonedResponse.text();
    } catch (error) {
        logWarn(`Не удалось получить текст ответа от ${url}: ${error.message}`);
        responseText = 'Не удалось прочитать тело ответа';
    }
    logInfo(`Ответ от ${url}: Status ${response.status}, Body: ${responseText}`);
    if (requestBody) {
        logInfo(`Запрос на ${url} с телом: ${JSON.stringify(requestBody)}`);
    }
    return response;
}

/**
 * Рекурсивное получение всех тк для группы
 * @param {string} projectId
 * @param {string} treeId
 * @param {string} parentNodeId
 * @param {string} mode
 * @returns {Promise<Array<number>>}
 */
async function fetchLeafTestCasesRecursive(projectId, treeId, parentNodeId, mode = 'FULL') {
    const pathToGroup = await resolveGroupPathFromDb(projectId, parentNodeId);
    const allTestCaseIds = [];

    async function collect(pathToFolder, isInitial = false) {
        try {
            const url = buildTestCaseTreeEntityUrl(config.allureBaseUrl, {
                projectId,
                treeId,
                page: 0,
                size: 1000,
                pathPrefix: pathToFolder,
            });
            const res = await fetchWithAuth(url, { headers: authHeaders });
            if (!res.ok) {
                logWarn(`Failed to fetch nodes for path ${JSON.stringify(pathToFolder)} (tree ${treeId}): ${res.status}`);
                return;
            }

            const data = await res.json();
            const children = getTestCaseTreeEntityContent(data);

            for (const child of children) {
                if (child.type === 'LEAF' && child.testCaseId) {
                    allTestCaseIds.push(child.testCaseId);
                } else if (child.type === 'GROUP') {
                    if (mode === 'FULL') {
                        await collect([...pathToFolder, Number(child.id)]);
                    } else if (mode === 'SELECTIVE' && isInitial) {
                        logInfo(`Selective search: skipping nested group ${child.id} (${child.name})`);
                    } else if (mode === 'SELECTIVE' && !isInitial) {
                    }
                }
            }
        } catch (err) {
            logError(`Error in recursive collection for path ${JSON.stringify(pathToFolder)}: ${err.message}`);
        }
    }

    await collect(pathToGroup, true);
    return [...new Set(allTestCaseIds)];
}

/**
 * Получение treeId для проекта
 * @param {string} projectId - Идентификатор проекта
 * @returns {Promise<number>} - treeId проекта
 */
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
                logError(`Ошибка получения treeId для проекта ${projectId}: ${treeResponse.statusText}`, errorMessage); // Логирование ошибки
                throw new Error(`Не удалось получить treeId: ${treeResponse.statusText} - ${errorMessage}`);
            }

            const treeData = await treeResponse.json();
            logInfo(`Ответ от /api/tree для projectId ${projectId}:`, JSON.stringify(treeData));
            const nocodeProjectIds = ['1', '307', '377'];
            let structureTree = null;
            if (nocodeProjectIds.includes(String(projectId))) {
                structureTree = treeData.content?.find(item => item.name === "Global Structure");
                if (!structureTree) {
                    structureTree = treeData.content?.find(item => item.name === "Structure");
                }
            } else {
                structureTree = treeData.content?.find(item => item.name === "Structure");
            }

            if (structureTree && structureTree.id) {
                treeId = structureTree.id;
                logInfo(`Найден treeId ${treeId} для проекта ${projectId} с name: "${structureTree.name}"`);
            } else {
                treeId = treeData.content?.[0]?.id || 0;
                logWarn(`Специфичный treeId ("Structure"/"Global Structure") не найден для проекта ${projectId}, используем fallback ${treeId} (name: ${treeData.content?.[0]?.name})`);
            }

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
            headers: authHeaders,
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
 * Создание тест-плана (запуска)
 * @param {Object} req - Объект запроса Express с данными для тест-плана
 * @param {Object} res - Объект ответа Express
 * @returns {void}
 *
 * Поддерживаемые параметры body:
 * - projectId (обязательный)
 * - componentMappings (обязательный, если не передан groupsInclude)
 * - jiraLink (опциональный)
 * - pageDependencies (опциональный)
 * - launchName (опциональный) - кастомное название запуска
 * - groupsInclude (опциональный) - явный список ID групп (для split-режима)
 */
export async function createTestPlan(req, res) {
    const {
        projectId,
        jiraLink,
        componentMappings,
        pageDependencies,
        launchName: customLaunchName,
        groupsInclude: explicitGroupsInclude
    } = req.body;

    try {
        if (!projectId) {
            return res.status(400).json({
                error: 'Необходимо указать projectId.',
                code: 'MISSING_PARAMETERS'
            });
        }

        if (!componentMappings && (!explicitGroupsInclude || explicitGroupsInclude.length === 0)) {
            return res.status(400).json({
                error: 'Необходимо указать componentMappings или groupsInclude.',
                code: 'MISSING_PARAMETERS'
            });
        }

        logInfo(`Входные данные: projectId=${projectId}, jiraLink=${jiraLink || 'не указана'}, customName=${customLaunchName || 'нет'}, explicitGroups=${explicitGroupsInclude ? explicitGroupsInclude.length : 'нет'}`);

        let groupsInclude;
        let leavesInclude = [];

        if (explicitGroupsInclude && explicitGroupsInclude.length > 0) {
            groupsInclude = explicitGroupsInclude.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
            logInfo(`Используем явные groupsInclude: ${groupsInclude.length} групп`);

            const treeId = await getTreeId(projectId);

            try {
                logInfo(`Начинаем получение листовых тест-кейсов для ${groupsInclude.length} групп (умный поиск)...`);

                const fbMetaData = await databasePool('functional_blocks')
                    .select('allure_id', 'custom_field_name')
                    .whereIn('allure_id', groupsInclude.map(id => id.toString()))
                    .andWhere('project_id', projectId);

                const typeMap = new Map();
                fbMetaData.forEach(fb => typeMap.set(fb.allure_id, fb.custom_field_name));

                const leafPromises = groupsInclude.map(async (groupId) => {
                    const type = typeMap.get(groupId.toString());
                    const isFull = !type || ['Feature', 'Code', 'Block', 'Scenario', 'Сценарий'].includes(type);
                    const mode = isFull ? 'FULL' : 'SELECTIVE';

                    logInfo(`Группа ${groupId} (type: ${type || 'unknown'}): mode=${mode}`);
                    return fetchLeafTestCasesRecursive(projectId, treeId, groupId, mode);
                });

                const leafArrays = await Promise.all(leafPromises);
                leavesInclude = leafArrays.flat();
                logInfo(`✓ Получено ${leavesInclude.length} уникальных TestCaseID из ${groupsInclude.length} групп (с учетом правил)`);

                if (leavesInclude.length === 0) {
                    logWarn(`⚠ Не удалось получить листовые тест-кейсы. Используем groupsInclude как fallback.`);
                }
            } catch (leafError) {
                logError(`⚠ Критическая ошибка при получении листовых тест-кейсов: ${leafError.message}. Используем groupsInclude как fallback.`);
                leavesInclude = [];
            }
        } else {
            const allFolderIds = new Set();
            Object.values(componentMappings).forEach(folderIds => {
                if (Array.isArray(folderIds)) {
                    folderIds.forEach(id => allFolderIds.add(parseInt(id, 10)));
                }
            });
            groupsInclude = Array.from(allFolderIds).filter(id => !isNaN(id));
            logInfo(`Вычислены groupsInclude из mappings: ${groupsInclude.length} групп`);

            try {
                const treeId = await getTreeId(projectId);
                logInfo(`Получаем листовые тест-кейсы для legacy-режима (${groupsInclude.length} групп)...`);

                const fbMetaData = await databasePool('functional_blocks')
                    .select('allure_id', 'custom_field_name')
                    .whereIn('allure_id', groupsInclude.map(id => id.toString()))
                    .andWhere('project_id', projectId);

                const typeMap = new Map();
                fbMetaData.forEach(fb => typeMap.set(fb.allure_id, fb.custom_field_name));

                const leafPromises = groupsInclude.map(groupId => {
                    const type = typeMap.get(groupId.toString());
                    const isFull = !type || ['Feature', 'Code', 'Block', 'Scenario', 'Сценарий'].includes(type);
                    const mode = isFull ? 'FULL' : 'SELECTIVE';
                    return fetchLeafTestCasesRecursive(projectId, treeId, groupId, mode);
                });

                const leafArrays = await Promise.all(leafPromises);
                leavesInclude = leafArrays.flat();
                logInfo(`✓ Legacy: Получено ${leavesInclude.length} уникальных TestCaseID (с учетом правил)`);
            } catch (e) {
                logWarn(`⚠ Ошибка поиска тестов в legacy-режиме: ${e.message}`);
            }
        }

        if (groupsInclude.length === 0) {
            throw new Error('Не найдены группы для запуска (groupsInclude пустой)');
        }

        const allGroupIds = groupsInclude;
        const finalGroupsInclude = leavesInclude.length > 0 ? [] : groupsInclude;
        const finalTestCasesInclude = leavesInclude.length > 0 ? leavesInclude : [];
        const finalLeavesInclude = leavesInclude;

        let jobId = null;
        try {
            jobId = await getJobId(projectId);
            logInfo(`Предварительно получен JobId: ${jobId}`);
        } catch (e) {
            logWarn(`Не удалось получить JobId заранее: ${e.message}. Попробуем без него.`);
        }

        const treeId = await getTreeId(projectId);

        let integrationId = 67;
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

        let launchName;
        let issues = [];

        if (jiraLink) {
            const jiraIssueKeyMatch = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
            const jiraIssueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : jiraLink.split('/').pop();
            issues = [{ integrationId, name: jiraIssueKey }];
            logInfo(`✓ Извлечен Jira issue key: ${jiraIssueKey}`);
        }

        if (customLaunchName) {
            launchName = customLaunchName;
            logInfo(`Используем кастомное название запуска: ${launchName}`);
        } else if (jiraLink && issues.length > 0) {
            launchName = `Регресс тестирование ${issues[0].name}`;
        } else {
            const today = new Date().toLocaleDateString('ru-RU');
            launchName = `Регресс тестирование ${today}`;
        }

        let requestBody = {
            selection: {
                inverted: false,
                groupsInclude: finalGroupsInclude,
                groupsExclude: [],
                testCasesInclude: finalTestCasesInclude,
                testCasesExclude: [],
                leavesInclude: finalLeavesInclude,
                leavesExclude: [],
                projectId: parseInt(projectId, 10),
                treeId: treeId,
                deleted: false,
            },
            launchName,
            issues,
        };

        if (finalLeavesInclude.length > 0) {
            logInfo(`Используем LEAF STRATEGY: ${finalLeavesInclude.length} точных тест-кейсов`);
        } else {
            logInfo(`Используем GROUP STRATEGY (fallback): ${finalGroupsInclude.length} групп`);
        }

        if (jobId) {
            requestBody.jobsMapping = [{ toId: jobId }];

            try {
                await setJobsMapping(projectId, treeId, jobId);
            } catch (e) {
                logWarn('Не удалось предварительно установить jobsMapping, надеемся на body');
            }
        }

        logInfo(`Отправляем запрос создания лаунча (Групп: ${finalGroupsInclude.length}, Тестов: ${finalTestCasesInclude.length}). Body: ${JSON.stringify(requestBody)}`);

        const testPlanUrl = `${config.allureBaseUrl}/api/v2/test-case/bulk/run/new`;
        let testPlanResponse;
        let responseText;
        const MAX_RETRIES = 2;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                testPlanResponse = await fetchWithAuth(testPlanUrl, {
                    method: 'POST',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                });

                responseText = await testPlanResponse.text();

                if (testPlanResponse.ok) break;

                if ([502, 503, 504].includes(testPlanResponse.status) && attempt < MAX_RETRIES) {
                    logWarn(`Попытка ${attempt} неудачна (${testPlanResponse.status}). Ждем 5 сек...`);
                    await new Promise(r => setTimeout(r, 5000));
                    continue;
                }
                break;
            } catch (e) {
                logWarn(`Сетевая ошибка: ${e.message}`);
                if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 5000));
                else throw e;
            }
        }

        if (!testPlanResponse.ok) {
            let errorData = {};
            try { errorData = JSON.parse(responseText); } catch (e) { }
            const isNothingToRun = (errorData.message && errorData.message.includes('test-case-bulk.nothing-to-run')) ||
                (errorData.errors && errorData.errors.some(e => e.defaultMessage && e.defaultMessage.includes('test-case-bulk.nothing-to-run')));

            if (isNothingToRun) {
                if (requestBody.jobsMapping) {
                    logWarn('Получена ошибка nothing-to-run при наличии jobsMapping. Пробуем создать запуск БЕЗ привязки к джобе...');
                    delete requestBody.jobsMapping;

                    try {
                        const retryResponse = await fetchWithAuth(testPlanUrl, {
                            method: 'POST',
                            headers: { ...authHeaders, 'Content-Type': 'application/json' },
                            body: JSON.stringify(requestBody),
                        });
                        const retryText = await retryResponse.text();
                        if (retryResponse.ok) {
                            const retryData = JSON.parse(retryText);
                            logInfo(`Успешное создание запуска БЕЗ jobsMapping! ID: ${retryData.id}`);

                            if (pageDependencies && pageDependencies.length > 0) {
                                try {
                                    await savePageComponentDependencies(projectId, pageDependencies);
                                } catch (depError) {
                                    logWarn(`Связи не сохранены (некритично): ${depError.message}`);
                                }
                            }

                            return res.status(200).json({
                                id: retryData.id,
                                warning: 'Запуск создан, но была удалена привязка к CI Job (тесты не были найдены в контексте джобы).'
                            });
                        } else {
                            logError(`Повторная попытка без jobsMapping тоже не удалась: ${retryText}`);
                        }
                    } catch (retryError) {
                        logError(`Ошибка при повторной попытке: ${retryError.message}`);
                    }
                }

                const emptyGroups = [];
                if (allGroupIds.length > 0) {
                    try {
                        const checkPromises = allGroupIds.map(async groupId => {
                            let groupName = `Group ${groupId}`;
                            try {
                                const dbRes = await databasePool('functional_blocks').where({ allure_id: groupId.toString(), project_id: projectId }).first();
                                if (dbRes) groupName = dbRes.name;
                            } catch (e) { }

                            const pathPrefix = await resolveGroupPathFromDb(projectId, groupId);
                            const treeUrl = buildTestCaseTreeEntityUrl(config.allureBaseUrl, {
                                projectId,
                                treeId,
                                page: 0,
                                size: 1,
                                pathPrefix,
                                leaf: true,
                            });
                            const treeRes = await fetchWithAuth(treeUrl, { headers: authHeaders });
                            if (!treeRes.ok) return null;
                            const treeData = await treeRes.json();
                            if (getTestCaseTreeEntityContent(treeData).length === 0) {
                                return { id: groupId, name: groupName };
                            }
                            return null;
                        });

                        const results = await Promise.all(checkPromises);
                        results.filter(g => g).forEach(g => emptyGroups.push(g));

                    } catch (checkErr) {
                        logError(`Ошибка при проверке пустых групп: ${checkErr.message}`);
                    }
                }

                const finalEmptyGroups = emptyGroups.length > 0 ? emptyGroups : await Promise.all(allGroupIds.map(async id => {
                    let groupName = `Группа #${id}`;
                    try {
                        const dbRes = await databasePool('functional_blocks')
                            .where({ allure_id: id.toString(), project_id: projectId })
                            .orWhere({ allure_id: id, project_id: projectId })
                            .first();
                        if (dbRes) groupName = dbRes.name;
                    } catch (e) { }
                    return { id, name: groupName };
                }));

                return res.status(400).json({
                    error: 'На выбранных блоках отсутствуют тест-кейсы.',
                    code: 'EMPTY_GROUPS',
                    emptyGroups: finalEmptyGroups,
                    details: 'Allure вернул "nothing-to-run". Вероятно, в указанных группах нет тестов.'
                });
            }

            if (errorData.errors && errorData.errors.some(e => e.field === 'jobsMapping')) {
                return res.status(500).json({
                    error: 'Не удалось получить настройки проекта (jobsMapping). Проверьте конфигурацию проекта в Allure.',
                    code: 'JOBS_MAPPING_ERROR',
                    details: errorData.message || 'Требуется jobsMapping'
                });
            }

            logError(`Ошибка создания тест-плана. Status: ${testPlanResponse.status}. Body: ${responseText}`);
            return res.status(testPlanResponse.status).json({
                error: 'Ошибка при создании тест-плана в Allure',
                code: 'ALLURE_API_ERROR',
                details: errorData.message || responseText.substring(0, 500),
                fullResponse: errorData
            });
        }

        const responseData = JSON.parse(responseText);
        logInfo(`Тест-план создан! ID: ${responseData.id}`);

        if (pageDependencies && pageDependencies.length > 0) {
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
