import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Select from 'react-select'; // Импортируем react-select для мультиселекта
import { useNavigate } from 'react-router-dom'; // Для навигации назад
import styles from './styles'; // Импортируем стили
import Loader from './Loader'; // Предполагаем, что есть компонент Loader
import config from './config';
import GlobalBackgroundProgress from './components/GlobalBackgroundProgress';

const TIAPage = ({ projects }) => {
    const [projectId, setProjectId] = useState('');
    const [frontendJSON, setFrontendJSON] = useState(null);
    const [backendJSON, setBackendJSON] = useState(null);
    const [jiraLink, setJiraLink] = useState('');
    const [folders, setFolders] = useState([]);
    const [expandedFolders, setExpandedFolders] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingState, setLoadingState] = useState({ launch: false, testplan: false }); // Раздельные состояния загрузки
    const [progress, setProgress] = useState(null); // Состояние прогресса { current, total, message }
    const [structureLoading, setStructureLoading] = useState(false); // Лоудер для загрузки блоков
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [allureLink, setAllureLink] = useState('');
    const [isPartialSaving, setIsPartialSaving] = useState(false);
    const [partialSaveMessage, setPartialSaveMessage] = useState('');
    const [tiaReport, setTiaReport] = useState(null); // Новый формат TIA
    const [tiaFileName, setTiaFileName] = useState('');
    const [mode, setMode] = useState('mapping'); // mapping | light
    const [expandedDetails, setExpandedDetails] = useState({});
    const [expandedPageComponents, setExpandedPageComponents] = useState({});
    const [expandedUniqueComponents, setExpandedUniqueComponents] = useState({});
    const [selectedComponentId, setSelectedComponentId] = useState(null); // Выбранный компонент для маппинга
    const [folderSearchTerm, setFolderSearchTerm] = useState(''); // Поиск по дереву фич
    const [expandedMethods, setExpandedMethods] = useState({}); // Раскрытие списка методов для компонентов
    const [expandedTechnicalDetails, setExpandedTechnicalDetails] = useState({}); // Раскрытие технических деталей (методы + diff)
    const [expandedScenarios, setExpandedScenarios] = useState({}); // Раскрытие сценариев для компонентов


    // Состояния для маппинга компонентов
    const [components, setComponents] = useState([]); // Список всех компонентов
    const [componentMappings, setComponentMappings] = useState({}); // Маппинг { componentId: [folderIds] } для мультиселекта
    const [autoMappedBlocks, setAutoMappedBlocks] = useState({}); // Автоматически добавленные блоки { componentId: Set<folderId> }
    const [showMappingModal, setShowMappingModal] = useState(false); // Управление модальным окном
    const [isMappingLoading, setIsMappingLoading] = useState(false); // Лоудер для маппинга

    const navigate = useNavigate(); // Для навигации назад

    useEffect(() => {
        console.log('Projects in TIAPage:', projects);
    }, [projects]);

    useEffect(() => {
        return () => {
            setProjectId('');
            setFrontendJSON(null);
            setBackendJSON(null);
            setJiraLink('');
            setFolders([]);
            setExpandedFolders({});
            setError('');
            setSuccessMessage('');
            setAllureLink('');
            setComponents([]);
            setComponentMappings({});
            setAutoMappedBlocks({});
            setShowMappingModal(false);
            setIsMappingLoading(false);
        };
    }, []);

    const handleProjectChange = async (e) => {
        const selectedProjectId = e.target.value;
        setProjectId(selectedProjectId);
        setError('');
        setSuccessMessage('');
        setFolders([]);
        setExpandedFolders({});

        if (selectedProjectId) {
            setStructureLoading(true);
            try {
                const response = await axios.get(`${config.TIAUrl}/api/structure`, {
                    params: { projectId: selectedProjectId, skipCustomFieldIds: '-3' },
                });

                const { folders: fetchedFolders } = response.data;
                setFolders(fetchedFolders || []);
            } catch (err) {
                setError('Не удалось загрузить структуру проекта. Попробуйте позже.');
                logError('Fetch structure error', err.message);
            } finally {
                setStructureLoading(false);
            }
        }
    };

    const isNewTiaFormat = (json) => json?.summary && Array.isArray(json.pages);

    const handleFrontendJSONUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    if (isNewTiaFormat(json)) {
                        // Новый формат TIA
                        setTiaReport(json);
                        setTiaFileName(file.name);
                        setFrontendJSON(null);
                        setBackendJSON(null);
                        setError('');
                        return;
                    }
                    // Старый формат фронтенда
                    console.log('Frontend JSON loaded:', json);
                    setFrontendJSON(json);
                    setTiaReport(null);
                    setTiaFileName('');
                    setError('');
                } catch (err) {
                    setError('Неверный формат JSON-файла.');
                    logError('Frontend JSON parse error', err.message);
                }
            };
            reader.readAsText(file);
        }
    };

    const handleBackendJSONUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    if (isNewTiaFormat(json)) {
                        // Если загружен новый формат в бэкенд, тоже обрабатываем
                        setTiaReport(json);
                        setTiaFileName(file.name);
                        setFrontendJSON(null);
                        setBackendJSON(null);
                        setError('');
                        return;
                    }
                    console.log('Backend JSON loaded:', json);
                    setBackendJSON(json);
                    setError('');
                } catch (err) {
                    setError('Неверный формат JSON-файла для бэкенда.');
                    logError('Backend JSON parse error', err.message);
                }
            };
            reader.readAsText(file);
        }
    };

    const handleJiraLinkChange = (e) => {
        setJiraLink(e.target.value.trim()); // Убираем лишние пробелы
        setError('');
    };

    const handleFolderToggle = (folderId, event) => {
        event.stopPropagation();
        setExpandedFolders((prev) => ({
            ...prev,
            [folderId]: !prev[folderId],
        }));
    };

    const extractComponents = () => {
        console.log('Extracting components - frontendJSON:', frontendJSON);
        console.log('Extracting components - backendJSON:', backendJSON);
        console.log('Extracting components - tiaReport:', tiaReport);

        // Новый формат TIA отчёта
        if (tiaReport && isNewTiaFormat(tiaReport)) {
            const uniqueMap = tiaReport.unique_affected_components || {};
            const componentsMap = new Map();

            const addComponent = (name, pageRisk, pageSummary, qaAdvice, detail, pageEnv) => {
                if (!name) return;
                const key = name;
                const existing = componentsMap.get(key);
                // Берём максимальный риск (HIGH>MEDIUM>LOW) и объединяем советы
                const riskOrder = { HIGH: 3, MEDIUM: 2, LOW: 1, '': 0 };
                const bestRisk = existing && riskOrder[existing.riskLevel] > riskOrder[pageRisk] ? existing.riskLevel : (pageRisk || '');
                const mergedAdvice = [...(existing?.qaAdvice || []), ...(qaAdvice || [])];
                const nested = detail ? [{
                    component_name: name,
                    change_source: detail.change_source,
                    changed_methods: detail.changed_methods || [],
                    diff_snippet: detail.diff_snippet,
                    file_path: detail.file_path,
                    method_jsdoc: detail.method_jsdoc || {}, // Добавляем JSDoc для методов
                }] : (existing?.nestedComponents || []);

                // Собираем уникальные env
                const envs = new Set(existing?.envs || []);
                if (pageEnv) envs.add(pageEnv);

                componentsMap.set(key, {
                    id: key,
                    name: name,
                    type: 'frontend', // Новый формат TIA report - только для фронтенда
                    riskLevel: bestRisk,
                    summaryText: pageSummary || existing?.summaryText || '',
                    qaAdvice: mergedAdvice,
                    nestedComponents: nested,
                    serviceName: detail?.file_path || existing?.serviceName || '',
                    envs: Array.from(envs),
                    jsdoc: detail?.jsdoc || detail?.class_description || detail?.description || existing?.jsdoc || null,
                    uiContext: detail?.ui_context || existing?.uiContext || null, // Добавляем ui_context
                });
            };

            (tiaReport.pages || []).forEach((page) => {
                const pageRisk = page.ai_analysis?.risk_level || '';
                const pageSummary = page.ai_analysis?.summary || '';
                const qaAdvice = page.ai_analysis?.qa_advice || [];
                const pageEnv = page.page_meta?.env;
                (page.depends_on_components || []).forEach((compName) => {
                    const detail = uniqueMap[compName];
                    addComponent(compName, pageRisk, pageSummary, qaAdvice, detail, pageEnv);
                });
            });

            const result = Array.from(componentsMap.values());
            console.log('Extracted components from TIA report (new format):', result);
            return result;
        }

        const frontendComponents = frontendJSON?.frontendComponent?.map((comp, index) => ({
            id: `${comp.name}-${index}`,
            name: comp.name,
            type: 'frontend',
            endpoints: [],
        })) || [];

        const backendComponents = backendJSON?.Controllers?.map((controller, index) => ({
            id: `${controller.ControllerName}-${index}`,
            name: controller.ControllerName,
            serviceName: controller.ServiceName,
            type: 'backend',
            endpoints: controller.Endpoints || [],
        })) || [];

        const allComponents = [...frontendComponents, ...backendComponents];
        console.log('Extracted components:', allComponents);
        return allComponents;
    };

    // Формирование pageDependencies из tiaReport
    const buildPageDependencies = (components = []) => {
        if (!tiaReport || !isNewTiaFormat(tiaReport)) {
            return [];
        }

        // Создаем Map для быстрого поиска типа компонента по имени
        const componentTypeMap = new Map();
        components.forEach(comp => {
            componentTypeMap.set(comp.name, comp.type); // 'frontend' или 'backend'
        });

        const dependencies = [];
        (tiaReport.pages || []).forEach((page) => {
            const pageName = page.page_meta?.name;
            const pageRoute = page.page_meta?.route;

            if (pageName && page.depends_on_components) {
                (page.depends_on_components || []).forEach((compName) => {
                    // Определяем тип компонента: если это страница (page), то 'page', иначе 'component'
                    // Но для создания компонента в БД нужен реальный тип: 'frontend' или 'backend'
                    const realComponentType = componentTypeMap.get(compName) || 'frontend'; // По умолчанию frontend для нового формата
                    const dependencyType = realComponentType === 'page' ? 'page' : 'component'; // Тип зависимости

                    dependencies.push({
                        pageName: pageName,
                        pageRoute: pageRoute || '', // Используем пустую строку вместо null
                        componentName: compName,
                        componentType: dependencyType, // 'component' или 'page' для валидации
                        realComponentType: realComponentType // 'frontend' или 'backend' для создания компонента
                    });
                });
            }
        });

        return dependencies;
    };

    const saveComponentMapping = async (component, folderIds, allComponents, allPageDependencies) => {
        try {
            // Используем переданные данные, чтобы не пересчитывать их каждый раз
            const components = allComponents || extractComponents();
            const pageDependencies = allPageDependencies || buildPageDependencies(components);

            // Извлекаем release_version, change_date и is_bug_fix из tiaReport, если он есть
            const releaseVersion = tiaReport?.release_version || null;
            const changeDate = tiaReport?.change_date || null;
            const isBugFix = tiaReport?.is_bug_fix || false;

            // Если нет маппинга на функциональные блоки, все равно сохраняем метаданные компонента
            // Для этого отправляем пустой массив, но с метаданными
            const functionalBlocks = folderIds.length > 0 ? folderIds.map(id => id.toString()) : [];

            await axios.post(`${config.TIAUrl}/api/components`, {
                projectId,
                componentType: component.type,
                componentName: component.name,
                functionalBlock: functionalBlocks,
                pageDependencies: pageDependencies.filter(dep => dep.componentName === component.name),
                releaseVersion: releaseVersion,
                changeDate: changeDate,
                isBugFix: isBugFix,
            });
        } catch (err) {
            logError('Save component mapping error', err.message);
            throw new Error(`Не удалось сохранить маппинг для компонента ${component.name}.`);
        }
    };

    const handleCreateTestPlan = () => {
        if (mode === 'light') {
            setError('Переключитесь в режим маппинга для создания запуска.');
            return;
        }
        if (!projectId) {
            setError('Пожалуйста, выберите проект.');
            return;
        }
        const hasLegacyJson = frontendJSON || backendJSON;
        const hasTiaReport = tiaReport && isNewTiaFormat(tiaReport);
        if (!hasLegacyJson && !hasTiaReport) {
            setError('Пожалуйста, загрузите JSON-файл (старый или новый формат TIA).');
            return;
        }
        // Jira ссылка теперь необязательна, но если указана, должна быть корректной
        if (jiraLink && !jiraLink.match(/^https?:\/\/jira\.abanking\.ru\/browse\/[A-Z]+-\d+$/)) {
            setError('Пожалуйста, введите корректную ссылку на задачу в Jira (например, https://jira.abanking.ru/browse/CTMM-528) или оставьте поле пустым.');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        const extractedComponents = extractComponents();

        if (extractedComponents.length === 0) {
            setError('Компоненты не найдены в загруженных JSON-файлах. Проверьте структуру файлов.');
            setIsLoading(false);
            return;
        }

        fetchExistingMappings(projectId)
            .then(async (existingMappings) => {
                setComponents(extractedComponents);

                const initialMappings = {};
                const autoMappedBlocks = {}; // Для отслеживания автоматически добавленных блоков

                // Сначала загружаем существующие маппинги
                extractedComponents.forEach(component => {
                    const mappingsForComponent = existingMappings.filter(
                        m => m.component_name === component.name && m.component_type === component.type
                    );
                    const folderIds = mappingsForComponent
                        .map(m => findFolderAllureId(m.functional_block_allure_id)?.toString() || '')
                        .filter(id => id);
                    initialMappings[component.id] = folderIds.length > 0 ? folderIds : [];
                    autoMappedBlocks[component.id] = new Set(); // Инициализируем Set для автоматических блоков
                });

                // Затем добавляем автоматические маппинги из связанных Page
                if (tiaReport && isNewTiaFormat(tiaReport)) {
                    try {
                        const components = extractedComponents;
                        const pageDependencies = buildPageDependencies(components);

                        // Собираем уникальные имена Page
                        const pageNames = [...new Set(pageDependencies.map(dep => dep.pageName))].filter(name => name); // Убираем пустые значения

                        if (pageNames.length > 0) {
                            console.log(`Запрашиваем маппинги для Page: ${pageNames.length} шт.`);
                            const response = await axios.post(`${config.TIAUrl}/api/components/page-mappings`, {
                                projectId,
                                pageNames
                            });

                            const { pageMappings } = response.data;

                            // Для каждого компонента находим связанные Page и добавляем их маппинги
                            extractedComponents.forEach(component => {
                                const componentPageDeps = pageDependencies.filter(
                                    dep => dep.componentName === component.name
                                );

                                const autoFolderIds = new Set(initialMappings[component.id] || []);

                                componentPageDeps.forEach(pageDep => {
                                    const pageName = pageDep.pageName;
                                    const pageMapping = pageMappings[pageName] || [];

                                    pageMapping.forEach(mapping => {
                                        const folderId = findFolderAllureId(mapping.functional_block_allure_id)?.toString();
                                        if (folderId && !autoFolderIds.has(folderId)) {
                                            autoFolderIds.add(folderId);
                                            autoMappedBlocks[component.id].add(folderId);
                                        }
                                    });
                                });

                                initialMappings[component.id] = Array.from(autoFolderIds);
                            });
                        }
                    } catch (err) {
                        logError('Ошибка при загрузке автоматических маппингов из Page:', err.message);
                        // Продолжаем работу даже если не удалось загрузить автоматические маппинги
                    }
                }

                setComponentMappings(initialMappings);
                // Сохраняем информацию об автоматически добавленных блоках в отдельном состоянии
                // Преобразуем Set в объект для хранения в состоянии
                const autoMappedBlocksObj = {};
                Object.keys(autoMappedBlocks).forEach(componentId => {
                    autoMappedBlocksObj[componentId] = Array.from(autoMappedBlocks[componentId]);
                });
                setAutoMappedBlocks(autoMappedBlocksObj);

                setShowMappingModal(true);
            })
            .catch(err => {
                setError('Произошла ошибка при обработке компонентов. Проверьте данные и повторите попытку.');
                logError('Component extraction error', err.message);
                setIsLoading(false);
            });
    };

    const handlePartialSave = async () => {
        setIsPartialSaving(true);
        setError('');
        setPartialSaveMessage('');

        try {
            // Предварительно вычисляем данные один раз
            const allComponents = extractComponents();
            const allPageDependencies = buildPageDependencies(allComponents);

            // Сохраняем ВСЕ компоненты, включая те, у которых маппинги были удалены (пустой массив)
            // Это необходимо для удаления старых маппингов из БД
            // Запускаем сохранения параллельно пачками по 5 штук, чтобы не заблокировать браузер и не перегрузить сеть
            const chunkSize = 5;
            for (let i = 0; i < components.length; i += chunkSize) {
                const chunk = components.slice(i, i + chunkSize);
                await Promise.all(chunk.map(c => {
                    const folderIds = componentMappings[c.id] || [];
                    return saveComponentMapping(c, folderIds, allComponents, allPageDependencies);
                }));
            }

            // Сохраняем все связи Page -> компоненты одним запросом (если есть tiaReport)
            if (tiaReport && isNewTiaFormat(tiaReport)) {
                if (allPageDependencies.length > 0) {
                    try {
                        await axios.post(`${config.TIAUrl}/api/components/page-dependencies`, {
                            projectId,
                            pageDependencies: allPageDependencies,
                        });
                    } catch (depErr) {
                        // Игнорируем ошибку, если это не критично
                        logError('Save page dependencies error', depErr.message);
                    }
                }
            }

            setPartialSaveMessage('Маппинг успешно сохранён, можете продолжить.');
            // убрать сообщение через 5 секунд
            setTimeout(() => setPartialSaveMessage(''), 5000);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsPartialSaving(false);
        }
    };


    const fetchExistingMappings = async (projectId) => {
        try {
            const response = await axios.get(`${config.TIAUrl}/api/components`, {
                params: { projectId },
            });
            return response.data.mappings || [];
        } catch (err) {
            logError('Fetch existing mappings error', err.message);
            return [];
        }
    };

    const findFolderAllureId = (functionalBlockAllureId) => {
        if (!functionalBlockAllureId || !folders) return null;

        const findInFolders = (foldersList) => {
            for (const folder of foldersList) {
                const folderIdStr = folder.id.toString();
                const functionalBlockAllureIdStr = functionalBlockAllureId.toString();
                if (folderIdStr === functionalBlockAllureIdStr) return folderIdStr;
                if (folder.children && folder.children.length > 0) {
                    const result = findInFolders(folder.children);
                    if (result) return result;
                }
            }
            return null;
        };

        return findInFolders(folders);
    };

    const findFolderPath = (nodes, targetId, currentPath = []) => {
        for (const node of nodes) {
            const nodeId = node.id;
            const newPath = [...currentPath, nodeId];
            if (String(nodeId) === String(targetId)) {
                return newPath;
            }
            if (node.children) {
                const found = findFolderPath(node.children, targetId, newPath);
                if (found) return found;
            }
        }
        return null;
    };

    const createTestPlan = async () => {
        setLoadingState(prev => ({ ...prev, launch: true }));
        try {
            const allFolderIds = new Set();
            Object.values(componentMappings).forEach(folderIds => folderIds.forEach(id => allFolderIds.add(id)));
            const groupsInclude = Array.from(allFolderIds).map(id => parseInt(id, 10));

            const components = extractComponents(); // Получаем список всех компонентов для определения типов
            const pageDependencies = buildPageDependencies(components);

            const requestBody = {
                projectId,
                jiraLink,
                componentMappings,
                pageDependencies: pageDependencies,
            };

            const response = await axios.post(`${config.TIAUrl}/api/launch`, requestBody, {
                headers: { 'Content-Type': 'application/json' },
            });

            const { id } = response.data;
            const allureLink = `${config.url}/launch/${id}`;
            setSuccessMessage('Запуск успешно создан!');
            setAllureLink(allureLink);
        } catch (err) {
            // Парсим структурированные ошибки от backend
            if (err.response && err.response.data) {
                const errorData = err.response.data;

                // Специфические ошибки с кодами
                if (errorData.code === 'NO_TEST_CASES') {
                    setError(errorData.error);
                } else if (errorData.code === 'JOBS_MAPPING_ERROR') {
                    setError(`${errorData.error}${errorData.details ? ` (${errorData.details})` : ''}`);
                } else if (errorData.code === 'ALLURE_API_ERROR') {
                    setError(`${errorData.error}${errorData.details ? `: ${errorData.details}` : ''}`);
                } else if (errorData.error) {
                    // Общая ошибка с сообщением
                    setError(errorData.error);
                } else {
                    // Fallback
                    setError('Произошла ошибка при создании запуска. Проверьте данные и повторите попытку.');
                }

                logError('Test plan creation error', errorData.details || err.message);
            } else {
                setError('Произошла ошибка при создании запуска. Проверьте данные и повторите попытку.');
                logError('Test plan creation error', err.message);
            }
            setLoadingState(prev => ({ ...prev, launch: false }));
            setIsLoading(false);
        } finally {
            setLoadingState(prev => ({ ...prev, launch: false }));
        }
    };

    // Создание настоящего тест-плана (не запуска) через /api/testplan с поддержкой стриминга прогресса
    const createActualTestPlan = async () => {
        setLoadingState(prev => ({ ...prev, testplan: true }));
        setProgress({ message: 'Инициализация...' });
        setError(null);
        setSuccessMessage(null);

        try {
            // Собираем полные пути для всех выбранных папок
            const groupsIncludePaths = [];
            Object.values(componentMappings).forEach(folderIds => {
                if (Array.isArray(folderIds)) {
                    folderIds.forEach(id => {
                        const path = findFolderPath(folders, id);
                        if (path) {
                            groupsIncludePaths.push(path);
                        } else {
                            // Если путь не найден, добавляем хотя бы сам ID как путь (fallback)
                            groupsIncludePaths.push([parseInt(id, 10)]);
                        }
                    });
                }
            });

            const components = extractComponents();
            const pageDependencies = buildPageDependencies(components);

            const requestBody = {
                projectId,
                jiraLink,
                componentMappings,
                groupsIncludePaths, // Отправляем вычисленные пути
                pageDependencies,
            };

            // Используем fetch для стриминга (чтения прогресса)
            const response = await fetch(`${config.TIAUrl}/api/testplan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            // Если вернулся обычный JSON с ошибкой (например 400 Bad Request при валидации)
            const contentType = response.headers.get('content-type');
            if (!response.ok && contentType && contentType.includes('application/json')) {
                const errorJson = await response.json();
                throw { response: { data: errorJson } }; // Эмулируем формат axios error
            }

            // Читаем NDJSON поток
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Сохраняем неполную строку

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);

                        if (event.type === 'init') {
                            setProgress({ total: event.totalBlocks, current: 0, message: 'Сбор тест-кейсов...' });
                        } else if (event.type === 'progress') {
                            setProgress(prev => ({
                                ...prev,
                                current: event.current,
                                total: event.total,
                                message: event.message || `Обработка: ${event.current} / ${event.total}`
                            }));
                        } else if (event.type === 'error') {
                            // Бросаем ошибку, которую перехватит catch
                            throw { response: { data: event } };
                        } else if (event.type === 'result') {
                            const { id, testCasesCount } = event;
                            const allureLink = `${config.url}/testplan/${id}`;
                            setSuccessMessage(`Тест-план успешно создан! (${testCasesCount || 'N/A'} тест-кейсов)`);
                            setAllureLink(allureLink);
                        }
                    } catch (e) {
                        // Если ошибка внутри цикла чтения (например JSON parse error или throw выше)
                        if (e.response) throw e; // Пробрасываем нашу ошибку данные
                        console.error('Error parsing stream line:', line, e);
                    }
                }
            }

        } catch (err) {
            // Парсим структурированные ошибки от backend (или наши эмулированные)
            if (err.response && err.response.data) {
                const errorData = err.response.data;

                // Специфические ошибки с кодами
                if (errorData.code === 'NO_TEST_CASES') {
                    setError(errorData.error);
                } else if (errorData.code === 'NO_GROUPS') {
                    setError(errorData.error);
                } else if (errorData.code === 'ALLURE_API_ERROR') {
                    setError(`${errorData.error}${errorData.details ? `: ${errorData.details}` : ''}`);
                } else if (errorData.error) {
                    setError(errorData.error);
                } else {
                    setError('Произошла ошибка при создании тест-плана.');
                }
                logError('Test plan creation error', errorData.details || errorData.error);
            } else {
                // Сетевые ошибки или ошибки fetch
                setError(`Произошла ошибка при создании тест-плана: ${err.message}`);
                logError('Test plan creation error', err.message);
            }
        } finally {
            setLoadingState(prev => ({ ...prev, testplan: false }));
            setProgress(null);
        }
    };

    const handleMappingConfirm = async (createType = 'launch') => {
        setIsMappingLoading(true); // Включаем лоудер для маппинга
        setLoadingState(prev => ({ ...prev, [createType]: true })); // Включаем кнопку сразу
        try {
            // Предварительно вычисляем данные один раз перед циклом
            const allComponents = extractComponents();
            const allPageDependencies = buildPageDependencies(allComponents);

            // Сохраняем ВСЕ компоненты, включая те, у которых маппинги были удалены (пустой массив)
            // Это необходимо для удаления старых маппингов из БД

            // Запускаем сохранения параллельно пачками по 5 штук
            const chunkSize = 5
            for (let i = 0; i < components.length; i += chunkSize) {
                const chunk = components.slice(i, i + chunkSize);
                await Promise.all(chunk.map(component => {
                    const folderIds = componentMappings[component.id] || [];
                    return saveComponentMapping(component, folderIds, allComponents, allPageDependencies);
                }));
            }

            // Вызываем нужную функцию в зависимости от типа
            if (createType === 'testplan') {
                await createActualTestPlan();
            } else {
                await createTestPlan(); // Создает launch
            }

            setShowMappingModal(false);
        } catch (err) {
            setError(err.message);
            logError('Mapping confirmation error', err.message);
        } finally {
            setIsLoading(false);
            setIsMappingLoading(false); // Обязательно сбрасываем состояние загрузки маппинга
            setLoadingState(prev => ({ ...prev, [createType]: false })); // Сброс состояния кнопки
        }
    };

    const handleMappingCancel = () => {
        // закрываем окно маппинга
        setShowMappingModal(false);

        // сбрасываем список компонентов и маппинг
        setComponents([]);
        setComponentMappings({});

        // чистим сообщения об ошибке / об успешном частичном сохранении
        setError('');
        setPartialSaveMessage('');

        // сбрасываем все лоадеры
        setIsMappingLoading(false);
        setIsPartialSaving(false);
        setIsLoading(false);
    };


    const handleMappingChange = (componentId, selectedOptions) => {
        setComponentMappings(prev => ({
            ...prev,
            [componentId]: selectedOptions.map(option => option.value.toString()),
        }));
    };

    // Рекурсивно собирает все ID узла и его дочерних элементов
    const getAllDescendantIds = (folder) => {
        const ids = [folder.id.toString()];
        if (folder.children && folder.children.length > 0) {
            folder.children.forEach(child => {
                ids.push(...getAllDescendantIds(child));
            });
        }
        return ids;
    };

    // Рекурсивно проверяет, выбраны ли все дочерние элементы узла
    const areAllDescendantsSelected = (folder, mappings) => {
        const folderId = folder.id.toString();
        // Если сам узел выбран, считаем что все дочерние тоже выбраны (так как при выборе родителя выбираются все дети)
        if (mappings.includes(folderId)) return true;

        // Если нет детей, проверяем только сам узел
        if (!folder.children || folder.children.length === 0) {
            return mappings.includes(folderId);
        }

        // Проверяем, выбраны ли все дочерние элементы
        return folder.children.every(child => areAllDescendantsSelected(child, mappings));
    };

    // Получить список страниц, использующих компонент
    const getPagesUsingComponent = (componentName) => {
        if (!tiaReport || !isNewTiaFormat(tiaReport)) return [];
        return (tiaReport.pages || []).filter(page =>
            (page.depends_on_components || []).includes(componentName)
        );
    };

    // Получить краткое описание изменений компонента
    const getComponentChangeSummary = (component) => {
        // Используем summaryText, если есть, иначе общее описание
        // Методы теперь отображаются отдельно в раскрывающемся списке
        if (component.summaryText) {
            return component.summaryText;
        }
        const firstNested = component.nestedComponents?.[0];
        if (firstNested?.changed_methods?.length > 0) {
            return `Изменен${firstNested.changed_methods.length > 1 ? 'ы' : ''} метод${firstNested.changed_methods.length > 1 ? 'ы' : ''} (${firstNested.changed_methods.length}).`;
        }
        return 'Изменения в компоненте';
    };

    // Рендер UI Trace блока
    const renderUITrace = (component) => {
        const uiContext = component.uiContext;
        if (!uiContext || !uiContext.uiElements || uiContext.uiElements.length === 0) {
            return null;
        }

        const getElementTypeLabel = (type) => {
            switch (type?.toLowerCase()) {
                case 'button': return 'Кнопка';
                case 'form': return 'Форма';
                case 'input': return 'Поле';
                default: return type || 'Элемент';
            }
        };

        const getElementLabel = (element) => {
            if (element.label) {
                // Убираем Angular-шаблоны из label
                return element.label
                    .replace(/\{\{[^}]+\}\}/g, '')
                    .replace(/\|[^|]+\|/g, '')
                    .trim() || 'Элемент';
            }
            return 'Элемент';
        };

        return (
            <div style={{
                marginTop: '12px',
                marginBottom: '12px',
                padding: '12px',
                backgroundColor: '#fff3cd',
                border: '1px solid #ffc107',
                borderRadius: '6px'
            }}>
                <div style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#856404',
                    marginBottom: '8px'
                }}>
                    UI Trace
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {uiContext.uiElements.map((element, eidx) => (
                        <div key={`ui-element-${eidx}`} style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            padding: '8px',
                            backgroundColor: '#fff',
                            borderRadius: '4px',
                            border: '1px solid #ffc107'
                        }}>
                            <div style={{ flex: 1, fontSize: '13px', color: '#111' }}>
                                <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                                    {getElementTypeLabel(element.type)}
                                    {element.label && ` "${getElementLabel(element)}"`}
                                </div>
                                {element.method && (
                                    <div style={{ fontSize: '11px', color: '#6c757d', fontFamily: 'monospace' }}>
                                        Метод: {element.method}
                                    </div>
                                )}
                                {element.attributes && Object.keys(element.attributes).length > 0 && (
                                    <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '2px' }}>
                                        {Object.entries(element.attributes).map(([key, value]) => (
                                            <span key={key} style={{ marginRight: '8px' }}>
                                                {key}: <code style={{ backgroundColor: '#f8f9fa', padding: '1px 4px', borderRadius: '2px' }}>{value}</code>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // Получить базовый URL для тестового стенда
    const getTestStandUrl = () => {
        // Можно добавить настройку в config или использовать дефолтное значение
        return config.testStandUrl || 'https://test-stand.url';
    };

    // Обработчик клика по route кнопке
    const handleRouteClick = (route, e) => {
        e.stopPropagation();
        if (!route) return;

        // Заменяем параметры маршрута на placeholder или оставляем как есть
        let finalRoute = route;
        if (route.includes(':')) {
            // Если есть параметры, можно показать prompt или просто открыть
            const params = route.match(/:(\w+)/g) || [];
            if (params.length > 0) {
                params.forEach(param => {
                    const paramName = param.substring(1);
                    const value = prompt(`Введите значение для параметра ${paramName}:`, '');
                    if (value !== null && value !== '') {
                        finalRoute = finalRoute.replace(param, value);
                    } else {
                        // Если пользователь отменил, используем placeholder
                        finalRoute = finalRoute.replace(param, `[${paramName}]`);
                    }
                });
            }
        }

        const fullUrl = `${getTestStandUrl()}/${finalRoute}`;
        window.open(fullUrl, '_blank');
    };

    // Фильтрация дерева фич по поисковому запросу
    const filterFolders = (folders, searchTerm) => {
        if (!searchTerm) return folders;
        const lowerSearch = searchTerm.toLowerCase();
        return folders.filter(folder => {
            const matches = folder.name.toLowerCase().includes(lowerSearch) ||
                (folder.customFieldName && folder.customFieldName.toLowerCase().includes(lowerSearch));
            const filteredChildren = folder.children ? filterFolders(folder.children, searchTerm) : [];
            return matches || filteredChildren.length > 0;
        }).map(folder => ({
            ...folder,
            children: folder.children ? filterFolders(folder.children, searchTerm) : []
        }));
    };

    // Найти фичу по ID в дереве
    const findFolderById = (folders, id) => {
        for (const folder of folders) {
            if (folder.id === id) return folder;
            if (folder.children) {
                const found = findFolderById(folder.children, id);
                if (found) return found;
            }
        }
        return null;
    };

    // Рендер дерева фич для маппинга с возможностью выбора
    const renderFolderTreeForMapping = (folders, componentId, level = 0) => {
        if (!folders || folders.length === 0) {
            return <div style={{ color: '#6c757d', fontSize: '14px', padding: '20px', textAlign: 'center' }}>Нет доступных фич</div>;
        }

        const filteredFolders = filterFoldersForProject(folders);
        return filteredFolders.map((folder) => {
            // Проверяем, выбран ли узел или все его дочерние элементы
            const folderId = folder.id.toString();
            const mappings = componentId ? (componentMappings[componentId] || []) : [];
            const isDirectlySelected = mappings.includes(folderId);

            // Проверяем, выбраны ли все дочерние элементы (рекурсивно)
            const allDescendantsSelected = areAllDescendantsSelected(folder, mappings);

            // Узел считается выбранным, если он выбран напрямую или все его дочерние элементы выбраны
            const isSelected = isDirectlySelected || (allDescendantsSelected && !isDirectlySelected && folder.children && folder.children.length > 0);
            const hasChildren = folder.children && folder.children.length > 0;
            const isExpanded = expandedFolders[folder.id];

            return (
                <div key={folder.id} style={{ marginBottom: '8px' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: isSelected ? '#d4edda' : 'transparent',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            marginLeft: `${level * 20}px`,
                            border: isSelected ? '2px solid #28a745' : '2px solid transparent',
                            ':hover': { backgroundColor: '#e9ecef' }
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!componentId) {
                                // Если компонент не выбран, предлагаем выбрать его
                                return;
                            }
                            if (isSelected) {
                                // Удалить из маппинга: удаляем сам узел и все его дочерние элементы
                                const allIdsToRemove = getAllDescendantIds(folder);
                                const currentMappings = componentMappings[componentId] || [];
                                const newMappings = currentMappings.filter(id => !allIdsToRemove.includes(id));
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: newMappings
                                }));
                            } else {
                                // Добавить в маппинг: добавляем сам узел и все его дочерние элементы
                                const allIdsToAdd = getAllDescendantIds(folder);
                                const currentMappings = componentMappings[componentId] || [];
                                const newMappingsSet = new Set([...currentMappings, ...allIdsToAdd]);
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: Array.from(newMappingsSet)
                                }));
                            }
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = isSelected ? '#c3e6cb' : '#e9ecef';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = isSelected ? '#d4edda' : 'transparent';
                        }}
                    >
                        {hasChildren && (
                            <span
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedFolders(prev => ({
                                        ...prev,
                                        [folder.id]: !prev[folder.id]
                                    }));
                                }}
                                style={{
                                    marginRight: '8px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    color: '#6c757d',
                                    userSelect: 'none',
                                    width: '16px',
                                    display: 'inline-block'
                                }}
                            >
                                {isExpanded ? '▼' : '►'}
                            </span>
                        )}
                        {!hasChildren && <span style={{ width: '16px', display: 'inline-block' }} />}
                        <span style={{
                            fontSize: level === 0 ? '15px' : '14px',
                            fontWeight: level === 0 ? 600 : 400,
                            color: '#2c3e50',
                            flex: 1
                        }}>
                            {formatCustomFieldName(folder, level)}
                        </span>
                        {isSelected && (
                            <>
                                <span style={{
                                    marginLeft: '8px',
                                    color: '#28a745',
                                    fontSize: '16px',
                                    fontWeight: 'bold'
                                }}>
                                    ✓
                                </span>
                                {hasChildren && allDescendantsSelected && !isDirectlySelected && (
                                    <span style={{
                                        marginLeft: '4px',
                                        color: '#28a745',
                                        fontSize: '11px',
                                        fontStyle: 'italic',
                                        opacity: 0.8
                                    }}>
                                        (все дочерние)
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                    {hasChildren && isExpanded && (
                        <div style={{ marginTop: '4px' }}>
                            {renderFolderTreeForMapping(folder.children, componentId, level + 1)}
                        </div>
                    )}
                </div>
            );
        });
    };

    const toggleDetails = (detailKey) => {
        setExpandedDetails(prev => ({
            ...prev,
            [detailKey]: !prev[detailKey],
        }));
    };

    const logError = async (errorType, description) => {
        try {
            await axios.post(`${config.TIAUrl}/api/errors`, {
                errorType, description, timestamp: new Date().toISOString(),
            });
        } catch (err) {
            console.error('Failed to log error:', err.message);
        }
    };

    const renderFolderTree = (folders, level = 0) => {
        const filteredFolders = filterFoldersForProject(folders);
        return filteredFolders.map((folder) => (
            <div
                key={folder.id}
                style={{
                    marginLeft: `${level * 20}px`,
                    marginBottom: '12px',
                    transition: 'all 0.3s ease',
                    ...(level === 0 ? styles.featureLevel : styles.storyLevel),
                    cursor: 'pointer',
                }}
                onClick={(e) => handleFolderToggle(folder.id, e)}
            >
                {folder.children && folder.children.length > 0 && (
                    <span style={styles.toggleIcon}>
                        {expandedFolders[folder.id] ? '▼' : '►'}
                    </span>
                )}
                <span style={{ ...styles.folderName, fontWeight: level === 0 ? 600 : 400 }}>
                    {formatCustomFieldName(folder, level)}
                </span>
                {expandedFolders[folder.id] && folder.children && folder.children.length > 0 && (
                    <div style={{ ...styles.nestedFolders, maxHeight: expandedFolders[folder.id] ? '1000px' : '0' }}>
                        {renderFolderTree(folder.children, level + 1)}
                    </div>
                )}
            </div>
        ));
    };

    // Фильтрация папок для проекта 307 (показываем только Block и SubBlock на корневом уровне, но под ними показываем все)
    const filterFoldersForProject = (folders) => {
        if (projectId !== '307') {
            return folders;
        }

        const result = [];
        folders.forEach(folder => {
            if (folder.customFieldName === 'Block' || folder.customFieldName === 'SubBlock') {
                // Показываем Block и SubBlock, рекурсивно фильтруем детей (но не фильтруем Feature, Story и т.д.)
                const filteredChildren = folder.children && folder.children.length > 0
                    ? filterFoldersForProject(folder.children)
                    : [];
                result.push({
                    ...folder,
                    children: filteredChildren
                });
            } else {
                // Для всех остальных типов (Feature, Story, Scenario, Code) - показываем их, если они не на корневом уровне
                // Но эта функция вызывается рекурсивно, так что если мы здесь, значит это уже не корневой уровень
                // Просто показываем все узлы с их детьми
                const filteredChildren = folder.children && folder.children.length > 0
                    ? filterFoldersForProject(folder.children)
                    : [];
                result.push({
                    ...folder,
                    children: filteredChildren
                });
            }
        });
        return result;
    };

    // Форматирование customFieldName для отображения (для проекта 307 показываем Block/SubBlock вместо Feature)
    const formatCustomFieldName = (folder, level = 0) => {
        // Для всех проектов показываем как обычно
        return `${folder.customFieldName} - ${folder.name}`;
    };

    const getFolderOptions = (folders) => {
        const options = [];
        const filteredFolders = filterFoldersForProject(folders);
        const traverseFolders = (folderList, level = 0) => {
            folderList.forEach((folder) => {
                const displayName = formatCustomFieldName(folder, level);
                options.push({ value: folder.id.toString(), label: `${'-'.repeat(level)} ${displayName}` });
                if (folder.children) traverseFolders(folder.children, level + 1);
            });
        };
        traverseFolders(filteredFolders);
        return options;
    };

    const isCreateButtonDisabled = () => mode !== 'mapping' || !projectId || (!(frontendJSON || backendJSON || (tiaReport && isNewTiaFormat(tiaReport))) || isLoading);

    // Обновленная логика: РАЗРЕШАЕМ создание, даже если не все компоненты смаплены.
    // Мы просто передадим те, что есть. Пустые маппинги будут проигнорированы.
    const isMappingConfirmDisabled = false;

    // Проверка для кнопки "Подтвердить и создать"
    // Jira ссылка теперь опциональна (проверяем валидность только если она введена)
    const isJiraValid = !jiraLink || jiraLink.match(/^https?:\/\/jira\.abanking\.ru\/browse\/[A-Z]+-\d+$/);

    // Кнопка заблокирована только если Jira ссылка некорректна (если введена)
    const isMappingConfirmButtonDisabled = !isJiraValid;

    const renderQAAdvice = (qaAdvice = []) => {
        if (!qaAdvice.length) return null;
        return qaAdvice.map((advice, idx) => (
            <div key={`qa-${idx}`} style={{ padding: '8px 0', color: '#111' }}>
                <div style={{ fontWeight: 600, color: '#111' }}>{advice.area} — {advice.priority}</div>
                {(advice.scenarios || []).map((scenario, i) => (
                    <div key={`scenario-${idx}-${i}`} style={{ fontSize: 14, marginTop: 4, color: '#111' }}>{scenario}</div>
                ))}
            </div>
        ));
    };

    const renderNestedComponents = (nestedComponents = [], parentId) => {
        if (!nestedComponents.length) return null;
        return (
            <div style={{ marginTop: 8, padding: 8, backgroundColor: '#fff', borderRadius: 6, border: `1px solid ${styles.borderLight}` }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Затронутые вложенные компоненты</div>
                {nestedComponents.map((nc, idx) => {
                    const detailKey = `${parentId}-${idx}`;
                    const isExpanded = !!expandedDetails[detailKey];
                    return (
                        <div key={detailKey} style={{ padding: '8px 0', borderTop: idx === 0 ? 'none' : `1px solid ${styles.borderLight}` }}>
                            <div style={{ fontWeight: 600, color: '#111' }}>{nc.component_name}</div>
                            {nc.change_source && <div style={{ fontSize: 13, color: '#111' }}>Источник: {nc.change_source}</div>}
                            {nc.impact_summary && <div style={{ marginTop: 4, fontSize: 13, color: '#111' }}>{nc.impact_summary}</div>}
                            <button
                                onClick={() => toggleDetails(detailKey)}
                                style={{ ...styles.modalButtonSave, marginTop: 6, padding: '6px 10px' }}
                            >
                                {isExpanded ? 'Скрыть детали' : 'Подробное описание'}
                            </button>
                            {isExpanded && (
                                <div style={{ marginTop: 8, backgroundColor: '#f6f8fa', padding: 8, borderRadius: 6 }}>
                                    {(nc.changed_methods || []).length > 0 && (
                                        <div style={{ marginBottom: 8 }}>
                                            <div style={{ fontWeight: 600, color: '#111' }}>Методы:</div>
                                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                                                {nc.changed_methods.map((method, mi) => (
                                                    <li key={`${detailKey}-method-${mi}`} style={{ fontSize: 13, color: '#111' }}>{method}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {nc.diff_snippet && (
                                        <pre style={{ whiteSpace: 'pre-wrap', backgroundColor: '#fff', padding: 8, borderRadius: 4, border: `1px solid ${styles.borderLight}`, color: '#111' }}>
                                            {nc.diff_snippet}
                                        </pre>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderLightSummary = () => {
        if (!tiaReport || !isNewTiaFormat(tiaReport) || mode !== 'light') return null;
        const { summary, pages, unique_affected_components } = tiaReport;
        const uniqueMap = unique_affected_components || {};
        const globalRisks = summary?.global_risks || [];

        return (
            <div style={{ marginTop: 24 }}>
                <h2 style={styles.subHeader}>TIA Light: сводка изменений</h2>

                {/* Глобальные риски - красный алерт блок */}
                {globalRisks.length > 0 && (
                    <div style={{
                        marginBottom: 32,
                        padding: '20px',
                        backgroundColor: '#fff5f5',
                        border: '2px solid #dc3545',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(220, 53, 69, 0.15)'
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '16px'
                        }}>
                            <span style={{
                                fontSize: '24px',
                                fontWeight: 'bold',
                                color: '#dc3545'
                            }}>⚠️</span>
                            <h3 style={{
                                margin: 0,
                                fontSize: '20px',
                                fontWeight: 700,
                                color: '#dc3545'
                            }}>
                                Глобальные Риски
                            </h3>
                        </div>
                        {globalRisks.map((risk, ridx) => {
                            const riskColor = risk.risk_level === 'HIGH' ? '#dc3545' :
                                risk.risk_level === 'MEDIUM' ? '#ffc107' : '#28a745';
                            return (
                                <div key={`global-risk-${ridx}`} style={{
                                    marginBottom: ridx < globalRisks.length - 1 ? '20px' : '0',
                                    paddingBottom: ridx < globalRisks.length - 1 ? '20px' : '0',
                                    borderBottom: ridx < globalRisks.length - 1 ? '2px solid #fecaca' : 'none'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        marginBottom: '12px',
                                        flexWrap: 'wrap'
                                    }}>
                                        <span style={{
                                            padding: '6px 12px',
                                            backgroundColor: riskColor,
                                            color: '#fff',
                                            borderRadius: '6px',
                                            fontSize: '12px',
                                            fontWeight: 700
                                        }}>
                                            {risk.risk_level}
                                        </span>
                                        <span style={{
                                            fontSize: '16px',
                                            fontWeight: 700,
                                            color: '#111'
                                        }}>
                                            Изменен: {risk.source}
                                        </span>
                                        <span style={{
                                            fontSize: '13px',
                                            color: '#6c757d',
                                            backgroundColor: '#fff',
                                            padding: '4px 10px',
                                            borderRadius: '4px',
                                            border: '1px solid #dee2e6'
                                        }}>
                                            Затронуто страниц: {risk.affected_pages_count || 0}
                                        </span>
                                    </div>
                                    <div style={{
                                        fontSize: '14px',
                                        color: '#111',
                                        lineHeight: 1.6,
                                        marginBottom: '12px',
                                        padding: '12px',
                                        backgroundColor: '#fff',
                                        borderRadius: '6px',
                                        border: '1px solid #fecaca'
                                    }}>
                                        <strong style={{ color: '#dc3545' }}>Влияние:</strong> {risk.description}
                                    </div>
                                    {risk.advice && risk.advice.length > 0 && (
                                        <div style={{
                                            marginTop: '12px',
                                            padding: '12px',
                                            backgroundColor: '#fff',
                                            borderRadius: '6px',
                                            border: '1px solid #fecaca'
                                        }}>
                                            <div style={{
                                                fontSize: '13px',
                                                fontWeight: 600,
                                                color: '#dc3545',
                                                marginBottom: '8px'
                                            }}>
                                                Совет AI:
                                            </div>
                                            <ol style={{
                                                margin: 0,
                                                paddingLeft: '20px',
                                                color: '#111'
                                            }}>
                                                {risk.advice.map((adviceItem, aidx) => (
                                                    <li key={`advice-${ridx}-${aidx}`} style={{
                                                        fontSize: '13px',
                                                        color: '#111',
                                                        marginBottom: '6px',
                                                        lineHeight: 1.5
                                                    }}>
                                                        {adviceItem}
                                                    </li>
                                                ))}
                                            </ol>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Легенда */}
                <div style={{ marginBottom: 24, padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8, border: `1px solid ${styles.borderLight}` }}>
                    <h3 style={{ ...styles.subHeader, fontSize: 16, marginBottom: 12 }}>Легенда</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, fontSize: 13 }}>
                        <div>
                            <strong style={{ color: '#111' }}>Уровни риска:</strong>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#dc3545', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4 }}>HIGH</span>
                                <span style={{ color: '#111' }}> — высокий риск, требуется обязательное тестирование</span>
                            </div>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#ffc107', color: '#111', borderRadius: 3, fontSize: 11, marginRight: 4 }}>MEDIUM</span>
                                <span style={{ color: '#111' }}> — средний риск, рекомендуется тестирование</span>
                            </div>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#28a745', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4 }}>LOW</span>
                                <span style={{ color: '#111' }}> — низкий риск, опциональное тестирование</span>
                            </div>
                        </div>
                        <div>
                            <strong style={{ color: '#111' }}>Окружение:</strong>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#6c757d', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4 }}>browser</span>
                                <span style={{ color: '#111' }}> — веб-версия</span>
                            </div>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#6c757d', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4 }}>mobile</span>
                                <span style={{ color: '#111' }}> — мобильная версия</span>
                            </div>
                        </div>
                        <div>
                            <strong style={{ color: '#111' }}>Другие метки:</strong>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#17a2b8', color: '#fff', borderRadius: 3, fontSize: 11, marginRight: 4, fontFamily: 'monospace' }}>route</span>
                                <span style={{ color: '#111' }}> — маршрут страницы</span>
                            </div>
                            <div style={{ marginTop: 4 }}>
                                <span style={{ padding: '2px 8px', backgroundColor: '#e7f3ff', color: '#0056b3', borderRadius: 3, fontSize: 11, marginRight: 4 }}>feature</span>
                                <span style={{ color: '#111' }}> — функциональные возможности</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Общая статистика */}
                {summary && (
                    <div style={{ marginBottom: 32 }}>
                        <h3 style={{ ...styles.subHeader, fontSize: 18, marginBottom: 16 }}>Общая статистика</h3>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                            <div style={{ ...styles.card, minWidth: 200 }}>
                                <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>Test Coverage</div>
                                <div style={{ fontSize: 32, color: '#111', fontWeight: 700 }}>
                                    {summary.test_coverage_percent?.toFixed(1) ?? 'N/A'}%
                                </div>
                                <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>
                                    Процент покрытия тестами затронутых страниц
                                </div>
                            </div>
                            <div style={{ ...styles.card, minWidth: 200 }}>
                                <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>Затронуто страниц</div>
                                <div style={{ fontSize: 32, color: '#111', fontWeight: 700 }}>
                                    {summary.impacted_pages ?? 0} / {summary.total_pages ?? 0}
                                </div>
                                <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>
                                    Количество страниц с изменениями из общего числа
                                </div>
                            </div>
                            <div style={{ ...styles.card, minWidth: 240 }}>
                                <div style={{ fontWeight: 700, color: '#111', marginBottom: 4 }}>Распределение рисков</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                                    <div style={{ color: '#111' }}>
                                        <span style={{ color: '#dc3545', fontWeight: 600 }}>HIGH:</span> {summary.risk_counts?.HIGH ?? 0}
                                    </div>
                                    <div style={{ color: '#111' }}>
                                        <span style={{ color: '#ffc107', fontWeight: 600 }}>MEDIUM:</span> {summary.risk_counts?.MEDIUM ?? 0}
                                    </div>
                                    <div style={{ color: '#111' }}>
                                        <span style={{ color: '#28a745', fontWeight: 600 }}>LOW:</span> {summary.risk_counts?.LOW ?? 0}
                                    </div>
                                </div>
                                <div style={{ fontSize: 12, color: '#6c757d', marginTop: 8 }}>
                                    Количество страниц по уровням риска
                                </div>
                            </div>
                            {Array.isArray(summary.top_areas) && summary.top_areas.length > 0 && (
                                <div style={{ ...styles.card, minWidth: 260 }}>
                                    <div style={{ fontWeight: 700, marginBottom: 6, color: '#111' }}>Топ областей</div>
                                    <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 8 }}>
                                        Области с наибольшим количеством изменённых компонентов
                                    </div>
                                    {summary.top_areas.slice(0, 5).map((area, idx) => (
                                        <div key={`area-${idx}`} style={{ fontSize: 14, color: '#111', marginBottom: 4 }}>
                                            <strong>{area.area}:</strong> {area.components} компонентов
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Список затронутых страниц */}
                {Array.isArray(pages) && pages.length > 0 && (
                    <div style={{ marginBottom: 32 }}>
                        <h3 style={{ ...styles.subHeader, fontSize: 18, marginBottom: 16 }}>
                            Затронутые страницы ({pages.length})
                        </h3>

                        {/* Приоритетные страницы с HIGH риском */}
                        {pages.filter(page => page.ai_analysis?.risk_level === 'HIGH').length > 0 && (
                            <div style={{ marginBottom: 24 }}>
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#dc3545',
                                    marginBottom: '12px',
                                    padding: '8px 12px',
                                    backgroundColor: '#fff5f5',
                                    borderRadius: '6px',
                                    border: '1px solid #fecaca'
                                }}>
                                    ⚠️ Страницы с высоким риском (HIGH) - требуют особого внимания
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {pages
                                        .filter(page => page.ai_analysis?.risk_level === 'HIGH')
                                        .map((page, idx) => {
                                            const pageKey = `page-high-${idx}`;
                                            const isPageExpanded = !!expandedPageComponents[pageKey];
                                            return (
                                                <div key={pageKey} style={{
                                                    ...styles.card,
                                                    padding: 20,
                                                    border: '2px solid #dc3545',
                                                    backgroundColor: '#fff5f5'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ marginBottom: 6 }}>
                                                                <div style={{ fontWeight: 700, fontSize: 18, color: '#dc3545', marginBottom: 8 }}>
                                                                    {page.page_meta?.name}
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                                                    <span style={{
                                                                        padding: '6px 12px',
                                                                        borderRadius: 4,
                                                                        backgroundColor: '#dc3545',
                                                                        color: '#fff',
                                                                        fontSize: 12,
                                                                        fontWeight: 700
                                                                    }}>
                                                                        HIGH RISK
                                                                    </span>
                                                                    {page.page_meta?.env && (
                                                                        <span style={{
                                                                            padding: '4px 10px',
                                                                            borderRadius: 4,
                                                                            backgroundColor: '#6c757d',
                                                                            color: '#fff',
                                                                            fontSize: 11
                                                                        }}>
                                                                            {page.page_meta.env}
                                                                        </span>
                                                                    )}
                                                                    {page.page_meta?.route && (
                                                                        <span style={{
                                                                            padding: '4px 10px',
                                                                            borderRadius: 4,
                                                                            backgroundColor: '#17a2b8',
                                                                            color: '#fff',
                                                                            fontSize: 11,
                                                                            fontFamily: 'monospace'
                                                                        }}>
                                                                            {page.page_meta.route}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {page.page_meta?.human_title && (
                                                                <div style={{ fontSize: 13, color: '#495057', marginBottom: 6 }}>
                                                                    <span style={{ fontSize: 11, color: '#6c757d', marginRight: 4 }}>Название:</span>
                                                                    <span style={{ fontStyle: 'italic' }}>{page.page_meta.human_title}</span>
                                                                </div>
                                                            )}
                                                            {page.ai_analysis?.summary && (
                                                                <div style={{ marginTop: 12, color: '#111', fontSize: 14, lineHeight: 1.6, padding: '12px', backgroundColor: '#fff', borderRadius: '6px', border: '1px solid #fecaca' }}>
                                                                    {page.ai_analysis.summary}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => setExpandedPageComponents(prev => ({ ...prev, [pageKey]: !isPageExpanded }))}
                                                            style={{
                                                                padding: '8px 16px',
                                                                backgroundColor: '#dc3545',
                                                                color: '#fff',
                                                                border: 'none',
                                                                borderRadius: 4,
                                                                cursor: 'pointer',
                                                                fontSize: 14,
                                                                fontWeight: 600
                                                            }}
                                                        >
                                                            {isPageExpanded ? '▼ Скрыть' : '▶ Подробнее'}
                                                        </button>
                                                    </div>

                                                    {/* Зависимые компоненты */}
                                                    {(page.depends_on_components || []).length > 0 && (
                                                        <div style={{ marginTop: 16 }}>
                                                            <div style={{ fontWeight: 600, color: '#111', marginBottom: 8, fontSize: 14 }}>
                                                                Зависит от компонентов ({page.depends_on_components.length}):
                                                            </div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                                {page.depends_on_components.map((compName, cidx) => {
                                                                    const compDetail = uniqueMap[compName];
                                                                    return (
                                                                        <span
                                                                            key={`${pageKey}-comp-${cidx}`}
                                                                            title={compDetail?.file_path || compName}
                                                                            style={{
                                                                                padding: '6px 12px',
                                                                                backgroundColor: compDetail ? '#ffeaa7' : '#e9ecef',
                                                                                borderRadius: 4,
                                                                                fontSize: 12,
                                                                                color: '#111',
                                                                                fontWeight: 600,
                                                                                border: compDetail ? '1px solid #fdcb6e' : '1px solid #dee2e6',
                                                                                cursor: 'help'
                                                                            }}
                                                                        >
                                                                            {compName}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {isPageExpanded && (
                                                        <div style={{ marginTop: 20, paddingTop: 20, borderTop: '2px solid #fecaca' }}>
                                                            {renderQAAdvice(page.ai_analysis?.qa_advice || [])}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        )}

                        {/* Остальные страницы */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {pages
                                .filter(page => page.ai_analysis?.risk_level !== 'HIGH')
                                .map((page, idx) => {
                                    const pageKey = `page-${idx}`;
                                    const isPageExpanded = !!expandedPageComponents[pageKey];
                                    const riskColor = page.ai_analysis?.risk_level === 'HIGH' ? '#dc3545' :
                                        page.ai_analysis?.risk_level === 'MEDIUM' ? '#ffc107' : '#28a745';

                                    return (
                                        <div key={pageKey} style={{ ...styles.card, padding: 20 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ marginBottom: 6 }}>
                                                        <div style={{ fontWeight: 700, fontSize: 18, color: '#111', marginBottom: 8 }}>
                                                            {page.page_meta?.name}
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                                            {page.ai_analysis?.risk_level && (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ fontSize: 11, color: '#6c757d' }}>Приоритет риска:</span>
                                                                    <span style={{
                                                                        padding: '4px 10px',
                                                                        borderRadius: 4,
                                                                        backgroundColor: riskColor,
                                                                        color: '#fff',
                                                                        fontSize: 12,
                                                                        fontWeight: 600
                                                                    }}>
                                                                        {page.ai_analysis.risk_level}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {page.page_meta?.env && (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ fontSize: 11, color: '#6c757d' }}>Окружение:</span>
                                                                    <span style={{
                                                                        padding: '4px 10px',
                                                                        borderRadius: 4,
                                                                        backgroundColor: '#6c757d',
                                                                        color: '#fff',
                                                                        fontSize: 11
                                                                    }}>
                                                                        {page.page_meta.env}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {page.page_meta?.route && (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ fontSize: 11, color: '#6c757d' }}>Путь страницы:</span>
                                                                    <span style={{
                                                                        padding: '4px 10px',
                                                                        borderRadius: 4,
                                                                        backgroundColor: '#17a2b8',
                                                                        color: '#fff',
                                                                        fontSize: 11,
                                                                        fontFamily: 'monospace'
                                                                    }}>
                                                                        {page.page_meta.route}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {page.page_meta?.human_title && (
                                                        <div style={{ fontSize: 13, color: '#495057', marginBottom: 6 }}>
                                                            <span style={{ fontSize: 11, color: '#6c757d', marginRight: 4 }}>Название:</span>
                                                            <span style={{ fontStyle: 'italic' }}>{page.page_meta.human_title}</span>
                                                        </div>
                                                    )}
                                                    {Array.isArray(page.page_meta?.features) && page.page_meta.features.length > 0 && (
                                                        <div style={{ marginBottom: 6 }}>
                                                            <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 4 }}>Функциональные возможности:</div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                                {page.page_meta.features.map((feature, fidx) => (
                                                                    <span
                                                                        key={`${pageKey}-feature-${fidx}`}
                                                                        style={{
                                                                            padding: '3px 8px',
                                                                            backgroundColor: '#e7f3ff',
                                                                            borderRadius: 3,
                                                                            fontSize: 11,
                                                                            color: '#0056b3',
                                                                            fontWeight: 500
                                                                        }}
                                                                    >
                                                                        {feature}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {page.page_meta?.file_path && (
                                                        <div style={{ fontSize: 12, color: '#6c757d', marginTop: 4 }}>
                                                            <span style={{ fontSize: 11, color: '#6c757d', marginRight: 4 }}>Файл:</span>
                                                            {page.page_meta.file_path}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => setExpandedPageComponents(prev => ({ ...prev, [pageKey]: !isPageExpanded }))}
                                                    style={{
                                                        padding: '8px 16px',
                                                        backgroundColor: '#007bff',
                                                        color: '#fff',
                                                        border: 'none',
                                                        borderRadius: 4,
                                                        cursor: 'pointer',
                                                        fontSize: 14,
                                                        fontWeight: 600
                                                    }}
                                                >
                                                    {isPageExpanded ? '▼ Скрыть' : '▶ Подробнее'}
                                                </button>
                                            </div>

                                            {page.ai_analysis?.summary && (
                                                <div style={{ marginTop: 12, color: '#111', fontSize: 14, lineHeight: 1.6 }}>
                                                    {page.ai_analysis.summary}
                                                </div>
                                            )}

                                            {/* Зависимые компоненты - краткий список */}
                                            {(page.depends_on_components || []).length > 0 && (
                                                <div style={{ marginTop: 16 }}>
                                                    <div style={{ fontWeight: 600, color: '#111', marginBottom: 8, fontSize: 14 }}>
                                                        Зависит от компонентов ({page.depends_on_components.length}):
                                                    </div>
                                                    <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 8 }}>
                                                        Компоненты, изменения в которых могут повлиять на эту страницу
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                        {page.depends_on_components.map((compName, cidx) => (
                                                            <span
                                                                key={`${pageKey}-comp-${cidx}`}
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    backgroundColor: '#e9ecef',
                                                                    borderRadius: 4,
                                                                    fontSize: 12,
                                                                    color: '#111',
                                                                    fontWeight: 500
                                                                }}
                                                            >
                                                                {compName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Раскрываемая секция с деталями */}
                                            {isPageExpanded && (
                                                <div style={{ marginTop: 20, paddingTop: 20, borderTop: `2px solid ${styles.borderLight}` }}>
                                                    {renderQAAdvice(page.ai_analysis?.qa_advice || [])}

                                                    {/* Детали компонентов для этой страницы */}
                                                    {(page.depends_on_components || []).length > 0 && (
                                                        <div style={{ marginTop: 20 }}>
                                                            <div style={{ fontWeight: 700, color: '#111', marginBottom: 16, fontSize: 16 }}>
                                                                Детали затронутых компонентов
                                                            </div>
                                                            {(page.depends_on_components || []).map((compName, cidx) => {
                                                                const detail = uniqueMap[compName];
                                                                if (!detail) return null;
                                                                const compKey = `${pageKey}-comp-detail-${cidx}`;
                                                                const isCompExpanded = !!expandedPageComponents[compKey];

                                                                return (
                                                                    <div key={compKey} style={{
                                                                        marginBottom: 16,
                                                                        padding: 16,
                                                                        backgroundColor: '#f8f9fa',
                                                                        borderRadius: 8,
                                                                        border: `1px solid ${styles.borderLight}`
                                                                    }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                                                            <div style={{ flex: 1 }}>
                                                                                <div style={{ fontWeight: 600, color: '#111', fontSize: 15, marginBottom: 4 }}>{compName}</div>
                                                                                {detail.file_path && (
                                                                                    <div style={{ fontSize: 11, color: '#6c757d', fontFamily: 'monospace', marginBottom: 4, wordBreak: 'break-all' }}>
                                                                                        {detail.file_path}
                                                                                    </div>
                                                                                )}
                                                                                {detail.change_source && (
                                                                                    <div style={{ fontSize: 11, color: '#6c757d', marginBottom: 4 }}>
                                                                                        Источник: <strong style={{ color: '#495057' }}>{detail.change_source}</strong>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <button
                                                                                onClick={() => setExpandedPageComponents(prev => ({ ...prev, [compKey]: !isCompExpanded }))}
                                                                                style={{
                                                                                    padding: '6px 12px',
                                                                                    backgroundColor: '#6c757d',
                                                                                    color: '#fff',
                                                                                    border: 'none',
                                                                                    borderRadius: 4,
                                                                                    cursor: 'pointer',
                                                                                    fontSize: 13
                                                                                }}
                                                                            >
                                                                                {isCompExpanded ? 'Скрыть' : 'Детали'}
                                                                            </button>
                                                                        </div>
                                                                        {/* UI Trace для компонента в light режиме */}
                                                                        {detail.ui_context && detail.ui_context.uiElements && detail.ui_context.uiElements.length > 0 && (
                                                                            <div style={{ marginTop: 12, marginBottom: 12 }}>
                                                                                {renderUITrace({ uiContext: detail.ui_context })}
                                                                            </div>
                                                                        )}
                                                                        {isCompExpanded && (
                                                                            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${styles.borderLight}` }}>
                                                                                {detail.changed_methods?.length > 0 && (
                                                                                    <div style={{ marginBottom: 16 }}>
                                                                                        <div style={{ fontWeight: 600, color: '#111', marginBottom: 8 }}>Изменённые методы:</div>
                                                                                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                                                                                            {detail.changed_methods.map((m, mi) => {
                                                                                                const methodJSDoc = detail.method_jsdoc?.[m];
                                                                                                return (
                                                                                                    <li key={`${compKey}-m-${mi}`} style={{ fontSize: 14, color: '#111', marginBottom: 8 }}>
                                                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                                                            <code style={{ backgroundColor: '#f1f3f5', padding: '2px 8px', borderRadius: 3, fontSize: 13 }}>{m}</code>
                                                                                                            {methodJSDoc && (
                                                                                                                <div style={{
                                                                                                                    fontSize: '12px',
                                                                                                                    color: '#6c757d',
                                                                                                                    fontStyle: 'italic',
                                                                                                                    paddingLeft: '8px',
                                                                                                                    borderLeft: '2px solid #dee2e6'
                                                                                                                }}>
                                                                                                                    {methodJSDoc}
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    </li>
                                                                                                );
                                                                                            })}
                                                                                        </ul>
                                                                                    </div>
                                                                                )}
                                                                                {detail.diff_snippet && (
                                                                                    <div>
                                                                                        <div style={{ fontWeight: 600, color: '#111', marginBottom: 8 }}>Изменения в коде:</div>
                                                                                        <pre style={{
                                                                                            whiteSpace: 'pre-wrap',
                                                                                            backgroundColor: '#fff',
                                                                                            padding: 16,
                                                                                            borderRadius: 6,
                                                                                            border: `1px solid ${styles.borderLight}`,
                                                                                            color: '#111',
                                                                                            fontSize: 12,
                                                                                            overflowX: 'auto',
                                                                                            maxHeight: 400,
                                                                                            overflowY: 'auto',
                                                                                            lineHeight: 1.6
                                                                                        }}>
                                                                                            {detail.diff_snippet}
                                                                                        </pre>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                )}

                {/* Список всех уникальных компонентов */}
                {uniqueMap && Object.keys(uniqueMap).length > 0 && (
                    <div>
                        <h3 style={{ ...styles.subHeader, fontSize: 18, marginBottom: 8 }}>
                            Все затронутые компоненты ({Object.keys(uniqueMap).length})
                        </h3>
                        <div style={{ fontSize: 13, color: '#6c757d', marginBottom: 16 }}>
                            Полный список всех компонентов, в которых были внесены изменения. Каждый компонент может использоваться на нескольких страницах.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {Object.entries(uniqueMap).map(([compName, detail], idx) => {
                                const compKey = `unique-comp-${idx}`;
                                const isExpanded = !!expandedUniqueComponents[compKey];

                                return (
                                    <div key={compKey} style={{
                                        ...styles.card,
                                        padding: 20,
                                        border: `2px solid ${styles.borderLight}`
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontWeight: 700, fontSize: 16, color: '#111', marginBottom: 6 }}>
                                                    {compName}
                                                </div>
                                                {detail.file_path && (
                                                    <div style={{ fontSize: 12, color: '#6c757d', marginBottom: 6 }}>
                                                        {detail.file_path}
                                                    </div>
                                                )}
                                                {detail.change_source && (
                                                    <div style={{ fontSize: 13, color: '#111', marginBottom: 4 }}>
                                                        <span style={{ fontSize: 12, color: '#6c757d' }}>Источник изменений:</span> <strong>{detail.change_source}</strong>
                                                        <span style={{ fontSize: 11, color: '#6c757d', marginLeft: 8 }}>
                                                            ({detail.change_source === 'LOGIC' ? 'изменения в логике' : 'другие изменения'})
                                                        </span>
                                                    </div>
                                                )}
                                                {detail.changed_methods?.length > 0 && (
                                                    <div style={{ marginTop: 8, fontSize: 14, color: '#111' }}>
                                                        Изменено методов: <strong>{detail.changed_methods.length}</strong>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setExpandedUniqueComponents(prev => ({ ...prev, [compKey]: !isExpanded }))}
                                                style={{
                                                    padding: '8px 16px',
                                                    backgroundColor: '#007bff',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: 4,
                                                    cursor: 'pointer',
                                                    fontSize: 14,
                                                    fontWeight: 600
                                                }}
                                            >
                                                {isExpanded ? '▼ Скрыть детали' : '▶ Показать детали'}
                                            </button>
                                        </div>

                                        {isExpanded && (
                                            <div style={{ marginTop: 20, paddingTop: 20, borderTop: `2px solid ${styles.borderLight}` }}>
                                                {detail.changed_methods?.length > 0 && (
                                                    <div style={{ marginBottom: 20 }}>
                                                        <div style={{ fontWeight: 600, color: '#111', marginBottom: 12, fontSize: 15 }}>
                                                            Изменённые методы:
                                                        </div>
                                                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                                                            {detail.changed_methods.map((m, mi) => (
                                                                <li key={`${compKey}-method-${mi}`} style={{ fontSize: 14, color: '#111', marginBottom: 8 }}>
                                                                    <code style={{ backgroundColor: '#f1f3f5', padding: '4px 10px', borderRadius: 4, fontSize: 13, fontWeight: 500 }}>{m}</code>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                                {detail.diff_snippet && (
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: '#111', marginBottom: 12, fontSize: 15 }}>
                                                            Изменения в коде:
                                                        </div>
                                                        <pre style={{
                                                            whiteSpace: 'pre-wrap',
                                                            backgroundColor: '#fff',
                                                            padding: 20,
                                                            borderRadius: 8,
                                                            border: `1px solid ${styles.borderLight}`,
                                                            color: '#111',
                                                            fontSize: 12,
                                                            overflowX: 'auto',
                                                            maxHeight: 500,
                                                            overflowY: 'auto',
                                                            lineHeight: 1.6
                                                        }}>
                                                            {detail.diff_snippet}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={styles.container}>
            {/* Глобальный фоновый прогресс-бар */}
            <GlobalBackgroundProgress />

            <div style={styles.headerSection}>
                <h1 style={styles.title}>Test Impact Analysis (TIA)</h1>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <button style={styles.backButton} onClick={() => navigate('/')}>
                        Назад
                    </button>
                    <button
                        style={{
                            ...styles.backButton,
                            backgroundColor: '#007bff',
                            color: '#fff',
                            borderColor: '#007bff',
                        }}
                        onClick={() => navigate('/heatmap')}
                    >
                        Тепловая карта дефектов
                    </button>
                </div>
            </div>


            <div style={styles.form}>
                <div style={{ ...styles.formGroup, display: 'flex', gap: 12, alignItems: 'center', color: '#111' }}>
                    <label style={styles.label}>Режим:</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#111' }}>
                        <input
                            type="radio"
                            name="tia-mode"
                            value="mapping"
                            checked={mode === 'mapping'}
                            onChange={() => setMode('mapping')}
                            style={{ margin: 0 }}
                        />
                        Маппинг
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#111' }}>
                        <input
                            type="radio"
                            name="tia-mode"
                            value="light"
                            checked={mode === 'light'}
                            onChange={() => setMode('light')}
                            style={{ margin: 0 }}
                        />
                        Лайт-режим
                    </label>
                </div>
                <div style={styles.formGroup}>
                    <label style={styles.label}>Выберите проект:</label>
                    <select
                        value={projectId}
                        onChange={handleProjectChange}
                        style={styles.select}
                        disabled={isLoading || structureLoading}
                    >
                        <option value="">-- Выберите проект --</option>
                        {projects.map((proj) => (
                            <option key={proj.id} value={proj.id}>
                                {proj.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON фронтенда или TIA (опционально):</label>
                    <div style={styles.uploadContainer}>
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleFrontendJSONUpload}
                            style={styles.fileInput}
                            disabled={isLoading || structureLoading}
                        />
                        {frontendJSON && <span style={styles.fileName}>Файл: {frontendJSON.name || 'frontend.json'}</span>}
                        {tiaReport && <span style={styles.fileName}>Файл: {tiaFileName || 'tia.json'}</span>}
                    </div>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON бэкенда (опционально):</label>
                    <div style={styles.uploadContainer}>
                        <input
                            type="file"
                            accept=".json"
                            onChange={handleBackendJSONUpload}
                            style={styles.fileInput}
                            disabled={isLoading || structureLoading}
                        />
                        {backendJSON && <span style={styles.fileName}>Файл: {backendJSON.name || 'backend.json'}</span>}
                    </div>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Ссылка на задачу Jira:</label>
                    <input
                        type="text"
                        value={jiraLink}
                        onChange={handleJiraLinkChange}
                        placeholder="https://jira.abanking.ru/browse/CTMM-528"
                        style={styles.jiraInput}
                        disabled={isLoading || structureLoading}
                    />
                </div>

                {mode === 'mapping' && (
                    structureLoading ? (
                        <div style={styles.loader}><Loader /></div>
                    ) : folders.length > 0 && (
                        <div style={styles.mappingSection}>
                            <h2 style={styles.subHeader}>Структура папок</h2>
                            {renderFolderTree(filterFoldersForProject(folders))}
                        </div>
                    )
                )}
                {renderLightSummary()}
            </div>

            <div style={styles.footer}>
                {error && <div style={styles.error}>{error}</div>}
                {successMessage && (
                    <div>
                        {successMessage}
                        {allureLink && (
                            <a href={allureLink} target="_blank" rel="noopener noreferrer" style={styles.successLink}>
                                Перейти к запуску в Allure
                            </a>
                        )}
                    </div>
                )}
                {isLoading && !structureLoading && <div style={styles.loader}><Loader /></div>}
                {mode === 'mapping' && (
                    <button
                        onClick={handleCreateTestPlan}
                        disabled={isCreateButtonDisabled()}
                        style={styles.submitButton}
                    >
                        {isLoading ? <Loader style={{ display: 'inline-block', width: '20px', height: '20px', verticalAlign: 'middle' }} /> : 'Создать тест-план'}
                    </button>
                )}
            </div>
            {showMappingModal && (
                <div
                    style={{
                        ...styles.modalOverlay,
                        position: 'fixed',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        zIndex: 1000
                    }}
                >
                    <div
                        style={{
                            ...styles.modal,
                            backgroundColor: '#ffffff',
                            padding: '0',
                            borderRadius: '12px',
                            width: '95vw',
                            maxWidth: '1400px',
                            height: '90vh',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)'
                        }}
                    >
                        {/* Заголовок */}
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '2px solid #ced4da',
                            backgroundColor: '#f8f9fa'
                        }}>
                            <h2 style={{
                                fontSize: '24px',
                                margin: 0,
                                color: '#2c3e50',
                                fontWeight: 700
                            }}>
                                Сопоставление компонентов
                            </h2>
                            {(partialSaveMessage || error) && (
                                <div style={{ marginTop: '12px' }}>
                                    {partialSaveMessage && (
                                        <div style={{
                                            padding: '8px 12px',
                                            backgroundColor: '#e6ffed',
                                            borderRadius: '4px',
                                            color: '#22863a',
                                            fontSize: '14px'
                                        }}>
                                            {partialSaveMessage}
                                        </div>
                                    )}
                                    {error && (
                                        <div style={{
                                            padding: '8px 12px',
                                            backgroundColor: '#ffeef0',
                                            borderRadius: '4px',
                                            color: '#cb2431',
                                            fontSize: '14px'
                                        }}>
                                            {error}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Основной контент - две колонки */}
                        <div style={{
                            display: 'flex',
                            flex: 1,
                            overflow: 'hidden'
                        }}>
                            {/* Левая колонка: Что затронуто */}
                            <div style={{
                                width: '50%',
                                borderRight: '2px solid #ced4da',
                                padding: '20px',
                                overflowY: 'auto',
                                backgroundColor: '#ffffff'
                            }}>
                                <div style={{ marginBottom: '16px' }}>
                                    <h3 style={{
                                        fontSize: '18px',
                                        fontWeight: 600,
                                        color: '#2c3e50',
                                        marginBottom: '12px',
                                        marginTop: 0
                                    }}>
                                        Что затронуто
                                    </h3>
                                    {/* Глобальные риски в режиме маппинга */}
                                    {tiaReport?.summary?.global_risks && tiaReport.summary.global_risks.length > 0 && (
                                        <div style={{
                                            padding: '12px',
                                            backgroundColor: '#fff5f5',
                                            borderRadius: '8px',
                                            border: '2px solid #dc3545',
                                            marginBottom: '12px'
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                marginBottom: '8px'
                                            }}>
                                                <span style={{ fontSize: '18px', color: '#dc3545' }}>⚠️</span>
                                                <span style={{
                                                    fontSize: '13px',
                                                    fontWeight: 700,
                                                    color: '#dc3545'
                                                }}>
                                                    Глобальные риски: {tiaReport.summary.global_risks.length}
                                                </span>
                                            </div>
                                            {tiaReport.summary.global_risks.map((risk, ridx) => (
                                                <div key={`global-risk-mapping-${ridx}`} style={{
                                                    fontSize: '12px',
                                                    color: '#111',
                                                    marginTop: ridx > 0 ? '8px' : '0',
                                                    paddingTop: ridx > 0 ? '8px' : '0',
                                                    borderTop: ridx > 0 ? '1px solid #fecaca' : 'none'
                                                }}>
                                                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                                        {risk.source} <span style={{ color: '#dc3545' }}>({risk.risk_level})</span>
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: '#6c757d', lineHeight: 1.4 }}>
                                                        {risk.description}
                                                    </div>
                                                    {risk.affected_pages_count && (
                                                        <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '4px' }}>
                                                            Затронуто страниц: <strong>{risk.affected_pages_count}</strong>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {/* Статистика */}
                                    {tiaReport?.summary && (
                                        <div style={{
                                            display: 'flex',
                                            gap: '12px',
                                            flexWrap: 'wrap',
                                            fontSize: '12px',
                                            color: '#6c757d',
                                            marginBottom: '8px',
                                            padding: '8px',
                                            backgroundColor: '#f8f9fa',
                                            borderRadius: '6px'
                                        }}>
                                            <span>
                                                <strong style={{ color: '#111' }}>Компонентов:</strong> {components.length}
                                            </span>
                                            {tiaReport.summary.test_coverage_percent !== undefined && (
                                                <>
                                                    <span>•</span>
                                                    <span>
                                                        <strong>Coverage:</strong> {tiaReport.summary.test_coverage_percent.toFixed(1)}%
                                                    </span>
                                                </>
                                            )}
                                            {tiaReport.summary.risk_counts && (
                                                <>
                                                    <span>•</span>
                                                    <span>
                                                        <strong style={{ color: '#dc3545' }}>HIGH:</strong> {tiaReport.summary.risk_counts.HIGH || 0}
                                                    </span>
                                                    <span>•</span>
                                                    <span>
                                                        <strong style={{ color: '#ffc107' }}>MEDIUM:</strong> {tiaReport.summary.risk_counts.MEDIUM || 0}
                                                    </span>
                                                    <span>•</span>
                                                    <span>
                                                        <strong style={{ color: '#28a745' }}>LOW:</strong> {tiaReport.summary.risk_counts.LOW || 0}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {components.length === 0 ? (
                                    <div style={{
                                        padding: '16px',
                                        backgroundColor: '#ffebee',
                                        borderRadius: '8px',
                                        color: '#721c24',
                                        textAlign: 'center'
                                    }}>
                                        Компоненты не найдены. Проверьте загруженные JSON-файлы.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {components.map(comp => {
                                            const pages = getPagesUsingComponent(comp.name);
                                            const changeSummary = getComponentChangeSummary(comp);
                                            const riskColor = comp.riskLevel === 'HIGH' ? '#dc3545' :
                                                comp.riskLevel === 'MEDIUM' ? '#ffc107' : '#28a745';
                                            const isSelected = selectedComponentId === comp.id;
                                            const hasMapping = componentMappings[comp.id]?.length > 0;

                                            return (
                                                <div
                                                    key={comp.id}
                                                    onClick={() => setSelectedComponentId(comp.id)}
                                                    style={{
                                                        padding: '16px',
                                                        backgroundColor: isSelected ? '#e7f3ff' : '#f8f9fa',
                                                        borderRadius: '8px',
                                                        border: `2px solid ${isSelected ? '#007bff' : '#dee2e6'}`,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s',
                                                        boxShadow: hasMapping ? '0 2px 8px rgba(40, 167, 69, 0.2)' : '0 2px 4px rgba(0, 0, 0, 0.05)'
                                                    }}
                                                >
                                                    {/* Заголовок компонента */}
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        marginBottom: '12px'
                                                    }}>
                                                        <div style={{
                                                            fontSize: '18px',
                                                            fontWeight: 700,
                                                            color: hasMapping ? '#28a745' : '#2c3e50'
                                                        }}>
                                                            {comp.name}
                                                        </div>
                                                        {comp.riskLevel && (
                                                            <span style={{
                                                                padding: '4px 12px',
                                                                borderRadius: '4px',
                                                                backgroundColor: riskColor,
                                                                color: '#fff',
                                                                fontSize: '12px',
                                                                fontWeight: 600
                                                            }}>
                                                                {comp.riskLevel}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Env, JSDoc и File Path */}
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '8px',
                                                        marginBottom: '12px'
                                                    }}>
                                                        <div style={{
                                                            display: 'flex',
                                                            flexWrap: 'wrap',
                                                            gap: '8px',
                                                            alignItems: 'center'
                                                        }}>
                                                            {comp.envs && comp.envs.length > 0 && (
                                                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                                    {comp.envs.map((env, eidx) => (
                                                                        <span
                                                                            key={`${comp.id}-env-${eidx}`}
                                                                            style={{
                                                                                padding: '3px 8px',
                                                                                backgroundColor: '#6c757d',
                                                                                color: '#fff',
                                                                                borderRadius: '3px',
                                                                                fontSize: '11px',
                                                                                fontWeight: 500
                                                                            }}
                                                                        >
                                                                            {env}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            {comp.jsdoc && (
                                                                <div style={{
                                                                    fontSize: '12px',
                                                                    color: '#495057',
                                                                    fontStyle: 'italic',
                                                                    padding: '4px 8px',
                                                                    backgroundColor: '#f8f9fa',
                                                                    borderRadius: '4px',
                                                                    border: '1px solid #dee2e6'
                                                                }}>
                                                                    📝 {comp.jsdoc}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {comp.serviceName && (
                                                            <div style={{
                                                                fontSize: '11px',
                                                                color: '#6c757d',
                                                                fontFamily: 'monospace',
                                                                padding: '4px 8px',
                                                                backgroundColor: '#f8f9fa',
                                                                borderRadius: '4px',
                                                                border: '1px solid #dee2e6',
                                                                wordBreak: 'break-all'
                                                            }}>
                                                                📁 {comp.serviceName}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* UI Trace блок */}
                                                    {renderUITrace(comp)}

                                                    {/* Суть изменений */}
                                                    <div style={{
                                                        fontSize: '14px',
                                                        color: '#495057',
                                                        marginBottom: '12px',
                                                        lineHeight: 1.5
                                                    }}>
                                                        {changeSummary}
                                                    </div>

                                                    {/* Сценарии тестирования (QA Advice) */}
                                                    {comp.qaAdvice && comp.qaAdvice.length > 0 && (
                                                        <div style={{ marginBottom: '12px' }}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExpandedScenarios(prev => ({
                                                                        ...prev,
                                                                        [comp.id]: !prev[comp.id]
                                                                    }));
                                                                }}
                                                                style={{
                                                                    padding: '6px 12px',
                                                                    backgroundColor: '#28a745',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '12px',
                                                                    fontWeight: 600,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px',
                                                                    width: '100%',
                                                                    justifyContent: 'space-between'
                                                                }}
                                                            >
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    {expandedScenarios[comp.id] ? '▼' : '▶'}
                                                                    Сценарии тестирования
                                                                    <span style={{
                                                                        fontSize: '11px',
                                                                        backgroundColor: 'rgba(255, 255, 255, 0.3)',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '10px',
                                                                        marginLeft: '4px'
                                                                    }}>
                                                                        {comp.qaAdvice.reduce((sum, advice) => sum + (advice.scenarios?.length || 0), 0)}
                                                                    </span>
                                                                </span>
                                                            </button>
                                                            {expandedScenarios[comp.id] && (
                                                                <div style={{
                                                                    marginTop: '8px',
                                                                    padding: '12px',
                                                                    backgroundColor: '#f0f9ff',
                                                                    borderRadius: '6px',
                                                                    border: '1px solid #b3d9ff'
                                                                }}>
                                                                    {comp.qaAdvice.map((advice, aidx) => {
                                                                        const priorityColor = advice.priority === 'HIGH' ? '#dc3545' :
                                                                            advice.priority === 'MEDIUM' ? '#ffc107' : '#28a745';
                                                                        return (
                                                                            <div key={`${comp.id}-advice-${aidx}`} style={{
                                                                                marginBottom: aidx < comp.qaAdvice.length - 1 ? '16px' : '0',
                                                                                paddingBottom: aidx < comp.qaAdvice.length - 1 ? '16px' : '0',
                                                                                borderBottom: aidx < comp.qaAdvice.length - 1 ? '1px solid #b3d9ff' : 'none'
                                                                            }}>
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '8px',
                                                                                    marginBottom: '8px',
                                                                                    flexWrap: 'wrap'
                                                                                }}>
                                                                                    <span style={{
                                                                                        padding: '3px 8px',
                                                                                        backgroundColor: priorityColor,
                                                                                        color: '#fff',
                                                                                        borderRadius: '3px',
                                                                                        fontSize: '11px',
                                                                                        fontWeight: 600
                                                                                    }}>
                                                                                        {advice.priority}
                                                                                    </span>
                                                                                    <span style={{
                                                                                        fontSize: '12px',
                                                                                        fontWeight: 600,
                                                                                        color: '#111'
                                                                                    }}>
                                                                                        {advice.area}
                                                                                    </span>
                                                                                    {advice.scenarios && (
                                                                                        <span style={{
                                                                                            fontSize: '11px',
                                                                                            color: '#6c757d'
                                                                                        }}>
                                                                                            ({advice.scenarios.length} сценариев)
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                {advice.scenarios && advice.scenarios.length > 0 && (
                                                                                    <ol style={{
                                                                                        margin: 0,
                                                                                        paddingLeft: '20px',
                                                                                        listStyle: 'decimal',
                                                                                        color: '#111'
                                                                                    }}>
                                                                                        {advice.scenarios.map((scenario, sidx) => (
                                                                                            <li key={`${comp.id}-scenario-${aidx}-${sidx}`} style={{
                                                                                                fontSize: '13px',
                                                                                                color: '#111',
                                                                                                marginBottom: '6px',
                                                                                                lineHeight: 1.5,
                                                                                                paddingLeft: '4px'
                                                                                            }}>
                                                                                                {scenario}
                                                                                            </li>
                                                                                        ))}
                                                                                    </ol>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Технические детали (скрыты под спойлер) */}
                                                    {(comp.nestedComponents?.[0]?.changed_methods?.length > 0 || comp.nestedComponents?.[0]?.diff_snippet) && (
                                                        <div style={{ marginBottom: '12px' }}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExpandedTechnicalDetails(prev => ({
                                                                        ...prev,
                                                                        [comp.id]: !prev[comp.id]
                                                                    }));
                                                                }}
                                                                style={{
                                                                    padding: '6px 12px',
                                                                    backgroundColor: '#6c757d',
                                                                    color: '#fff',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    cursor: 'pointer',
                                                                    fontSize: '12px',
                                                                    fontWeight: 600,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '6px'
                                                                }}
                                                            >
                                                                {expandedTechnicalDetails[comp.id] ? '▼' : '▶'}
                                                                Показать код
                                                            </button>
                                                            {expandedTechnicalDetails[comp.id] && (
                                                                <div style={{
                                                                    marginTop: '8px',
                                                                    padding: '12px',
                                                                    backgroundColor: '#f8f9fa',
                                                                    borderRadius: '6px',
                                                                    border: '1px solid #dee2e6'
                                                                }}>
                                                                    {/* Методы с JSDoc */}
                                                                    {comp.nestedComponents?.[0]?.changed_methods?.length > 0 && (
                                                                        <div style={{ marginBottom: comp.nestedComponents[0].diff_snippet ? '12px' : '0' }}>
                                                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#495057', marginBottom: '8px' }}>
                                                                                Измененные методы:
                                                                            </div>
                                                                            <ul style={{
                                                                                margin: 0,
                                                                                paddingLeft: '20px',
                                                                                listStyle: 'disc',
                                                                                color: '#111'
                                                                            }}>
                                                                                {comp.nestedComponents[0].changed_methods.map((method, midx) => {
                                                                                    const methodJSDoc = comp.nestedComponents[0].method_jsdoc?.[method];
                                                                                    return (
                                                                                        <li key={`${comp.id}-method-${midx}`} style={{
                                                                                            marginBottom: '8px',
                                                                                            fontSize: '13px',
                                                                                            color: '#111'
                                                                                        }}>
                                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                                                <code style={{
                                                                                                    backgroundColor: '#e9ecef',
                                                                                                    padding: '2px 6px',
                                                                                                    borderRadius: '3px',
                                                                                                    fontSize: '12px',
                                                                                                    fontFamily: 'monospace'
                                                                                                }}>
                                                                                                    {method}
                                                                                                </code>
                                                                                                {methodJSDoc && (
                                                                                                    <div style={{
                                                                                                        fontSize: '11px',
                                                                                                        color: '#6c757d',
                                                                                                        fontStyle: 'italic',
                                                                                                        paddingLeft: '8px',
                                                                                                        borderLeft: '2px solid #dee2e6'
                                                                                                    }}>
                                                                                                        {methodJSDoc}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </li>
                                                                                    );
                                                                                })}
                                                                            </ul>
                                                                        </div>
                                                                    )}
                                                                    {/* Diff snippet */}
                                                                    {comp.nestedComponents?.[0]?.diff_snippet && (
                                                                        <div>
                                                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#495057', marginBottom: '8px' }}>
                                                                                Изменения в коде:
                                                                            </div>
                                                                            <pre style={{
                                                                                margin: 0,
                                                                                padding: '12px',
                                                                                backgroundColor: '#2d2d2d',
                                                                                color: '#f8f8f2',
                                                                                borderRadius: '4px',
                                                                                fontSize: '11px',
                                                                                fontFamily: 'monospace',
                                                                                overflow: 'auto',
                                                                                maxHeight: '300px',
                                                                                whiteSpace: 'pre-wrap',
                                                                                wordBreak: 'break-word'
                                                                            }}>
                                                                                {comp.nestedComponents[0].diff_snippet}
                                                                            </pre>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Где используется */}
                                                    {pages.length > 0 && (
                                                        <div style={{ marginTop: '12px' }}>
                                                            <div style={{
                                                                fontSize: '12px',
                                                                color: '#6c757d',
                                                                marginBottom: '8px',
                                                                fontWeight: 600
                                                            }}>
                                                                Где используется ({pages.length}):
                                                            </div>
                                                            <div style={{
                                                                display: 'flex',
                                                                flexWrap: 'wrap',
                                                                gap: '6px'
                                                            }}>
                                                                {pages.map((page, idx) => {
                                                                    const pageName = page.page_meta?.name || 'Unknown';
                                                                    const pageRoute = page.page_meta?.route;
                                                                    const tooltipText = [
                                                                        page.page_meta?.human_title,
                                                                        pageRoute ? `Route: ${pageRoute}` : null,
                                                                        page.page_meta?.file_path
                                                                    ].filter(Boolean).join('\n');

                                                                    return (
                                                                        <div key={`${comp.id}-page-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                                            <span
                                                                                title={tooltipText}
                                                                                style={{
                                                                                    padding: '4px 10px',
                                                                                    backgroundColor: '#e9ecef',
                                                                                    borderRadius: '4px',
                                                                                    fontSize: '12px',
                                                                                    color: '#111',
                                                                                    fontWeight: 500,
                                                                                    cursor: 'help',
                                                                                    display: 'inline-flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '6px'
                                                                                }}
                                                                            >
                                                                                <span>{pageName}</span>
                                                                                {pageRoute && (
                                                                                    <span style={{
                                                                                        fontSize: '11px',
                                                                                        color: '#6c757d',
                                                                                        fontFamily: 'monospace',
                                                                                        backgroundColor: '#dee2e6',
                                                                                        padding: '2px 6px',
                                                                                        borderRadius: '3px'
                                                                                    }}>
                                                                                        {pageRoute}
                                                                                    </span>
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Выбранные маппинги */}
                                                    {hasMapping && (
                                                        <div style={{
                                                            marginTop: '12px',
                                                            paddingTop: '12px',
                                                            borderTop: '1px solid #dee2e6'
                                                        }}>
                                                            <div style={{
                                                                fontSize: '12px',
                                                                color: '#6c757d',
                                                                marginBottom: '6px',
                                                                fontWeight: 600
                                                            }}>
                                                                Покрыто:
                                                            </div>
                                                            <div style={{
                                                                display: 'flex',
                                                                flexWrap: 'wrap',
                                                                gap: '6px'
                                                            }}>
                                                                {componentMappings[comp.id].map(folderId => {
                                                                    const folder = findFolderById(folders, parseInt(folderId));
                                                                    const isAutoMapped = autoMappedBlocks[comp.id]?.includes(folderId);
                                                                    return folder ? (
                                                                        <span
                                                                            key={folderId}
                                                                            title={isAutoMapped ? 'Автоматически добавлен из связанной Page' : ''}
                                                                            style={{
                                                                                padding: '4px 10px',
                                                                                backgroundColor: isAutoMapped ? '#fff3cd' : '#d4edda',
                                                                                borderRadius: '4px',
                                                                                fontSize: '12px',
                                                                                color: isAutoMapped ? '#856404' : '#155724',
                                                                                fontWeight: 500,
                                                                                border: isAutoMapped ? '1px solid #ffc107' : 'none',
                                                                                display: 'inline-flex',
                                                                                alignItems: 'center',
                                                                                gap: '4px'
                                                                            }}
                                                                        >
                                                                            {isAutoMapped && '🔄 '}
                                                                            {formatCustomFieldName(folder, 0)}
                                                                        </span>
                                                                    ) : null;
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Правая колонка: Чем покрыть */}
                            <div style={{
                                width: '50%',
                                padding: '20px',
                                overflowY: 'auto',
                                backgroundColor: '#ffffff',
                                display: 'flex',
                                flexDirection: 'column'
                            }}>
                                <h3 style={{
                                    fontSize: '18px',
                                    fontWeight: 600,
                                    color: '#2c3e50',
                                    marginBottom: '16px',
                                    marginTop: 0
                                }}>
                                    Чем покрыть
                                </h3>

                                {/* Поиск по дереву */}
                                <input
                                    type="text"
                                    placeholder="Поиск по дереву фич..."
                                    value={folderSearchTerm}
                                    onChange={(e) => setFolderSearchTerm(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: '6px',
                                        border: '1px solid #ced4da',
                                        fontSize: '14px',
                                        marginBottom: '16px',
                                        boxSizing: 'border-box'
                                    }}
                                />

                                {/* Дерево фич */}
                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    padding: '12px',
                                    backgroundColor: '#f8f9fa',
                                    borderRadius: '8px',
                                    position: 'relative'
                                }}>
                                    {!selectedComponentId && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '12px',
                                            left: '12px',
                                            right: '12px',
                                            padding: '12px',
                                            backgroundColor: '#fff3cd',
                                            border: '1px solid #ffc107',
                                            borderRadius: '6px',
                                            fontSize: '13px',
                                            color: '#856404',
                                            zIndex: 10,
                                            marginBottom: '12px'
                                        }}>
                                            💡 Выберите компонент слева, чтобы связать его с фичами
                                        </div>
                                    )}
                                    {folders && folders.length > 0 ? (
                                        <div style={{ marginTop: !selectedComponentId ? '60px' : '0' }}>
                                            {renderFolderTreeForMapping(
                                                filterFolders(filterFoldersForProject(folders), folderSearchTerm),
                                                selectedComponentId
                                            )}
                                        </div>
                                    ) : (
                                        <div style={{
                                            padding: '40px',
                                            textAlign: 'center',
                                            color: '#6c757d',
                                            fontSize: '14px'
                                        }}>
                                            {structureLoading ? 'Загрузка структуры...' : 'Нет доступных фич. Загрузите структуру проекта.'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div style={{
                            padding: '16px 24px',
                            borderTop: '2px solid #ced4da',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '16px',
                            backgroundColor: '#f8f9fa'
                        }}>
                            <button
                                onClick={handleMappingCancel}
                                style={styles.modalButtonCancel}
                                disabled={isPartialSaving || isMappingLoading}
                            >
                                Отмена
                            </button>
                            <button
                                onClick={handlePartialSave}
                                style={styles.modalButtonSave}
                                disabled={isPartialSaving || isMappingLoading}
                            >
                                {isPartialSaving
                                    ? <Loader style={{ width: 20, height: 20 }} />
                                    : 'Сохранить маппинг'}
                            </button>
                            <button
                                onClick={() => handleMappingConfirm('launch')}
                                style={{
                                    ...styles.modalButtonConfirm,
                                    opacity: (loadingState.testplan || loadingState.launch) ? 0.7 : 1,
                                    cursor: (loadingState.testplan || loadingState.launch) ? 'not-allowed' : 'pointer'
                                }}
                                disabled={isPartialSaving || isMappingLoading || loadingState.launch || loadingState.testplan || isMappingConfirmButtonDisabled}
                            >
                                {loadingState.launch
                                    ? <Loader style={{ width: 20, height: 20 }} />
                                    : 'Создать запуск'}
                            </button>
                            <button
                                onClick={() => handleMappingConfirm('testplan')}
                                style={{
                                    ...styles.modalButtonConfirm,
                                    backgroundColor: '#28a745',
                                    opacity: (loadingState.testplan || loadingState.launch) ? 0.7 : 1,
                                    cursor: (loadingState.testplan || loadingState.launch) ? 'not-allowed' : 'pointer'
                                }}
                                disabled={isPartialSaving || isMappingLoading || loadingState.launch || loadingState.testplan || isMappingConfirmButtonDisabled}
                            >
                                {loadingState.testplan
                                    ? <Loader style={{ width: 20, height: 20 }} />
                                    : 'Создать тест-план'}
                            </button>
                        </div>
                        {progress && (
                            <div style={{ marginTop: '15px', width: '100%', textAlign: 'center' }}>
                                <div style={{ marginBottom: '5px', fontSize: '14px', color: '#555' }}>
                                    {progress.message}
                                </div>
                                {progress.total > 0 && (
                                    <div style={{ width: '100%', height: '8px', backgroundColor: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }}>
                                        <div
                                            style={{
                                                width: `${(progress.current / progress.total) * 100}%`,
                                                height: '100%',
                                                backgroundColor: '#28a745',
                                                transition: 'width 0.3s ease'
                                            }}
                                        />
                                    </div>
                                )}
                                {progress.total > 0 && (
                                    <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>
                                        {progress.current} / {progress.total}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Новые стили для react-select
const selectStyles = {
    control: (provided) => ({
        ...provided,
        minHeight: '38px',
        width: '100%', // Занимает всю доступную ширину
        minWidth: '300px', // Минимальная ширина
        borderRadius: '8px',
        border: `1px solid ${styles.borderLight}`,
        boxShadow: 'none',
        '&:hover': { borderColor: styles.primary },
    }),
    multiValue: (provided) => ({
        ...provided,
        backgroundColor: styles.lightGray,
        borderRadius: '4px',
    }),
    multiValueLabel: (provided) => ({
        ...provided,
        color: styles.textDark,
    }),
    multiValueRemove: (provided) => ({
        ...provided,
        color: styles.textMuted,
        '&:hover': { backgroundColor: styles.danger, color: 'white' },
    }),
    menu: (provided) => ({
        ...provided,
        zIndex: 1001,
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        maxHeight: '300px', // Ограничиваем высоту меню
        overflowY: 'auto',  // Добавляем вертикальный скролл
        color: styles.textDark
    }),
    menuList: (provided) => ({
        ...provided,
        maxHeight: '300px', // Ограничиваем высоту списка
        padding: '8px',     // Добавляем отступы для красоты
        color: styles.textDark
    })
};

export default TIAPage;