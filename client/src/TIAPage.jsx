import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import Select from 'react-select'; // Импортируем react-select для мультиселекта
import { useNavigate } from 'react-router-dom'; // Для навигации назад
import styles from './styles'; // Импортируем стили
import Loader from './Loader'; // Предполагаем, что есть компонент Loader
import config from './config';
import GlobalBackgroundProgress from './components/GlobalBackgroundProgress';
import { trackEvent } from './analytics';

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
    const [frontendFileName, setFrontendFileName] = useState('');
    const [backendFileName, setBackendFileName] = useState('');
    const [mode, setMode] = useState('mapping'); // mapping | light
    const [expandedDetails, setExpandedDetails] = useState({});
    const [expandedPageComponents, setExpandedPageComponents] = useState({});
    const [expandedUniqueComponents, setExpandedUniqueComponents] = useState({});
    const [selectedComponentId, setSelectedComponentId] = useState(null); // Выбранный компонент для маппинга
    const [folderSearchTerm, setFolderSearchTerm] = useState(''); // Поиск по дереву фич
    const [expandedMethods, setExpandedMethods] = useState({}); // Раскрытие списка методов для компонентов
    const [expandedTechnicalDetails, setExpandedTechnicalDetails] = useState({}); // Раскрытие технических деталей (методы + diff)
    const [expandedScenarios, setExpandedScenarios] = useState({}); // Раскрытие сценариев для компонентов
    // State for expanded UI trace page lists (key: compId-index)
    const [expandedPageLists, setExpandedPageLists] = useState({});

    // Состояния для маппинга компонентов
    const [components, setComponents] = useState([]); // Список всех компонентов
    const [componentMappings, setComponentMappings] = useState({}); // Маппинг { componentId: [folderIds] } для мультиселекта
    const [autoMappedBlocks, setAutoMappedBlocks] = useState({}); // Автоматически добавленные блоки { componentId: Set<folderId> }
    const [showMappingModal, setShowMappingModal] = useState(false); // Управление модальным окном
    const [isMappingLoading, setIsMappingLoading] = useState(false); // Лоудер для маппинга
    const [selectedComponentType, setSelectedComponentType] = useState('frontend'); // 'frontend' or 'backend' - для табов

    // Состояния для Split Modal (разделение на несколько запусков)
    const [showSplitModal, setShowSplitModal] = useState(false);
    const [launchGroups, setLaunchGroups] = useState([
        { id: 'launch-1', name: 'Регресс тестирование', folderIds: [] }
    ]);
    const [unassignedFolderIds, setUnassignedFolderIds] = useState([]); // Блоки без назначения
    const [splitProgress, setSplitProgress] = useState(null); // { current: 1, total: 3, launchName: 'Запуск 1' }
    const [expandedSplitFolders, setExpandedSplitFolders] = useState({}); // Раскрытые папки в Split Modal
    const [pageMappings, setPageMappings] = useState({}); // Маппинги для Page (из бэкенда)

    // Состояния для модалки подтверждения незамапленных компонент
    const [showUnmappedModal, setShowUnmappedModal] = useState(false);
    const [unmappedComponentsList, setUnmappedComponentsList] = useState([]);
    const [activeUnmappedTab, setActiveUnmappedTab] = useState('frontend'); // 'frontend' or 'backend'

    // Состояния для модалки пустых групп
    const [showEmptyGroupsModal, setShowEmptyGroupsModal] = useState(false);
    const [emptyGroupsData, setEmptyGroupsData] = useState([]);
    const [isCreatingStubs, setIsCreatingStubs] = useState(false);
    const [expandedMappedComponents, setExpandedMappedComponents] = useState({}); // Для раскрытия длинных списков тегов { compId: boolean }
    const [disabledInheritance, setDisabledInheritance] = useState({}); // Для блокировки наследования от страниц { compId: boolean }




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
                    params: { projectId: selectedProjectId },
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
                    setFrontendFileName(file.name);
                    if (isNewTiaFormat(json)) {
                        setTiaReport(json);
                        setFrontendJSON(json);
                        setError('');
                        return;
                    }
                    // Старый формат фронтенда
                    console.log('Frontend JSON loaded:', json);
                    setFrontendJSON(json);
                    setTiaReport(null);
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
                    setBackendFileName(file.name);
                    if (isNewTiaFormat(json)) {
                        // Если загружен новый формат в бэкенд, тоже обрабатываем
                        setTiaReport(json);
                        setBackendJSON(json);
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

        const componentsMap = new Map();

        const processNewFormatReport = (report, defaultType) => {
            const uniqueMap = report.unique_affected_components || {};

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

                let compType = defaultType;
                if (report.type === 'backend' || detail?.type === 'backend') {
                    compType = 'backend';
                } else if (report.type === 'frontend' || detail?.type === 'frontend') {
                    compType = 'frontend';
                }

                componentsMap.set(key, {
                    id: key,
                    name: name,
                    type: compType,
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

            (report.pages || []).forEach((page) => {
                const pageRisk = page.ai_analysis?.risk_level || '';
                const pageSummary = page.ai_analysis?.summary || '';
                const qaAdvice = page.ai_analysis?.qa_advice || [];
                const pageEnv = page.page_meta?.env;
                (page.depends_on_components || []).forEach((compName) => {
                    const detail = uniqueMap[compName];
                    addComponent(compName, pageRisk, pageSummary, qaAdvice, detail, pageEnv);
                });
            });

            // НОВОЕ: Обработка бэкенд компонентов из TIA отчета
            if (report.backend_components && Array.isArray(report.backend_components)) {
                report.backend_components.forEach((backendComp) => {
                    const key = `${backendComp.service_name || 'unknown'}::${backendComp.controller_name || backendComp.name}`;
                    componentsMap.set(key, {
                        id: key,
                        name: backendComp.controller_name || backendComp.name,
                        serviceName: backendComp.service_name || '',
                        type: 'backend',
                        endpoints: backendComp.endpoints || [],
                        riskLevel: backendComp.risk_level || '',
                        summaryText: backendComp.summary || '',
                        qaAdvice: backendComp.qa_advice || [],
                        nestedComponents: [],
                        envs: backendComp.envs || [],
                        jsdoc: backendComp.description || null,
                    });
                });
            }
        };

        if (frontendJSON && isNewTiaFormat(frontendJSON)) {
            processNewFormatReport(frontendJSON, 'frontend');
        } else if (frontendJSON?.frontendComponent) {
            frontendJSON.frontendComponent.forEach((comp, index) => {
                const key = `${comp.name}-${index}`;
                if (!componentsMap.has(key)) {
                    componentsMap.set(key, {
                        id: key,
                        name: comp.name,
                        type: 'frontend',
                        endpoints: [],
                    });
                }
            });
        }

        if (backendJSON && isNewTiaFormat(backendJSON)) {
            processNewFormatReport(backendJSON, 'backend');
        } else if (backendJSON?.Controllers) {
            backendJSON.Controllers.forEach((controller, index) => {
                const key = `${controller.ServiceName || 'unknown'}::${controller.ControllerName}-${index}`;
                if (!componentsMap.has(key)) {
                    componentsMap.set(key, {
                        id: key,
                        name: controller.ControllerName,
                        serviceName: controller.ServiceName,
                        type: 'backend',
                        endpoints: controller.Endpoints || [],
                        riskLevel: '',
                        summaryText: '',
                        qaAdvice: [],
                        nestedComponents: [],
                        envs: [],
                        jsdoc: null,
                    });
                }
            });
        }

        const allComponents = Array.from(componentsMap.values());
        console.log('Extracted components:', allComponents);
        return allComponents;
    };

    // Формирование pageDependencies из tiaReport
    const buildPageDependencies = (components = []) => {
        const dependencies = [];
        const componentTypeMap = new Map();
        components.forEach(comp => {
            componentTypeMap.set(comp.name, comp.type); // 'frontend' или 'backend'
        });

        const processReportPages = (report) => {
            if (!report || !isNewTiaFormat(report)) return;
            (report.pages || []).forEach((page) => {
                const pageName = page.page_meta?.name;
                const pageRoute = page.page_meta?.route;

                if (pageName && page.depends_on_components) {
                    (page.depends_on_components || []).forEach((compName) => {
                        const realComponentType = componentTypeMap.get(compName) || 'frontend';
                        // Определяем тип компонента: если он встречается в списке страниц отчета, то это 'page'
                        const isPage = (report.pages || []).some(p => p.page_meta?.name === compName);
                        const dependencyType = isPage ? 'page' : 'component'; // Тип зависимости

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
        };

        if (frontendJSON) processReportPages(frontendJSON);
        if (backendJSON) processReportPages(backendJSON);

        return dependencies;
    };

    const saveComponentMapping = async (component, folderIds, allComponents, allPageDependencies) => {
        try {
            // Используем переданные данные, чтобы не пересчитывать их каждый раз
            const components = allComponents || extractComponents();
            const pageDependencies = allPageDependencies || buildPageDependencies(components);

            // Извлекаем release_version, change_date и is_bug_fix из соответствующего отчета
            let report = null;
            if (component.type === 'frontend') {
                report = frontendJSON && isNewTiaFormat(frontendJSON) ? frontendJSON : null;
            } else if (component.type === 'backend') {
                report = backendJSON && isNewTiaFormat(backendJSON) ? backendJSON : null;
            }

            if (!report) {
                report = (frontendJSON && isNewTiaFormat(frontendJSON)) ? frontendJSON : ((backendJSON && isNewTiaFormat(backendJSON)) ? backendJSON : null);
            }

            const releaseVersion = report?.release_version || null;
            const changeDate = report?.change_date || null;
            const isBugFix = report?.is_bug_fix || false;
            const issueKey = report?.issue_key || null;
            const mrIid = report?.mr_iid || null;

            // Если нет маппинга на функциональные блоки, все равно сохраняем метаданные компонента
            // Для этого отправляем пустой массив, но с метаданными
            const functionalBlocks = folderIds.length > 0 ? folderIds.map(id => id.toString()) : [];

            // Если наследование заблокировано, не отправляем зависимости страниц (чтобы бэкенд не авто-мапил)
            const isInheritanceBlocked = disabledInheritance[component.id];
            const pageDeps = isInheritanceBlocked ? [] : pageDependencies.filter(dep => dep.componentName === component.name);

            await axios.post(`${config.TIAUrl}/api/components`, {
                projectId,
                componentType: component.type,
                componentName: component.name,
                functionalBlock: functionalBlocks,
                pageDependencies: pageDeps,
                releaseVersion: releaseVersion,
                changeDate: changeDate,
                isBugFix: isBugFix,
                issueKey: issueKey,
                mrIid: mrIid,
            });
        } catch (err) {
            logError('Save component mapping error', err.message);
            throw new Error(`Не удалось сохранить маппинг для компонента ${component.name}.`);
        }
    };

    const handleCreateTestPlan = () => {
        trackEvent('tia_create_test_plan', { page: '/tia', projectId, taskId: jiraLink?.split('/').pop() });
        if (mode === 'light') {
            setError('Переключитесь в режим маппинга для создания запуска.');
            return;
        }
        if (!projectId) {
            setError('Пожалуйста, выберите проект.');
            return;
        }
        if (!frontendJSON && !backendJSON) {
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
                        m => m.component_name === component.name
                    );
                    // Если есть несколько маппингов (например, для разных типов 'page' и 'frontend'),
                    // то берем все уникальные блоки.
                    const folderIds = mappingsForComponent
                        .map(m => findFolderAllureId(m.functional_block_allure_id)?.toString() || '')
                        .filter(id => id);
                    initialMappings[component.id] = folderIds.length > 0 ? folderIds : [];
                    autoMappedBlocks[component.id] = new Set(); // Инициализируем Set для автоматических блоков
                });

                // Затем добавляем автоматические маппинги из связанных Page и по имени самого компонента
                try {
                    const components = extractedComponents;
                    const pageDependencies = buildPageDependencies(components);

                    // Собираем уникальные имена: и из зависимостей, и сами имена компонентов (на случай если компонент — это страница)
                    const allRelatedNames = new Set();
                    pageDependencies.forEach(dep => {
                        if (dep.pageName?.trim()) allRelatedNames.add(dep.pageName.trim());
                    });
                    components.forEach(comp => {
                        if (comp.name?.trim()) allRelatedNames.add(comp.name.trim());
                    });

                    const pageNames = Array.from(allRelatedNames);

                    if (pageNames.length > 0) {
                        console.log(`Запрашиваем маппинги для имен: ${pageNames.length} шт.`);
                        const response = await axios.post(`${config.TIAUrl}/api/components/page-mappings`, {
                            projectId,
                            pageNames
                        });

                        const { pageMappings: fetchedPageMappings } = response.data;
                        console.log('TIA Page Mappings received:', fetchedPageMappings);
                        setPageMappings(fetchedPageMappings || {});
                        const pageMappingsData = fetchedPageMappings || {};

                        // Для каждого компонента находим связанные Page (и само имя) и добавляем их маппинги
                        extractedComponents.forEach(component => {
                            const componentId = component.id;
                            const normalizedCompName = component.name?.trim();

                            // 1. Собираем имена страниц, от которых зависит компонент
                            const relatedPageNames = new Set(
                                pageDependencies
                                    .filter(dep => dep.componentName === component.name)
                                    .map(dep => dep.pageName?.trim())
                                    .filter(name => name)
                            );

                            // 2. Добавляем само имя компонента в список поиска маппингов
                            if (normalizedCompName) {
                                relatedPageNames.add(normalizedCompName);
                            }

                            const autoFolderIds = new Set(initialMappings[componentId] || []);

                            relatedPageNames.forEach(pageName => {
                                const pageMapping = pageMappingsData[pageName] || [];

                                pageMapping.forEach(mapping => {
                                    const allureId = mapping.functional_block_allure_id;
                                    const folderId = findFolderAllureId(allureId)?.toString();

                                    if (folderId && !autoFolderIds.has(folderId)) {
                                        autoFolderIds.add(folderId);
                                        // Инициализируем Set для компонента в autoMappedBlocks, если его еще нет
                                        if (!autoMappedBlocks[componentId]) {
                                            autoMappedBlocks[componentId] = new Set();
                                        }
                                        autoMappedBlocks[componentId].add(folderId);
                                    }
                                });
                            });

                            initialMappings[componentId] = Array.from(autoFolderIds);
                        });
                    }
                } catch (err) {
                    logError('Ошибка при загрузке автоматических маппингов:', err.message);
                    // Продолжаем работу даже если не удалось загрузить автоматические маппинги
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
        trackEvent('tia_partial_save', { page: '/tia', projectId });
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

            // Сохраняем все связи Page -> компоненты одним запросом (если есть новый формат)
            const hasNewFormat = (frontendJSON && isNewTiaFormat(frontendJSON)) || (backendJSON && isNewTiaFormat(backendJSON));
            if (hasNewFormat) {
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
                const folderIdStr = folder.id?.toString().trim();
                const targetAllureIdStr = functionalBlockAllureId?.toString().trim();

                if (folderIdStr === targetAllureIdStr) return folderIdStr;

                if (folder.children && folder.children.length > 0) {
                    const result = findInFolders(folder.children);
                    if (result) return result;
                }
            }
            return null;
        };

        return findInFolders(folders);
    };

    const handleCreateStubs = async () => {
        trackEvent('tia_create_stubs', { page: '/tia', projectId, taskId: jiraLink?.split('/').pop() });
        setIsCreatingStubs(true);
        try {
            // Extract issue key from jiraLink if possible
            const jiraIssueKeyMatch = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
            const issueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : (jiraLink.includes('/') ? jiraLink.split('/').pop() : jiraLink);

            // Для каждой пустой группы создаем стаб-тест
            const promises = emptyGroupsData.map(group =>
                axios.post(`${config.TIAUrl}/api/stub`, {
                    projectId,
                    parentId: group.id,
                    name: group.name || `Group ${group.id}`, // Use exact group name as requested
                    issueKey: issueKey || null
                })
            );

            await Promise.all(promises);
            setShowEmptyGroupsModal(false);
            setEmptyGroupsData([]);

            // Автоматически пробуем создать запуск снова
            if (launchGroups.length > 0 && launchGroups[0].folderIds.length > 0) {
                // Если мы в режиме Split и есть группы для запуска
                createMultipleLaunches();
            } else {
                // Обычный режим
                handleCreateTestPlan();
            }

        } catch (err) {
            logError('Stub creation error', err.message);
            setError('Не удалось создать заглушки: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsCreatingStubs(false);
        }
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
                } else if (errorData.code === 'EMPTY_GROUPS') {
                    // Показываем модалку для пустых групп
                    setEmptyGroupsData(errorData.emptyGroups || []);
                    setShowEmptyGroupsModal(true);
                    // Не показываем ошибку в тосте, так как открываем модалку
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
                setError(`Произошла ошибка при создании запуска: ${err.message}`);
                logError('Test plan creation error', err.message);
            }
        } finally {
            setLoadingState(prev => ({ ...prev, launch: false }));
            setIsLoading(false);
        }
    };



    // Создание нескольких запусков последовательно (Split-режим)
    const createMultipleLaunches = async () => {
        trackEvent('tia_create_launches', { page: '/tia', projectId, extra: { count: launchGroups?.length } });
        setLoadingState(prev => ({ ...prev, launch: true }));
        setError('');
        setSuccessMessage('');
        setAllureLink('');

        const createdLaunches = [];
        const failedLaunches = [];
        const allEmptyGroups = []; // Accumulate empty groups from all launches

        try {
            for (let i = 0; i < launchGroups.length; i++) {
                const group = launchGroups[i];

                // Пропускаем группы без блоков
                if (!group.folderIds || group.folderIds.length === 0) {
                    continue;
                }

                // Обновляем прогресс
                setSplitProgress({
                    current: i + 1,
                    total: launchGroups.length,
                    launchName: group.name
                });

                try {
                    const requestBody = {
                        projectId,
                        jiraLink: group.jiraLink || '', // Use launch-specific Jira link
                        launchName: group.name,
                        groupsInclude: group.folderIds.map(id => parseInt(id, 10)),
                        componentMappings // Даём componentMappings для pageDependencies
                    };

                    const response = await axios.post(`${config.TIAUrl}/api/launch`, requestBody, {
                        headers: { 'Content-Type': 'application/json' },
                    });

                    const { id } = response.data;
                    createdLaunches.push({
                        name: group.name,
                        id,
                        link: `${config.url}/launch/${id}`
                    });

                    // ✅ Success: remove this group from the state to prevent duplicates on retry
                    setLaunchGroups(prev => prev.filter(g => g.id !== group.id));
                } catch (err) {
                    const errorData = err.response?.data;
                    const errorMsg = errorData?.details || errorData?.error || err.message;

                    failedLaunches.push({
                        name: group.name,
                        error: errorMsg
                    });

                    // Check for EMPTY_GROUPS error
                    if (errorData?.code === 'EMPTY_GROUPS') {
                        if (errorData.emptyGroups && Array.isArray(errorData.emptyGroups) && errorData.emptyGroups.length > 0) {
                            allEmptyGroups.push(...errorData.emptyGroups);
                        } else if (group.folderIds) {
                            // Fallback: если бэкенд не вернул список, используем все блоки этого запуска
                            allEmptyGroups.push(...group.folderIds.map(id => {
                                const folder = findFolderById(folders, parseInt(id));
                                return { id, name: folder ? folder.name : `Блок ${id}` };
                            }));
                        }
                    }

                    logError(`Failed to create launch "${group.name}"`, errorMsg);
                }
            }

            // Формируем итоговое сообщение
            if (createdLaunches.length > 0) {
                if (createdLaunches.length === 1) {
                    setSuccessMessage(`Запуск "${createdLaunches[0].name}" успешно создан!`);
                    setAllureLink(createdLaunches[0].link);
                } else {
                    setSuccessMessage(`Успешно создано ${createdLaunches.length} запусков!`);
                    // Для нескольких запусков ссылку покажем на первый
                    setAllureLink(createdLaunches[0].link);
                }
            }

            if (failedLaunches.length > 0) {
                const failedNames = failedLaunches.map(f => f.name).join(', ');
                setError(`Не удалось создать: ${failedNames}`);
            }

            // Закрываем Split Modal при успехе
            if (createdLaunches.length > 0 && failedLaunches.length === 0) {
                setShowSplitModal(false);
            }

            // Show Empty Groups Modal if any were found
            if (allEmptyGroups.length > 0) {
                // Remove duplicates based on ID
                const uniqueEmptyGroups = Array.from(new Map(allEmptyGroups.map(item => [item.id, item])).values());
                setEmptyGroupsData(uniqueEmptyGroups);
                setShowEmptyGroupsModal(true);
            }

        } catch (err) {
            setError(`Ошибка при создании запусков: ${err.message}`);
            logError('Multiple launches creation error', err.message);
        } finally {
            setLoadingState(prev => ({ ...prev, launch: false }));
            setIsLoading(false);
            setSplitProgress(null);
        }
    };

    const onDragEnd = (result) => {
        const { source, destination, draggableId } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        // Parse actual folderId from prefixed draggableId (e.g., 'pool::123' or 'group::launch-1::123')
        const folderId = draggableId.split('::').pop();
        const node = findFolderById(folders, folderId);

        // Identify source pool items to only move what's actually in the source
        const sourceIds = source.droppableId === 'unassigned-pool'
            ? unassignedFolderIds
            : launchGroups.find(g => `launch-${g.id}` === source.droppableId)?.folderIds || [];

        // Recursively find ALL descendants, then filter for those that are actually in the source column
        const potentialIds = node ? getAllDescendantIds(node) : [folderId];
        const idsToMove = potentialIds.filter(id =>
            sourceIds.some(sid => sid.toString() === id.toString())
        );

        if (idsToMove.length === 0) return;

        // Update states - consistently use strings
        let newUnassigned = unassignedFolderIds.map(id => id.toString());
        let newLaunchGroups = launchGroups.map(g => ({
            ...g,
            folderIds: (g.folderIds || []).map(id => id.toString())
        }));

        // 1. Remove from all possible sources
        newUnassigned = newUnassigned.filter(id => !idsToMove.includes(id));
        newLaunchGroups = newLaunchGroups.map(g => ({
            ...g,
            folderIds: g.folderIds.filter(id => !idsToMove.includes(id))
        }));

        // 2. Add to destination
        if (destination.droppableId === 'unassigned-pool') {
            newUnassigned = [...new Set([...newUnassigned, ...idsToMove])];
        } else {
            const destGroupId = destination.droppableId.replace('launch-', '');
            const groupIndex = newLaunchGroups.findIndex(g => g.id.toString() === destGroupId);
            if (groupIndex !== -1) {
                newLaunchGroups[groupIndex].folderIds = [...new Set([...newLaunchGroups[groupIndex].folderIds, ...idsToMove])];
            }
        }

        setUnassignedFolderIds(newUnassigned);
        setLaunchGroups(newLaunchGroups);
    };


    const handleSplitModalCancel = () => {
        setShowSplitModal(false);
        setIsLoading(false);
        setLoadingState(prev => ({ ...prev, launch: false }));
        setSplitProgress(null);
    };

    // Собрать все уникальные folderIds из componentMappings
    const getAllSelectedFolderIds = () => {
        const allFolderIds = new Set();
        // Прямые маппинги компонентов
        Object.values(componentMappings).forEach(folderIds => {
            if (Array.isArray(folderIds)) {
                folderIds.forEach(id => allFolderIds.add(id.toString()));
            }
        });

        // Маппинги страниц (через компоненты)
        components.forEach(comp => {
            // Учитываем блокировку наследования
            if (disabledInheritance[comp.id]) return;

            const pages = getPagesUsingComponent(comp.name);
            pages.forEach(page => {
                const pName = page.page_meta?.name?.trim();
                const pMaps = pageMappings[pName] || [];
                pMaps.forEach(m => {
                    if (m.functional_block_allure_id) {
                        allFolderIds.add(m.functional_block_allure_id.toString());
                    }
                });
            });
        });

        return Array.from(allFolderIds);
    };

    // Открытие Split Modal с предзаполненными данными
    const handleOpenSplitModal = async (force = false) => {
        // Валидация незамапленных компонентов
        if (!force) {
            const unmapped = components.filter(c => {
                // Прямой маппинг
                if (componentMappings[c.id] && componentMappings[c.id].length > 0) return false;

                // Наследование заблокировано - считаем только прямой маппинг
                if (disabledInheritance[c.id]) return true;

                // Маппинг через страницы (если не заблокирован)
                const pages = getPagesUsingComponent(c.name);
                const hasPageMapping = pages.some(page => {
                    const pName = page.page_meta?.name?.trim();
                    return pName && pageMappings[pName]?.length > 0;
                });

                return !hasPageMapping;
            });

            if (unmapped.length > 0) {
                setUnmappedComponentsList(unmapped);
                // По умолчанию открываем первый доступный тип
                const hasFrontend = unmapped.some(c => c.type === 'frontend');
                const hasBackend = unmapped.some(c => c.type === 'backend');
                if (hasFrontend) setActiveUnmappedTab('frontend');
                else if (hasBackend) setActiveUnmappedTab('backend');

                setShowUnmappedModal(true);
                return;
            }
        }

        setIsMappingLoading(true);
        setLoadingState(prev => ({ ...prev, launch: true }));

        try {
            // Предварительно вычисляем данные один раз перед циклом
            const allComponents = extractComponents();
            const allPageDependencies = buildPageDependencies(allComponents);

            // Сохраняем ВСЕ компоненты, включая те, у которых маппинги были удалены (пустой массив)
            const chunkSize = 5;
            for (let i = 0; i < components.length; i += chunkSize) {
                const chunk = components.slice(i, i + chunkSize);
                await Promise.all(chunk.map(component => {
                    const folderIds = componentMappings[component.id] || [];
                    return saveComponentMapping(component, folderIds, allComponents, allPageDependencies);
                }));
            }

            // Собираем все выбранные блоки
            const allFolderIds = getAllSelectedFolderIds();

            if (allFolderIds.length === 0) {
                setError('Не выбрано ни одного функционального блока для запуска.');
                return;
            }

            // Формируем название по умолчанию
            let defaultName = 'Регресс тестирование';
            if (jiraLink) {
                const match = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
                defaultName = `Регресс тестирование ${match ? match[1] : jiraLink.split('/').pop()}`;
            } else {
                defaultName = `Регресс тестирование ${new Date().toLocaleDateString('ru-RU')}`;
            }

            // Все блоки изначально в пуле "без назначения"
            setUnassignedFolderIds(allFolderIds);

            // Инициализируем launchGroups с одним запуском (пустым)
            setLaunchGroups([
                { id: 'launch-1', name: defaultName, folderIds: [], jiraLink: jiraLink || '' }
            ]);

            // Закрываем Mapping Modal, открываем Split Modal
            setShowMappingModal(false);
            setShowSplitModal(true);
        } catch (err) {
            setError(err.message);
            logError('Error preparing split modal', err.message);
        } finally {
            setIsMappingLoading(false);
            setLoadingState(prev => ({ ...prev, launch: false }));
        }
    };

    // Legacy: handleMappingConfirm теперь вызывает handleOpenSplitModal для launch
    const handleMappingConfirm = async (createType = 'launch') => {
        trackEvent('tia_mapping_confirm', { page: '/tia', projectId, taskId: jiraLink?.split('/').pop() });
        // Для launch — открываем Split Modal
        if (createType === 'launch') {
            await handleOpenSplitModal();
            return;
        }

        // Для других типов (если останутся) — старая логика
        setIsMappingLoading(true);
        setLoadingState(prev => ({ ...prev, [createType]: true }));
        try {
            const allComponents = extractComponents();
            const allPageDependencies = buildPageDependencies(allComponents);

            const chunkSize = 5;
            for (let i = 0; i < components.length; i += chunkSize) {
                const chunk = components.slice(i, i + chunkSize);
                await Promise.all(chunk.map(component => {
                    const folderIds = componentMappings[component.id] || [];
                    return saveComponentMapping(component, folderIds, allComponents, allPageDependencies);
                }));
            }

            await createTestPlan();
            setShowMappingModal(false);
        } catch (err) {
            setError(err.message);
            logError('Mapping confirmation error', err.message);
        } finally {
            setIsLoading(false);
            setIsMappingLoading(false);
            setLoadingState(prev => ({ ...prev, [createType]: false }));
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

    const handleRemoveMapping = (componentId, folderId) => {
        // Удаляем из обычных маппингов
        setComponentMappings(prev => ({
            ...prev,
            [componentId]: (prev[componentId] || []).filter(id => id.toString() !== folderId.toString())
        }));

        // Если это был авто-маппинг, фиксируем его удаление (чтобы он не вернулся при ререндере, если логика сложная)
        // Но сейчас логика простая, так что достаточно просто убрать из отображения
        setAutoMappedBlocks(prev => ({
            ...prev,
            [componentId]: (prev[componentId] || []).filter(id => id.toString() !== folderId.toString())
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
    // Фильтрация дерева фич по поисковому запросу
    const filterFolders = (folders, searchTerm) => {
        if (!searchTerm) return folders;
        const lowerSearch = searchTerm.toLowerCase();

        // Используем reduce для построения нового массива с учетом логики "родитель подошел -> берем всех детей"
        return folders.reduce((acc, folder) => {
            const matches = folder.name.toLowerCase().includes(lowerSearch) ||
                (folder.customFieldName && folder.customFieldName.toLowerCase().includes(lowerSearch));

            if (matches) {
                // Если родитель подошел, берем его целиком со всеми детьми (даже если они не подходят)
                acc.push(folder);
            } else {
                // Если родитель не подошел, ищем совпадения внутри детей
                const filteredChildren = folder.children ? filterFolders(folder.children, searchTerm) : [];
                if (filteredChildren.length > 0) {
                    // Если есть, добавляем родителя с отфильтрованными детьми
                    acc.push({
                        ...folder,
                        children: filteredChildren
                    });
                }
            }
            return acc;
        }, []);
    };

    // Найти фичу по ID в дереве
    const findFolderById = (folders, id) => {
        if (!id || !folders) return null;

        const idStr = id.toString().trim();
        for (const folder of folders) {
            if (folder.id?.toString().trim() === idStr) return folder;
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

            // Проверяем, выбран ли ХОТЯ БЫ ОДИН потомок (для частичного выбора)
            const someDescendantsSelected = folder.children && folder.children.length > 0 &&
                getAllDescendantIds(folder).some(id => mappings.includes(id) && id !== folderId); // Exclude self check if checking children

            // Состояния выбора
            const isFullSelected = isDirectlySelected; // Полностью выбран только если сам явно выбран
            // Частично выбран: не все выбраны, но есть выбранные потомки ИЛИ сам выбран но не дети
            const isPartiallySelected = !isFullSelected && (someDescendantsSelected || isDirectlySelected);

            const isSelected = isFullSelected || isDirectlySelected;
            const hasChildren = folder.children && folder.children.length > 0;
            const isExpanded = expandedFolders[folder.id];

            // UI Colors
            const bgColor = isFullSelected
                ? '#d4edda' // Green for full
                : isPartiallySelected
                    ? '#fff3cd' // Yellow for partial
                    : 'transparent';

            const borderColor = isFullSelected
                ? '#28a745'
                : isPartiallySelected
                    ? '#ffc107'
                    : 'transparent';

            return (
                <div key={folder.id} style={{ marginBottom: '4px' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: isDirectlySelected ? '#f5f3ff' : isPartiallySelected ? '#f8fafc' : '#fff',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            marginLeft: `${level * 12}px`,
                            border: `1px solid ${isDirectlySelected ? '#818cf8' : isPartiallySelected ? '#e2e8f0' : '#f1f5f9'}`,
                            boxShadow: isDirectlySelected ? '0 4px 12px rgba(99, 102, 241, 0.1)' : 'none',
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!componentId) return;

                            const folderIdStr = folder.id.toString();
                            const currentMappings = componentMappings[componentId] || [];

                            if (currentMappings.includes(folderIdStr)) {
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: currentMappings.filter(id => id !== folderIdStr)
                                }));
                            } else {
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: [...currentMappings, folderIdStr]
                                }));
                            }
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!componentId) return;

                            const allDescendantIds = getAllDescendantIds(folder);
                            const currentMappings = componentMappings[componentId] || [];
                            const areAllSelected = allDescendantIds.every(id => currentMappings.includes(id));

                            if (areAllSelected) {
                                const newMappings = currentMappings.filter(id => !allDescendantIds.includes(id));
                                setComponentMappings(prev => ({ ...prev, [componentId]: newMappings }));
                            } else {
                                const newMappingsSet = new Set([...currentMappings, ...allDescendantIds]);
                                setComponentMappings(prev => ({ ...prev, [componentId]: Array.from(newMappingsSet) }));
                            }
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = isDirectlySelected ? '#eff6ff' : '#f8fafc';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = isDirectlySelected ? '#f5f3ff' : isPartiallySelected ? '#f8fafc' : '#fff';
                        }}
                    >
                        {/* Кастомный чекбокс */}
                        <div style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '6px',
                            border: `2px solid ${isDirectlySelected ? '#6366f1' : '#cbd5e1'}`,
                            backgroundColor: isDirectlySelected ? '#6366f1' : isPartiallySelected ? '#eef2ff' : '#fff',
                            marginRight: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s ease',
                            flexShrink: 0
                        }}>
                            {isDirectlySelected && (
                                <span style={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}>✓</span>
                            )}
                            {!isDirectlySelected && isPartiallySelected && (
                                <div style={{ width: '8px', height: '2px', backgroundColor: '#6366f1', borderRadius: '1px' }} />
                            )}
                        </div>

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
                                    fontSize: '12px',
                                    color: '#94a3b8',
                                    width: '28px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s ease',
                                    transform: expandedFolders[folder.id] ? 'rotate(90deg)' : 'rotate(0deg)',
                                    marginRight: '6px',
                                    cursor: 'pointer',
                                    borderRadius: '6px'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                ▶
                            </span>
                        )}
                        {!hasChildren && <span style={{ width: '34px' }} />}
                        <span style={{
                            fontSize: '14px',
                            fontWeight: hasChildren ? 600 : 400,
                            color: '#334155',
                            flex: 1,
                            userSelect: 'none',
                            lineHeight: '1.2'
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
                    {
                        hasChildren && isExpanded && (
                            <div style={{ marginTop: '4px' }}>
                                {renderFolderTreeForMapping(folder.children, componentId, level + 1)}
                            </div>
                        )
                    }
                </div >
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
                    marginLeft: `${level * 12}px`,
                    marginBottom: '8px',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    backgroundColor: level === 0 ? '#f8fafc' : '#fff',
                    border: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: level === 0 ? '0 2px 4px rgba(0,0,0,0.02)' : 'none'
                }}
                onClick={(e) => handleFolderToggle(folder.id, e)}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f1f5f9';
                    e.currentTarget.style.borderColor = '#e2e8f0';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = level === 0 ? '#f8fafc' : '#fff';
                    e.currentTarget.style.borderColor = '#f1f5f9';
                }}
            >
                {folder.children && folder.children.length > 0 && (
                    <span style={{
                        fontSize: '10px',
                        color: '#94a3b8',
                        width: '16px',
                        display: 'flex',
                        justifyContent: 'center',
                        transition: 'transform 0.2s ease',
                        transform: expandedFolders[folder.id] ? 'rotate(90deg)' : 'rotate(0deg)'
                    }}>
                        ▶
                    </span>
                )}
                {(!folder.children || folder.children.length === 0) && <span style={{ width: '16px' }} />}
                <span style={{
                    fontSize: '14px',
                    fontWeight: level === 0 ? 700 : 500,
                    color: '#0f172a',
                    flex: 1
                }}>
                    {formatCustomFieldName(folder, level)}
                </span>
                {expandedFolders[folder.id] && folder.children && folder.children.length > 0 && (
                    <div style={{
                        width: '100%',
                        flexBasis: '100%',
                        marginTop: '8px',
                        borderLeft: '1px dashed #e2e8f0',
                        marginLeft: '8px',
                        paddingLeft: '12px'
                    }}>
                        {renderFolderTree(folder.children, level + 1)}
                    </div>
                )}
            </div>
        ));
    };

    // Фильтрация папок для проектов Nocode (показываем только Block и SubBlock на корневом уровне, но под ними показываем все)
    const nocodeProjectIds = ['307', '377'];
    const filterFoldersForProject = (folders) => {
        if (!nocodeProjectIds.includes(String(projectId))) {
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

    const formatCustomFieldName = (folder, level = 0) => {
        if (folder.node_type === 'TEST_CASE') {
            const layerPrefix = folder.layer ? `[${folder.layer}] ` : '';
            return `${layerPrefix}${folder.name}`;
        }
        const type = folder.customFieldName || 'Блок';
        return `[${type}] ${folder.name}`;
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

    const getCreateButtonDisabledReason = () => {
        if (mode !== 'mapping') return 'Переключитесь в режим маппинга';
        if (!projectId) return 'Выберите проект из списка';
        if (structureLoading) return 'Дождитесь загрузки структуры проекта';
        if (!(frontendJSON || backendJSON || (tiaReport && isNewTiaFormat(tiaReport)))) {
            return 'Загрузите JSON-выгрузку фронтенда или бэкенда';
        }
        if (isLoading) return 'Запрос выполняется...';
        return '';
    };

    const isCreateButtonDisabled = () => !!getCreateButtonDisabledReason();

    const isMappingConfirmDisabled = false;

    const isJiraValid = !jiraLink || jiraLink.match(/^https?:\/\/jira\.abanking\.ru\/browse\/[A-Z]+-\d+$/);

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


    const renderLightSummary = () => {
        if (!tiaReport || !isNewTiaFormat(tiaReport) || mode !== 'light') return null;
        const { summary, pages, unique_affected_components } = tiaReport;
        const uniqueMap = unique_affected_components || {};
        const globalRisks = summary?.global_risks || [];

        return (
            <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '4px', height: '24px', backgroundColor: '#6366f1', borderRadius: '2px' }} />
                    <h2 style={{ ...styles.title }}>Сводка изменений</h2>
                </div>

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
                                    Страницы с высоким риском (HIGH) - требуют особого внимания
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
                                                            {isPageExpanded ? 'Скрыть' : 'Подробнее'}
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
                                                    {isPageExpanded ? 'Скрыть' : 'Подробнее'}
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
                                                {isExpanded ? 'Скрыть детали' : 'Показать детали'}
                                            </button>
                                        </div>

                                        {isExpanded && (
                                            <div style={{ marginTop: 20, paddingTop: 10, borderTop: `2px solid ${styles.borderLight}` }}>
                                                {detail.changed_methods?.length > 0 && (
                                                    <div style={{ marginBottom: 20 }}>
                                                        {/* Заголовок с кнопкой */}
                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setExpandedMethods(prev => ({ ...prev, [compKey]: !prev[compKey] }));
                                                            }}
                                                            style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                marginBottom: 16,
                                                                cursor: 'pointer',
                                                                userSelect: 'none',
                                                                gap: '12px'
                                                            }}
                                                        >
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setExpandedMethods(prev => ({ ...prev, [compKey]: !prev[compKey] }));
                                                                }}
                                                                style={{
                                                                    padding: '0 14px',
                                                                    backgroundColor: expandedMethods[compKey] ? '#475569' : '#f1f5f9',
                                                                    color: expandedMethods[compKey] ? '#fff' : '#475569',
                                                                    border: `1px solid ${expandedMethods[compKey] ? '#475569' : '#e2e8f0'}`,
                                                                    borderRadius: '8px',
                                                                    fontSize: '13px',
                                                                    fontWeight: 700,
                                                                    lineHeight: 1,
                                                                    cursor: 'pointer',
                                                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    height: '32px',
                                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    if (!expandedMethods[compKey]) e.currentTarget.style.backgroundColor = '#e2e8f0';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    if (!expandedMethods[compKey]) e.currentTarget.style.backgroundColor = '#f1f5f9';
                                                                }}
                                                            >
                                                                {expandedMethods[compKey] ? 'Свернуть' : 'Раскрыть'}
                                                            </button>

                                                            <span style={{
                                                                fontWeight: 700,
                                                                color: '#334155',
                                                                fontSize: '15px',
                                                                display: 'flex',
                                                                alignItems: 'center'
                                                            }}>
                                                                Изменённые методы ({detail.changed_methods.length})
                                                            </span>
                                                        </div>

                                                        {/* Раскрывающийся список */}
                                                        {expandedMethods[compKey] && (
                                                            <div style={{
                                                                display: 'flex',
                                                                flexWrap: 'wrap',
                                                                gap: '8px',
                                                                padding: '12px',
                                                                backgroundColor: '#f8fafc',
                                                                borderRadius: '12px',
                                                                border: '1px solid #e2e8f0'
                                                            }}>
                                                                {detail.changed_methods.map((m, mi) => (
                                                                    <div key={`${compKey}-method-${mi}`}>
                                                                        <code style={{
                                                                            backgroundColor: '#1e293b',
                                                                            padding: '6px 12px',
                                                                            borderRadius: '6px',
                                                                            fontSize: '12px',
                                                                            fontWeight: 500,
                                                                            color: '#fff',
                                                                            display: 'inline-block',
                                                                            fontFamily: 'monospace',
                                                                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                                                        }}>
                                                                            {m}
                                                                        </code>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
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
                <h1 style={styles.title}>Test Impact Analysis</h1>
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
                <div style={{ ...styles.formGroup, gap: '16px' }}>
                    <label style={styles.label}>Режим работы</label>
                    <div style={{
                        display: 'flex',
                        backgroundColor: 'var(--bg-input)',
                        padding: '6px',
                        borderRadius: '16px',
                        width: 'fit-content',
                        gap: '4px',
                        boxShadow: 'var(--shadow-sm)'
                    }}>
                        <button
                            onClick={() => setMode('mapping')}
                            style={{
                                padding: '10px 24px',
                                borderRadius: '12px',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 700,
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                backgroundColor: mode === 'mapping' ? 'var(--bg-content)' : 'transparent',
                                color: mode === 'mapping' ? 'var(--primary-accent)' : 'var(--text-muted)',
                                boxShadow: mode === 'mapping' ? 'var(--shadow-sm)' : 'none',
                            }}
                        >
                            Маппинг
                        </button>
                        <button
                            onClick={() => setMode('light')}
                            style={{
                                padding: '10px 24px',
                                borderRadius: '12px',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: 700,
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                backgroundColor: mode === 'light' ? 'var(--bg-content)' : 'transparent',
                                color: mode === 'light' ? 'var(--primary-accent)' : 'var(--text-muted)',
                                boxShadow: mode === 'light' ? 'var(--shadow-sm)' : 'none',
                            }}
                        >
                            Лайт-режим
                        </button>
                    </div>
                </div>
                <div style={styles.formGroup}>
                    <label style={styles.label}>Выберите проект</label>
                    <div style={{ position: 'relative' }}>
                        <select
                            value={projectId}
                            onChange={handleProjectChange}
                            style={styles.select}
                            disabled={isLoading || structureLoading}
                        >
                            <option value="">Выберите проект</option>
                            {projects.map((proj) => (
                                <option key={proj.id} value={proj.id}>
                                    {proj.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON фронтенда (опционально):</label>
                    <div style={{
                        ...styles.uploadContainer,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        <div style={{ width: '130px', overflow: 'hidden', flexShrink: 0 }}>
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleFrontendJSONUpload}
                                style={{ ...styles.fileInput, width: '200%', color: 'transparent' }}
                                disabled={isLoading}
                            />
                        </div>

                        {frontendJSON && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
                                <span style={{
                                    ...styles.fileName,
                                    margin: 0,
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    alignItems: 'center',
                                    height: '32px',
                                    paddingTop: '0',
                                    paddingBottom: '0'
                                }}>
                                    {frontendFileName || 'frontend.json'}
                                </span>
                                <button
                                    onClick={() => {
                                        setFrontendJSON(null);
                                        setFrontendFileName('');
                                        if (!backendJSON) {
                                            setTiaReport(null);
                                        }
                                    }}
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        backgroundColor: '#fee2e2',
                                        color: '#dc2626',
                                        fontSize: '10px',
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        marginTop: '-1px'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#fecaca';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '#fee2e2';
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div style={styles.formGroup}>
                    <label style={styles.label}>Загрузить JSON бэкенда (опционально):</label>
                    <div style={{
                        ...styles.uploadContainer,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}>
                        <div style={{ width: '130px', overflow: 'hidden', flexShrink: 0 }}>
                            <input
                                type="file"
                                accept=".json"
                                onChange={handleBackendJSONUpload}
                                style={{ ...styles.fileInput, width: '200%', color: 'transparent' }}
                                disabled={isLoading}
                            />
                        </div>

                        {backendJSON && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto' }}>
                                <span style={{
                                    ...styles.fileName,
                                    margin: 0,
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    alignItems: 'center',
                                    height: '32px',
                                    paddingTop: '0',
                                    paddingBottom: '0'
                                }}>
                                    {backendFileName || 'backend.json'}
                                </span>
                                <button
                                    onClick={() => {
                                        setBackendJSON(null);
                                        setBackendFileName('');
                                        if (!frontendJSON) {
                                            setTiaReport(null);
                                        }
                                    }}
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        backgroundColor: '#fee2e2',
                                        color: '#dc2626',
                                        fontSize: '10px',
                                        fontWeight: 800,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        marginTop: '-1px'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#fecaca';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '#fee2e2';
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {renderLightSummary()}

            <div style={styles.footer}>
                {error && <div style={styles.error}>{error}</div>}
                {successMessage && (
                    <div style={styles.success}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                            <span>✅</span>
                            {successMessage}
                        </div>
                        {allureLink && (
                            <a href={allureLink} target="_blank" rel="noopener noreferrer" style={{ ...styles.successLink, color: '#fff', backgroundColor: '#10b981', padding: '6px 12px', borderRadius: '8px', marginTop: '10px', display: 'inline-block', fontWeight: 600 }}>
                                Перейти к запуску в Allure
                            </a>
                        )}
                    </div>
                )}
                {(isLoading || structureLoading) && (
                    <div style={{
                        ...styles.loader,
                        flexDirection: 'column',
                        gap: '12px'
                    }}>
                        <Loader />
                        <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>
                            {structureLoading ? 'Загрузка структуры проекта...' : 'Анализ изменений...'}
                        </div>
                    </div>
                )}
                {mode === 'mapping' && (
                    <button
                        onClick={handleCreateTestPlan}
                        disabled={isCreateButtonDisabled()}
                        title={getCreateButtonDisabledReason()}
                        style={{
                            ...styles.submitButton,
                            boxShadow: 'none',
                            opacity: isCreateButtonDisabled() ? 0.6 : 1,
                            transform: isCreateButtonDisabled() ? 'none' : 'scale(1)',
                            cursor: isCreateButtonDisabled() ? 'not-allowed' : 'pointer',
                            transition: 'all 0.3s ease',
                            background: isCreateButtonDisabled()
                                ? 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)'
                                : styles.submitButton.background
                        }}
                    >
                        {isLoading ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <Loader style={{ width: '20px', height: '20px' }} />
                                <span>Обработка...</span>
                            </div>
                        ) : 'Создать запуски тестирования'}
                    </button>
                )}
            </div>
            {showMappingModal && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.75)',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 10000,
                    }}
                >
                    <div
                        style={{
                            backgroundColor: '#ffffff',
                            padding: '0',
                            borderRadius: '24px',
                            width: '95vw',
                            maxWidth: '1750px',
                            height: '90vh',
                            maxHeight: 'calc(100vh - 40px)',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: '0 25px 70px -10px rgba(0, 0, 0, 0.4)',
                            border: '1px solid #334155',
                            overflow: 'hidden',
                            position: 'relative',
                        }}
                    >
                        {/* Заголовок */}
                        <div style={{
                            padding: '18px 28px',
                            borderBottom: '1px solid #e2e8f0',
                            backgroundColor: '#f1f5f9',
                            flexShrink: 0,
                            zIndex: 10
                        }}>
                            <h2 style={{
                                ...styles.title
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

                        <div style={{
                            display: 'flex',
                            flex: '1 1 0%',
                            minHeight: 0,
                            overflow: 'hidden'
                        }}>
                            {/* Левая колонка: Что затронуто */}
                            <div style={{
                                width: '50%',
                                borderRight: '1px solid #e2e8f0',
                                padding: '16px',
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
                                                <strong style={{ color: '#111' }}>Фронтенд компонентов:</strong> {components.length}
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

                                {/* Табы для переключения между фронтендом и бэкендом - ВСЕГДА ВИДНЫ */}
                                <div style={{
                                    display: 'flex',
                                    gap: '8px',
                                    marginBottom: '16px',
                                    borderBottom: '2px solid #e2e8f0',
                                    paddingBottom: '0'
                                }}>
                                    <button
                                        onClick={() => setSelectedComponentType('frontend')}
                                        style={{
                                            padding: '10px 20px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            color: selectedComponentType === 'frontend' ? '#3b82f6' : '#64748b',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            borderBottom: selectedComponentType === 'frontend' ? '3px solid #3b82f6' : '3px solid transparent',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            marginBottom: '-2px'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (selectedComponentType !== 'frontend') {
                                                e.currentTarget.style.color = '#3b82f6';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (selectedComponentType !== 'frontend') {
                                                e.currentTarget.style.color = '#64748b';
                                            }
                                        }}
                                    >
                                        Фронтенд ({components.filter(c => c.type === 'frontend').length})
                                    </button>
                                    <button
                                        onClick={() => setSelectedComponentType('backend')}
                                        style={{
                                            padding: '10px 20px',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            color: selectedComponentType === 'backend' ? '#3b82f6' : '#64748b',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            borderBottom: selectedComponentType === 'backend' ? '3px solid #3b82f6' : '3px solid transparent',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            marginBottom: '-2px'
                                        }}
                                        onMouseEnter={(e) => {
                                            if (selectedComponentType !== 'backend') {
                                                e.currentTarget.style.color = '#3b82f6';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (selectedComponentType !== 'backend') {
                                                e.currentTarget.style.color = '#64748b';
                                            }
                                        }}
                                    >
                                        Бэкенд ({components.filter(c => c.type === 'backend').length})
                                    </button>
                                </div>

                                {/* Фильтрация компонентов по выбранному типу */}
                                {(() => {
                                    const filteredComponents = components.filter(comp => comp.type === selectedComponentType);

                                    if (filteredComponents.length === 0) {
                                        return (
                                            <div style={{
                                                padding: '16px',
                                                backgroundColor: '#f8fafc',
                                                borderRadius: '8px',
                                                color: '#64748b',
                                                textAlign: 'center'
                                            }}>
                                                {selectedComponentType === 'frontend'
                                                    ? 'Фронтенд компоненты не найдены'
                                                    : 'Бэкенд компоненты не найдены'}
                                            </div>
                                        );
                                    }

                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {filteredComponents.map(comp => {
                                                const pages = getPagesUsingComponent(comp.name);
                                                const changeSummary = getComponentChangeSummary(comp);
                                                const riskColor = comp.riskLevel === 'HIGH' ? '#dc3545' :
                                                    comp.riskLevel === 'MEDIUM' ? '#ffc107' : '#28a745';
                                                const isSelected = selectedComponentId === comp.id;
                                                const hasDirectMapping = componentMappings[comp.id]?.length > 0;
                                                const hasPageMappingForComp = pages.some(page => {
                                                    const pName = page.page_meta?.name?.trim();
                                                    return pName && pageMappings[pName]?.length > 0;
                                                });
                                                const hasMapping = hasDirectMapping || hasPageMappingForComp;

                                                // Подготовка опций для Select внутри каждой карточки
                                                const getFlatFolders = (nodes, result = []) => {
                                                    nodes.forEach(node => {
                                                        result.push({ value: node.id.toString(), label: node.name });
                                                        if (node.children) getFlatFolders(node.children, result);
                                                    });
                                                    return result;
                                                };
                                                const folderOptions = getFlatFolders(folders);
                                                const currentMappingOptions = (componentMappings[comp.id] || []).map(id => {
                                                    const folder = findFolderById(folders, id);
                                                    return { value: id.toString(), label: folder ? folder.name : `ID: ${id}` };
                                                });

                                                return (
                                                    <div
                                                        key={comp.id}
                                                        onClick={() => setSelectedComponentId(comp.id)}
                                                        style={{
                                                            padding: '12px 14px',
                                                            backgroundColor: isSelected ? '#eff6ff' : hasMapping ? '#f8fafc' : '#fff8f8',
                                                            borderRadius: '12px',
                                                            border: `1px solid ${isSelected ? '#3b82f6' : hasMapping ? '#e2e8f0' : '#fca5a5'}`,
                                                            cursor: 'pointer',
                                                            transition: 'all 0.2s',
                                                            boxShadow: isSelected ? '0 4px 12px rgba(59, 130, 246, 0.15)' : 'none'
                                                        }}
                                                    >
                                                        {/* Заголовок компонента */}
                                                        <div style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            marginBottom: '12px'
                                                        }}>
                                                            <div
                                                                title={comp.name}
                                                                style={{
                                                                    fontSize: '18px',
                                                                    fontWeight: 700,
                                                                    color: hasMapping ? '#28a745' : '#dc3545',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis',
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
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
                                                                        {comp.jsdoc}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* НОВОЕ: Бэкенд-специфичная информация */}
                                                            {comp.type === 'backend' && (
                                                                <>
                                                                    {comp.serviceName && (
                                                                        <div
                                                                            title={comp.serviceName}
                                                                            style={{
                                                                                padding: '8px 12px',
                                                                                backgroundColor: '#f1f5f9',
                                                                                borderRadius: '6px',
                                                                                fontSize: '12px',
                                                                                color: '#475569',
                                                                                fontWeight: 500,
                                                                                marginBottom: '8px',
                                                                                overflow: 'hidden',
                                                                                textOverflow: 'ellipsis',
                                                                                whiteSpace: 'nowrap'
                                                                            }}
                                                                        >
                                                                            <strong>Сервис:</strong> {comp.serviceName}
                                                                        </div>
                                                                    )}
                                                                    {comp.endpoints && comp.endpoints.length > 0 && (
                                                                        <div style={{
                                                                            padding: '10px',
                                                                            backgroundColor: '#fef3c7',
                                                                            borderRadius: '8px',
                                                                            border: '1px solid #fbbf24'
                                                                        }}>
                                                                            <div style={{
                                                                                fontSize: '11px',
                                                                                fontWeight: 600,
                                                                                color: '#92400e',
                                                                                marginBottom: '8px'
                                                                            }}>
                                                                                Endpoints ({comp.endpoints.length}):
                                                                            </div>
                                                                            {comp.endpoints.map((endpoint, eidx) => (
                                                                                <div key={`endpoint-${comp.id}-${eidx}`} style={{
                                                                                    padding: '6px 8px',
                                                                                    backgroundColor: '#fff',
                                                                                    borderRadius: '4px',
                                                                                    marginBottom: eidx < comp.endpoints.length - 1 ? '4px' : '0',
                                                                                    fontSize: '11px',
                                                                                    fontFamily: 'monospace',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '8px'
                                                                                }}>
                                                                                    <span style={{
                                                                                        fontWeight: 700,
                                                                                        padding: '2px 6px',
                                                                                        borderRadius: '3px',
                                                                                        fontSize: '10px',
                                                                                        color: '#fff',
                                                                                        backgroundColor:
                                                                                            (endpoint.HttpMethod || endpoint.method) === 'GET' ? '#10b981' :
                                                                                                (endpoint.HttpMethod || endpoint.method) === 'POST' ? '#3b82f6' :
                                                                                                    (endpoint.HttpMethod || endpoint.method) === 'PUT' ? '#f59e0b' :
                                                                                                        (endpoint.HttpMethod || endpoint.method) === 'DELETE' ? '#ef4444' :
                                                                                                            (endpoint.HttpMethod || endpoint.method) === 'PATCH' ? '#8b5cf6' : '#6b7280'
                                                                                    }}>
                                                                                        {endpoint.HttpMethod || endpoint.method || 'N/A'}
                                                                                    </span>
                                                                                    <span style={{ color: '#1e293b', flex: 1 }}>
                                                                                        {endpoint.RoutePath || endpoint.path || endpoint.url || 'N/A'}
                                                                                    </span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </>
                                                            )}

                                                            {/* Фронтенд-специфичная информация (serviceName как file path) */}
                                                            {comp.type === 'frontend' && comp.serviceName && (
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
                                                                    {comp.serviceName}
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
                                                                        padding: '10px 16px',
                                                                        backgroundColor: expandedScenarios[comp.id] ? '#10b981' : '#f0fdf4',
                                                                        color: expandedScenarios[comp.id] ? '#fff' : '#059669',
                                                                        border: `1px solid ${expandedScenarios[comp.id] ? '#10b981' : '#bcf0da'}`,
                                                                        borderRadius: '12px',
                                                                        cursor: 'pointer',
                                                                        fontSize: '13px',
                                                                        fontWeight: 700,
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'space-between',
                                                                        width: '100%',
                                                                        transition: 'all 0.2s ease',
                                                                        boxShadow: expandedScenarios[comp.id] ? '0 4px 12px rgba(16, 185, 129, 0.2)' : 'none'
                                                                    }}
                                                                >
                                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <span style={{
                                                                            transition: 'transform 0.2s ease',
                                                                            transform: expandedScenarios[comp.id] ? 'rotate(180deg)' : 'rotate(0deg)',
                                                                            display: 'inline-block'
                                                                        }}>▼</span>
                                                                        Сценарии тестирования
                                                                        <span style={{
                                                                            fontSize: '11px',
                                                                            backgroundColor: expandedScenarios[comp.id] ? 'rgba(255, 255, 255, 0.3)' : 'rgba(16, 185, 129, 0.1)',
                                                                            padding: '2px 8px',
                                                                            borderRadius: '20px',
                                                                            marginLeft: '4px'
                                                                        }}>
                                                                            {comp.qaAdvice.reduce((sum, advice) => sum + (advice.scenarios?.length || 0), 0)}
                                                                        </span>
                                                                    </span>
                                                                </button>
                                                                {expandedScenarios[comp.id] && (
                                                                    <div style={{
                                                                        marginTop: '12px',
                                                                        padding: '16px',
                                                                        backgroundColor: '#f8fafc',
                                                                        borderRadius: '16px',
                                                                        border: '1px solid #e2e8f0'
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
                                                                                            margin: '8px 0 0 0',
                                                                                            paddingLeft: '0',
                                                                                            listStyle: 'none',
                                                                                            display: 'flex',
                                                                                            flexDirection: 'column',
                                                                                            gap: '8px'
                                                                                        }}>
                                                                                            {advice.scenarios.map((scenario, sidx) => (
                                                                                                <li key={`${comp.id}-scenario-${aidx}-${sidx}`} style={{
                                                                                                    fontSize: '13px',
                                                                                                    color: '#334155',
                                                                                                    lineHeight: 1.5,
                                                                                                    padding: '10px 14px',
                                                                                                    backgroundColor: '#ffffff',
                                                                                                    borderRadius: '10px',
                                                                                                    border: '1px solid #e2e8f0',
                                                                                                    display: 'flex',
                                                                                                    gap: '12px',
                                                                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                                                                                                }}>
                                                                                                    <span style={{ fontWeight: 800, color: '#94a3b8', minWidth: '18px' }}>{sidx + 1}.</span>
                                                                                                    <span>{scenario}</span>
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

                                                        {/* Где используется — Show More toggle if > 10 Pages */}
                                                        {(() => {
                                                            const pages = getPagesUsingComponent(comp.name);
                                                            const hasDirect = componentMappings[comp.id]?.length > 0;
                                                            const isInheritanceBlocked = disabledInheritance[comp.id];
                                                            const hasPageMapping = !isInheritanceBlocked && pages.some(page => {
                                                                const pName = page.page_meta?.name?.trim();
                                                                return pName && pageMappings[pName]?.length > 0;
                                                            });

                                                            const hasMapping = hasDirect || hasPageMapping;

                                                            return (
                                                                <>
                                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                            <div>
                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                    <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                                                                                        {comp.name}
                                                                                    </h4>
                                                                                    <span style={{
                                                                                        padding: '4px 8px',
                                                                                        backgroundColor: '#f1f5f9',
                                                                                        borderRadius: '6px',
                                                                                        fontSize: '11px',
                                                                                        color: '#64748b',
                                                                                        fontWeight: 600,
                                                                                        textTransform: 'uppercase',
                                                                                        letterSpacing: '0.5px'
                                                                                    }}>
                                                                                        {comp.type}
                                                                                    </span>
                                                                                    {isInheritanceBlocked && (
                                                                                        <span style={{
                                                                                            padding: '4px 8px',
                                                                                            backgroundColor: '#fff1f2',
                                                                                            borderRadius: '6px',
                                                                                            fontSize: '11px',
                                                                                            color: '#e11d48',
                                                                                            fontWeight: 600
                                                                                        }}>
                                                                                            Блокировка наследования
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        {/* Кнопки действий: Очистить маппинг */}
                                                                        {hasMapping && (
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (window.confirm(`Вы уверены, что хотите полностью очистить маппинг для компонента "${comp.name}"?\n\nЭто удалит все прямые привязки и заблокирует наследование тестов от страниц для этого компонента. Данные самих страниц при этом затронуты не будут.`)) {
                                                                                        setComponentMappings(prev => ({ ...prev, [comp.id]: [] }));
                                                                                        setDisabledInheritance(prev => ({ ...prev, [comp.id]: true }));
                                                                                        setPartialSaveMessage('');
                                                                                    }
                                                                                }}
                                                                                style={{
                                                                                    padding: '10px 16px',
                                                                                    backgroundColor: '#fff1f2',
                                                                                    color: '#e11d48',
                                                                                    border: '1px solid #fecdd3',
                                                                                    borderRadius: '10px',
                                                                                    fontSize: '13px',
                                                                                    fontWeight: 600,
                                                                                    cursor: 'pointer',
                                                                                    transition: 'all 0.2s ease',
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '8px',
                                                                                    boxShadow: '0 1px 2px rgba(225, 29, 72, 0.05)'
                                                                                }}
                                                                                onMouseEnter={(e) => {
                                                                                    e.currentTarget.style.backgroundColor = '#ffe4e6';
                                                                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                                                                }}
                                                                                onMouseLeave={(e) => {
                                                                                    e.currentTarget.style.backgroundColor = '#fff1f2';
                                                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                                                }}
                                                                            >
                                                                                Очистить маппинг
                                                                            </button>
                                                                        )}
                                                                    </div>

                                                                    {/* Список Страниц */}
                                                                    <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '12px', marginBottom: '16px', border: '1px solid #f1f5f9' }}>
                                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                                                            <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#64748b' }}>
                                                                                Используется на страницах:
                                                                            </h5>
                                                                            {pages.length > 10 && (
                                                                                <button
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setExpandedPageLists(prev => ({ ...prev, [comp.id]: !prev[comp.id] }));
                                                                                    }}
                                                                                    style={{
                                                                                        background: 'none',
                                                                                        border: 'none',
                                                                                        color: '#6366f1',
                                                                                        fontSize: '11px',
                                                                                        cursor: 'pointer',
                                                                                        padding: 0,
                                                                                        fontWeight: 600
                                                                                    }}
                                                                                >
                                                                                    {expandedPageLists[comp.id] ? 'Скрыть' : `Показать все (${pages.length})`}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        <div style={{
                                                                            display: 'flex',
                                                                            flexWrap: 'wrap',
                                                                            gap: '6px'
                                                                        }}>
                                                                            {(expandedPageLists[comp.id] ? pages : pages.slice(0, 10)).map((page, idx) => {
                                                                                const pageName = page.page_meta?.name || 'Unknown';
                                                                                const pageRoute = page.page_meta?.route;
                                                                                const tooltipText = [
                                                                                    page.page_meta?.human_title,
                                                                                    pageRoute ? `Route: ${pageRoute}` : null,
                                                                                    page.page_meta?.file_path
                                                                                ].filter(Boolean).join('\n');

                                                                                const hasPageMapping = pageMappings[pageName?.trim()]?.length > 0;
                                                                                return (
                                                                                    <div key={`${comp.id}-page-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                                                        <span
                                                                                            title={tooltipText}
                                                                                            style={{
                                                                                                padding: '4px 10px',
                                                                                                backgroundColor: hasPageMapping ? '#d1fae5' : '#e9ecef',
                                                                                                borderRadius: '4px',
                                                                                                fontSize: '12px',
                                                                                                color: hasPageMapping ? '#065f46' : '#111',
                                                                                                border: hasPageMapping ? '1px solid #6ee7b7' : '1px solid transparent',
                                                                                                fontWeight: 500,
                                                                                                cursor: 'help',
                                                                                                display: 'inline-flex',
                                                                                                alignItems: 'center',
                                                                                                gap: '6px'
                                                                                            }}
                                                                                        >
                                                                                            <span>{pageName}</span>
                                                                                            {pageRoute && (
                                                                                                <span style={{ fontSize: '11px', color: '#6c757d', fontFamily: 'monospace', backgroundColor: '#dee2e6', padding: '2px 6px', borderRadius: '3px' }}>
                                                                                                    {pageRoute}
                                                                                                </span>
                                                                                            )}
                                                                                        </span>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                            {!expandedPageLists[comp.id] && pages.length > 10 && (
                                                                                <div style={{ padding: '4px 10px', backgroundColor: '#f8f9fa', borderRadius: '4px', fontSize: '12px', color: '#6c757d', border: '1px dashed #dee2e6' }}>
                                                                                    + еще {pages.length - 10}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Отображение привязанных блоков (Покрыто) */}
                                                                    {hasMapping && (
                                                                        <div style={{ marginTop: '12px' }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                                                                <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                                                                                    Покрыто:
                                                                                </div>
                                                                                {isInheritanceBlocked && (
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            setDisabledInheritance(prev => ({ ...prev, [comp.id]: false }));
                                                                                        }}
                                                                                        style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                                                                                    >
                                                                                        Вернуть наследование
                                                                                    </button>
                                                                                )}
                                                                            </div>
                                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                                                {(() => {
                                                                                    const directIds = componentMappings[comp.id] || [];

                                                                                    const blockNamesMap = {};

                                                                                    const selfMappings = pageMappings[comp.name?.trim()] || [];
                                                                                    selfMappings.forEach(m => {
                                                                                        const id = m.functional_block_allure_id?.toString();
                                                                                        if (id && m.functional_block_name) blockNamesMap[id] = m.functional_block_name;
                                                                                    });

                                                                                    const pageLevelIds = isInheritanceBlocked ? [] : pages.flatMap(page => {
                                                                                        const pName = page.page_meta?.name?.trim();
                                                                                        const mappings = pageMappings[pName] || [];
                                                                                        return mappings.map(m => {
                                                                                            const id = m.functional_block_allure_id?.toString();
                                                                                            if (id && m.functional_block_name) blockNamesMap[id] = m.functional_block_name;
                                                                                            return id;
                                                                                        });
                                                                                    }).filter(Boolean);

                                                                                    const allIds = Array.from(new Set([...directIds, ...pageLevelIds]));
                                                                                    const isTagsExpanded = expandedMappedComponents[comp.id];
                                                                                    const LIMIT = 10;
                                                                                    const displayedIds = isTagsExpanded ? allIds : allIds.slice(0, LIMIT);

                                                                                    return (
                                                                                        <>
                                                                                            {displayedIds.map(folderId => {
                                                                                                const folder = findFolderById(folders, folderId);
                                                                                                const isAutoMapped = autoMappedBlocks[comp.id]?.includes(folderId.toString());
                                                                                                const isPageLevel = !directIds.includes(folderId.toString());

                                                                                                let displayName = `ID: ${folderId}`;
                                                                                                if (folder) {
                                                                                                    displayName = formatCustomFieldName(folder);
                                                                                                } else if (blockNamesMap[folderId]) {
                                                                                                    displayName = blockNamesMap[folderId];
                                                                                                }

                                                                                                return (
                                                                                                    <div
                                                                                                        key={`${comp.id}-mapping-${folderId}`}
                                                                                                        style={{
                                                                                                            padding: '6px 12px',
                                                                                                            backgroundColor: isPageLevel ? '#ecfeff' : (isAutoMapped ? '#fefce8' : '#f0fdf4'),
                                                                                                            borderRadius: '8px',
                                                                                                            fontSize: '12px',
                                                                                                            color: isPageLevel ? '#083344' : (isAutoMapped ? '#854d0e' : '#166534'),
                                                                                                            border: `1px solid ${isPageLevel ? '#a5f3fc' : (isAutoMapped ? '#fef08a' : '#dcfce7')}`,
                                                                                                            display: 'flex',
                                                                                                            alignItems: 'center',
                                                                                                            gap: '6px',
                                                                                                            fontWeight: 500,
                                                                                                        }}
                                                                                                    >
                                                                                                        <span style={{
                                                                                                            whiteSpace: 'nowrap',
                                                                                                            overflow: 'hidden',
                                                                                                            textOverflow: 'ellipsis',
                                                                                                            maxWidth: '305px'
                                                                                                        }}>
                                                                                                            {displayName}
                                                                                                        </span>
                                                                                                        {!isPageLevel && (
                                                                                                            <button
                                                                                                                onClick={(e) => {
                                                                                                                    e.stopPropagation();
                                                                                                                    handleRemoveMapping(comp.id, folderId);
                                                                                                                }}
                                                                                                                style={{
                                                                                                                    border: 'none',
                                                                                                                    background: 'none',
                                                                                                                    padding: '2px 4px',
                                                                                                                    cursor: 'pointer',
                                                                                                                    color: '#e11d48',
                                                                                                                    fontSize: '16px',
                                                                                                                    fontWeight: 'bold',
                                                                                                                    display: 'flex',
                                                                                                                    alignItems: 'center',
                                                                                                                    justifyContent: 'center',
                                                                                                                    lineHeight: 1,
                                                                                                                    marginLeft: '2px'
                                                                                                                }}
                                                                                                                title="Удалить привязку"
                                                                                                            >
                                                                                                                ×
                                                                                                            </button>
                                                                                                        )}
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                            {allIds.length > LIMIT && (
                                                                                                <button
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setExpandedMappedComponents(prev => ({
                                                                                                            ...prev,
                                                                                                            [comp.id]: !prev[comp.id]
                                                                                                        }));
                                                                                                    }}
                                                                                                    style={{ padding: '6px 12px', backgroundColor: '#f1f5f9', borderRadius: '8px', fontSize: '12px', color: '#6366f1', border: '1px solid #e2e8f0', cursor: 'pointer', fontWeight: 600 }}
                                                                                                >
                                                                                                    {isTagsExpanded ? 'Скрыть ▴' : `Еще +${allIds.length - LIMIT} ▾`}
                                                                                                </button>
                                                                                            )}
                                                                                        </>
                                                                                    );
                                                                                })()}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Правая колонка: Чем покрыть */}
                            <div style={{
                                width: '50%',
                                padding: '16px',
                                overflowY: 'auto',
                                backgroundColor: '#ffffff',
                                display: 'flex',
                                flexDirection: 'column'
                            }}>
                                { /* Заголовок и иконка-подсказка */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: '16px'
                                }}>
                                    <h3 style={{
                                        fontSize: '18px',
                                        fontWeight: 600,
                                        color: '#2c3e50',
                                        margin: 0
                                    }}>
                                        Чем покрыть
                                    </h3>
                                    <div
                                        title="Подсказка по маппингу:&#10;• Один клик — выбрать/убрать текущий элемент&#10;• Двойной клик — выбрать/убрать элемент со всеми вложенными"
                                        style={{
                                            cursor: 'help',
                                            fontSize: '18px',
                                            backgroundColor: '#f8fafc',
                                            width: '28px',
                                            height: '28px',
                                            borderRadius: '50%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            border: '1px solid #e2e8f0',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={(e) => {
                                            e.currentTarget.style.backgroundColor = '#f1f5f9';
                                        }}
                                        onMouseOut={(e) => {
                                            e.currentTarget.style.backgroundColor = '#f8fafc';
                                        }}
                                    >
                                        💡
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    placeholder="Поиск по дереву фич..."
                                    value={folderSearchTerm}
                                    onChange={(e) => setFolderSearchTerm(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        borderRadius: '8px',
                                        border: '1px solid #e2e8f0',
                                        fontSize: '14px',
                                        marginBottom: '12px',
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
                                            Выберите компонент слева, чтобы связать его с фичами
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
                            padding: '18px 28px',
                            borderTop: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '12px',
                            backgroundColor: '#f1f5f9',
                            flexShrink: 0,
                            zIndex: 10
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
                                    ? <Loader style={{ width: '100%', height: 20 }} />
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
                                    ? <Loader style={{ width: '100%', height: 20 }} />
                                    : 'Создать запуск'}
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

            {/* Split Modal — разделение на несколько запусков */}
            {showSplitModal && (
                <DragDropContext onDragEnd={onDragEnd}>
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2000,
                        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    }}>
                        <div style={{
                            backgroundColor: '#fff',
                            borderRadius: '24px',
                            width: '95%',
                            maxWidth: '1800px',
                            maxHeight: '95vh',
                            display: 'flex',
                            flexDirection: 'column',
                            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
                            overflow: 'hidden'
                        }}>
                            {/* Header */}
                            <div style={{
                                padding: '20px 28px',
                                borderBottom: '1px solid #e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <div>
                                    <h2 style={styles.subHeader}>
                                        Разделение на запуски
                                    </h2>
                                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
                                        Перетащите блоки из левой панели в нужный запуск
                                    </p>
                                </div>
                                <button
                                    onClick={handleSplitModalCancel}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        fontSize: '24px',
                                        color: '#94a3b8',
                                        cursor: 'pointer',
                                        padding: '8px'
                                    }}
                                >×</button>
                            </div>

                            {/* Two-column content */}
                            <div style={{
                                flex: 1,
                                display: 'flex',
                                overflow: 'hidden'
                            }}>
                                {/* Left Column — Unassigned Blocks (Tree View) */}
                                <div style={{
                                    width: '450px',
                                    borderRight: '1px solid #e2e8f0',
                                    backgroundColor: '#fff',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    flexShrink: 0
                                }}>
                                    <div style={{
                                        padding: '14px 18px',
                                        borderBottom: '1px solid #e2e8f0',
                                        fontWeight: 600,
                                        fontSize: '14px',
                                        color: '#1e293b',
                                        backgroundColor: '#f8fafc'
                                    }}>
                                        Блоки без назначения ({unassignedFolderIds.length})
                                    </div>

                                    <Droppable droppableId="unassigned-pool">
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.droppableProps}
                                                style={{
                                                    flex: 1,
                                                    overflowY: 'auto',
                                                    padding: '8px 0',
                                                    backgroundColor: snapshot.isDraggingOver ? '#f0f9ff' : 'transparent',
                                                    transition: 'background-color 0.2s ease'
                                                }}
                                            >
                                                {unassignedFolderIds.length === 0 ? (
                                                    <div style={{
                                                        padding: '32px 20px',
                                                        textAlign: 'center',
                                                        color: '#64748b',
                                                        fontSize: '13px'
                                                    }}>
                                                        Все блоки распределены по запускам
                                                    </div>
                                                ) : (
                                                    /* Flattened Tree Rendering to avoid nested Draggables */
                                                    (() => {
                                                        const unassignedSet = new Set(unassignedFolderIds.map(id => id.toString()));

                                                        // Helper to check if folder or any children are unassigned
                                                        const hasUnassignedItems = (folder) => {
                                                            if (unassignedSet.has(folder.id.toString())) return true;
                                                            return (folder.children || []).some(hasUnassignedItems);
                                                        };

                                                        // Flatten the visible part of the tree
                                                        const flattened = [];
                                                        const flatten = (nodes, depth = 0) => {
                                                            nodes.forEach(node => {
                                                                if (!hasUnassignedItems(node)) return;
                                                                const nodeId = node.id.toString();
                                                                flattened.push({ ...node, depth });
                                                                if (expandedSplitFolders[nodeId] && node.children) {
                                                                    flatten(node.children, depth + 1);
                                                                }
                                                            });
                                                        };
                                                        flatten(folders);

                                                        return (
                                                            <>
                                                                {flattened.map((node, index) => {
                                                                    const folderId = node.id.toString();
                                                                    const isUnassigned = unassignedSet.has(folderId);
                                                                    const hasChildren = node.children && node.children.length > 0;
                                                                    const isExpanded = expandedSplitFolders[folderId];

                                                                    return (
                                                                        <Draggable key={`pool::${folderId}`} draggableId={`pool::${folderId}`} index={index}>
                                                                            {(provided, snapshot) => (
                                                                                <div
                                                                                    ref={provided.innerRef}
                                                                                    {...provided.draggableProps}
                                                                                    style={{
                                                                                        ...provided.draggableProps.style,
                                                                                        marginBottom: '2px'
                                                                                    }}
                                                                                >
                                                                                    <div style={{
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        padding: '8px 12px',
                                                                                        paddingLeft: `${12 + node.depth * 20}px`,
                                                                                        borderBottom: '1px solid #f1f5f9',
                                                                                        backgroundColor: snapshot.isDragging ? '#e0f2fe' : (isUnassigned ? '#fff' : '#fafbfc'),
                                                                                        cursor: 'default'
                                                                                    }}>
                                                                                        {/* Drag Handle */}
                                                                                        <div {...provided.dragHandleProps} style={{ marginRight: '8px', color: '#64748b', cursor: 'grab' }}>
                                                                                            ⠿
                                                                                        </div>

                                                                                        {/* Expand/Collapse */}
                                                                                        {hasChildren ? (
                                                                                            <button
                                                                                                onClick={() => setExpandedSplitFolders(prev => ({
                                                                                                    ...prev,
                                                                                                    [folderId]: !prev[folderId]
                                                                                                }))}
                                                                                                style={{
                                                                                                    background: 'none',
                                                                                                    border: 'none',
                                                                                                    padding: '2px 6px',
                                                                                                    cursor: 'pointer',
                                                                                                    fontSize: '12px',
                                                                                                    color: '#64748b',
                                                                                                    marginRight: '4px'
                                                                                                }}
                                                                                            >
                                                                                                {isExpanded ? '▼' : '▶'}
                                                                                            </button>
                                                                                        ) : (
                                                                                            <span style={{ width: '24px' }} />
                                                                                        )}

                                                                                        {/* Folder name */}
                                                                                        <span style={{
                                                                                            flex: 1,
                                                                                            fontSize: node.node_type === 'TEST_CASE' ? '12px' : '13px',
                                                                                            fontWeight: isUnassigned ? (node.node_type === 'TEST_CASE' ? 400 : 500) : 400,
                                                                                            fontStyle: node.node_type === 'TEST_CASE' ? 'italic' : 'normal',
                                                                                            color: node.node_type === 'TEST_CASE' ? '#475569' : '#0f172a',
                                                                                            overflow: 'hidden',
                                                                                            textOverflow: 'ellipsis',
                                                                                            whiteSpace: 'nowrap'
                                                                                        }}>
                                                                                            {formatCustomFieldName(node)}
                                                                                            {node.testCasesCount > 0 && (
                                                                                                <span style={{
                                                                                                    marginLeft: '6px',
                                                                                                    fontSize: '11px',
                                                                                                    color: '#64748b'
                                                                                                }}>
                                                                                                    ({node.testCasesCount})
                                                                                                </span>
                                                                                            )}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </Draggable>
                                                                    );
                                                                })}
                                                                {provided.placeholder}
                                                            </>
                                                        );
                                                    })()
                                                )}
                                            </div>
                                        )}
                                    </Droppable>

                                    {/* Quick actions moved here to stay visible */}
                                    {unassignedFolderIds.length > 0 && launchGroups.length > 0 && (
                                        <div style={{
                                            padding: '12px 14px',
                                            borderTop: '1px solid #e2e8f0',
                                            backgroundColor: '#f8fafc'
                                        }}>
                                            <button
                                                onClick={() => {
                                                    const updated = [...launchGroups];
                                                    updated[0].folderIds = [...new Set([...updated[0].folderIds, ...unassignedFolderIds.map(id => id.toString())])];
                                                    setLaunchGroups(updated);
                                                    setUnassignedFolderIds([]);
                                                }}
                                                style={{
                                                    width: '100%',
                                                    padding: '10px',
                                                    backgroundColor: '#6366f1',
                                                    color: '#fff',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    fontSize: '13px',
                                                    fontWeight: 500,
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                Добавить все в Запуск 1
                                            </button>
                                        </div>
                                    )}
                                </div>


                                {/* Right Column — Launches */}
                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    padding: '20px'
                                }}>
                                    {launchGroups.map((group, groupIndex) => (
                                        <Droppable key={group.id} droppableId={`launch-${group.id}`}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.droppableProps}
                                                    style={{
                                                        backgroundColor: snapshot.isDraggingOver ? '#f1f5f9' : '#f8fafc',
                                                        borderRadius: '16px',
                                                        padding: '18px',
                                                        marginBottom: '16px',
                                                        border: snapshot.isDraggingOver ? '2px dashed #6366f1' : '1px solid #e2e8f0',
                                                        transition: 'all 0.2s ease'
                                                    }}
                                                >
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '10px',
                                                        marginBottom: '16px'
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                            <span style={{
                                                                width: '28px',
                                                                height: '28px',
                                                                borderRadius: '7px',
                                                                backgroundColor: '#6366f1',
                                                                color: '#fff',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontWeight: 600,
                                                                fontSize: '13px'
                                                            }}>{groupIndex + 1}</span>
                                                            <input
                                                                type="text"
                                                                value={group.name}
                                                                onChange={(e) => {
                                                                    const updated = [...launchGroups];
                                                                    updated[groupIndex].name = e.target.value;
                                                                    setLaunchGroups(updated);
                                                                }}
                                                                style={{
                                                                    flex: 1,
                                                                    padding: '8px 12px',
                                                                    fontSize: '15px',
                                                                    fontWeight: 500,
                                                                    border: '1px solid #e2e8f0',
                                                                    borderRadius: '8px',
                                                                    outline: 'none'
                                                                }}
                                                                placeholder="Название запуска"
                                                            />
                                                            {launchGroups.length > 1 && (
                                                                <button
                                                                    onClick={() => {
                                                                        // Return blocks to unassigned
                                                                        setUnassignedFolderIds(prev => [...prev, ...group.folderIds]);
                                                                        // Remove launch
                                                                        setLaunchGroups(launchGroups.filter((_, i) => i !== groupIndex));
                                                                    }}
                                                                    style={{
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        color: '#ef4444',
                                                                        cursor: 'pointer',
                                                                        padding: '8px'
                                                                    }}
                                                                >✕</button>
                                                            )}
                                                        </div>
                                                        <input
                                                            type="text"
                                                            value={group.jiraLink || ''}
                                                            onChange={(e) => {
                                                                const updated = [...launchGroups];
                                                                updated[groupIndex].jiraLink = e.target.value;
                                                                setLaunchGroups(updated);
                                                            }}
                                                            style={{
                                                                padding: '10px 14px',
                                                                fontSize: '13px',
                                                                border: '1px solid #cbd5e1',
                                                                borderRadius: '10px',
                                                                outline: 'none',
                                                                backgroundColor: '#fff',
                                                                color: '#0f172a',
                                                                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)',
                                                                width: '100%',
                                                                boxSizing: 'border-box'
                                                            }}
                                                            placeholder="Ссылка на задачу Jira"
                                                        />
                                                    </div>

                                                    <div style={{
                                                        minHeight: '40px',
                                                        backgroundColor: '#fff',
                                                        borderRadius: '12px',
                                                        border: '1px solid #e2e8f0',
                                                        overflow: 'hidden'
                                                    }}>
                                                        {(() => {
                                                            const groupFolderIds = new Set(group.folderIds || []);

                                                            // Helper to check if folder or any children are in this group
                                                            const hasGroupItems = (folder) => {
                                                                if (groupFolderIds.has(folder.id.toString())) return true;
                                                                return (folder.children || []).some(hasGroupItems);
                                                            };

                                                            // Flatten the visible part of the group tree
                                                            const groupFlattened = [];
                                                            const flattenGroup = (nodes, depth = 0) => {
                                                                nodes.forEach(node => {
                                                                    if (!hasGroupItems(node)) return;
                                                                    const nodeId = node.id.toString();
                                                                    groupFlattened.push({ ...node, depth });
                                                                    if (expandedSplitFolders[nodeId] && node.children) {
                                                                        flattenGroup(node.children, depth + 1);
                                                                    }
                                                                });
                                                            };
                                                            flattenGroup(folders);

                                                            if (groupFlattened.length === 0) {
                                                                return (
                                                                    <div style={{
                                                                        padding: '20px',
                                                                        textAlign: 'center',
                                                                        color: '#94a3b8',
                                                                        fontSize: '13px',
                                                                        fontStyle: 'italic'
                                                                    }}>
                                                                        Перетащите сюда блоки для этого запуска
                                                                    </div>
                                                                );
                                                            }

                                                            return groupFlattened.map((node, idx) => {
                                                                const folderId = node.id.toString();
                                                                const isDirectlyInGroup = groupFolderIds.has(folderId);
                                                                const hasChildren = node.children && node.children.length > 0;
                                                                const isExpanded = expandedSplitFolders[folderId];
                                                                const nodeType = node.node_type || 'FOLDER';

                                                                return (
                                                                    <Draggable key={`group::${group.id}::${folderId}`} draggableId={`group::${group.id}::${folderId}`} index={idx}>
                                                                        {(provided, snapshot) => (
                                                                            <div
                                                                                ref={provided.innerRef}
                                                                                {...provided.draggableProps}
                                                                                style={{
                                                                                    ...provided.draggableProps.style,
                                                                                    borderBottom: idx === groupFlattened.length - 1 ? 'none' : '1px solid #f1f5f9'
                                                                                }}
                                                                            >
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    padding: '10px 14px',
                                                                                    paddingLeft: `${14 + node.depth * 20}px`,
                                                                                    backgroundColor: snapshot.isDragging ? '#f0f9ff' : '#fff',
                                                                                    transition: 'background-color 0.2s ease'
                                                                                }}>
                                                                                    <div {...provided.dragHandleProps} style={{ marginRight: '10px', color: '#94a3b8', cursor: 'grab' }}>
                                                                                        ⠿
                                                                                    </div>

                                                                                    {hasChildren ? (
                                                                                        <button
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                setExpandedSplitFolders(prev => ({
                                                                                                    ...prev,
                                                                                                    [folderId]: !prev[folderId]
                                                                                                }));
                                                                                            }}
                                                                                            style={{
                                                                                                background: 'none',
                                                                                                border: 'none',
                                                                                                padding: '2px 6px',
                                                                                                cursor: 'pointer',
                                                                                                fontSize: '12px',
                                                                                                color: '#64748b',
                                                                                                marginRight: '4px'
                                                                                            }}
                                                                                        >
                                                                                            {isExpanded ? '▼' : '▶'}
                                                                                        </button>
                                                                                    ) : (
                                                                                        <span style={{ width: '24px' }} />
                                                                                    )}

                                                                                    <span style={{
                                                                                        flex: 1,
                                                                                        fontSize: nodeType === 'TEST_CASE' ? '12px' : '13px',
                                                                                        fontWeight: nodeType === 'TEST_CASE' ? 400 : 500,
                                                                                        color: isDirectlyInGroup ? '#0f172a' : '#64748b',
                                                                                        fontStyle: nodeType === 'TEST_CASE' ? 'italic' : 'normal',
                                                                                        overflow: 'hidden',
                                                                                        textOverflow: 'ellipsis',
                                                                                        whiteSpace: 'nowrap'
                                                                                    }}>
                                                                                        {formatCustomFieldName(node)}
                                                                                    </span>

                                                                                    {isDirectlyInGroup && (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                const updated = [...launchGroups];
                                                                                                const groupIdx = updated.findIndex(g => g.id === group.id);
                                                                                                if (groupIdx !== -1) {
                                                                                                    const idsToRemove = getAllDescendantIds(node);
                                                                                                    updated[groupIdx].folderIds = updated[groupIdx].folderIds.filter(id => !idsToRemove.includes(id));
                                                                                                    setLaunchGroups(updated);
                                                                                                    setUnassignedFolderIds(prev => [...new Set([...prev, ...idsToRemove])]);
                                                                                                }
                                                                                            }}
                                                                                            style={{
                                                                                                background: 'none',
                                                                                                border: 'none',
                                                                                                color: '#94a3b8',
                                                                                                cursor: 'pointer',
                                                                                                padding: '4px 8px',
                                                                                                borderRadius: '4px',
                                                                                                fontSize: '14px'
                                                                                            }}
                                                                                            onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
                                                                                            onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
                                                                                        >✕</button>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </Draggable>
                                                                );
                                                            });
                                                        })()}
                                                        {provided.placeholder}
                                                    </div>
                                                </div>
                                            )}
                                        </Droppable>
                                    ))}

                                    <button
                                        onClick={() => setLaunchGroups([...launchGroups, { id: Date.now(), name: `Запуск ${launchGroups.length + 1}`, folderIds: [] }])}
                                        style={{
                                            width: '100%',
                                            padding: '16px',
                                            border: '2px dashed #cbd5e1',
                                            borderRadius: '16px',
                                            backgroundColor: 'transparent',
                                            color: '#64748b',
                                            fontSize: '14px',
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        Добавить запуск
                                    </button>
                                </div>
                            </div>

                            {/* Footer */}
                            <div style={{
                                padding: '16px 28px',
                                borderTop: '1px solid #e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                backgroundColor: '#f8fafc'
                            }}>
                                <div style={{ fontSize: '13px', color: '#64748b' }}>
                                    Назначено: {launchGroups.reduce((sum, g) => sum + g.folderIds.length, 0)} блоков •
                                    Без назначения: {unassignedFolderIds.length}
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button
                                        onClick={handleSplitModalCancel}
                                        style={{
                                            padding: '10px 20px',
                                            borderRadius: '8px',
                                            border: '1px solid #e2e8f0',
                                            backgroundColor: '#fff',
                                            color: '#64748b',
                                            fontSize: '13px',
                                            fontWeight: 500,
                                            cursor: 'pointer'
                                        }}
                                    >Отмена</button>
                                    <button
                                        onClick={createMultipleLaunches}
                                        disabled={loadingState.launch || launchGroups.every(g => g.folderIds.length === 0)}
                                        style={{
                                            padding: '10px 24px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: launchGroups.every(g => g.folderIds.length === 0)
                                                ? '#94a3b8'
                                                : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                                            color: '#fff',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            cursor: launchGroups.every(g => g.folderIds.length === 0) ? 'not-allowed' : 'pointer',
                                            boxShadow: launchGroups.every(g => g.folderIds.length === 0) ? 'none' : '0 4px 12px rgba(99, 102, 241, 0.3)'
                                        }}
                                    >
                                        {loadingState.launch ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                                                <Loader style={{ width: 16, height: 16 }} />
                                                <span>Создание... {splitProgress ? `(${splitProgress.current}/${splitProgress.total})` : ''}</span>
                                            </div>
                                        ) : (
                                            (() => {
                                                const count = launchGroups.filter(g => g.folderIds.length > 0).length;
                                                return `Создать ${count} запуск${count === 1 ? '' : count > 1 && count < 5 ? 'а' : 'ов'}`;
                                            })()
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Progress bar */}
                            {splitProgress && (
                                <div style={{
                                    height: '4px',
                                    backgroundColor: '#e2e8f0'
                                }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${(splitProgress.current / splitProgress.total) * 100}%`,
                                        background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                                        transition: 'width 0.3s ease'
                                    }} />
                                </div>
                            )}
                        </div>
                    </div>
                </DragDropContext>
            )}

            {/* Модальное окно подтверждения незамапленных компонентов */}
            {
                showUnmappedModal && (() => {
                    const hasFrontend = unmappedComponentsList.some(c => c.type === 'frontend');
                    const hasBackend = unmappedComponentsList.some(c => c.type === 'backend');
                    const filteredList = unmappedComponentsList.filter(c => c.type === activeUnmappedTab);

                    return (
                        <div style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                            backdropFilter: 'blur(8px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 11000,
                            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                        }}>
                            <div style={{
                                backgroundColor: '#dc2626', // Красный фон модалки
                                borderRadius: '24px',
                                width: '650px',
                                maxWidth: '90vw',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                                overflow: 'hidden',
                                color: '#fff' // Белый шрифт для всей модалки
                            }}>
                                <div style={{
                                    padding: '32px 32px 20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '20px'
                                }}>
                                    <div style={{ flex: 1 }}>
                                        <h3 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#fff' }}>
                                            Незамапленные компоненты
                                        </h3>
                                        <div style={{ fontSize: '15px', color: 'rgba(255, 255, 255, 0.9)', marginTop: '4px', fontWeight: 500 }}>
                                            Обнаружено {unmappedComponentsList.length} пропущенных связей
                                        </div>
                                    </div>
                                </div>

                                {/* Tabs */}
                                {(hasFrontend && hasBackend) && (
                                    <div style={{
                                        display: 'flex',
                                        padding: '0 32px',
                                        gap: '8px',
                                        marginBottom: '16px'
                                    }}>
                                        {hasFrontend && (
                                            <button
                                                onClick={() => setActiveUnmappedTab('frontend')}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    backgroundColor: activeUnmappedTab === 'frontend' ? 'rgba(0, 0, 0, 0.2)' : 'transparent',
                                                    color: '#fff',
                                                    fontSize: '13px',
                                                    fontWeight: activeUnmappedTab === 'frontend' ? 700 : 500,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    opacity: activeUnmappedTab === 'frontend' ? 1 : 0.7
                                                }}
                                            >
                                                Фронтенд ({unmappedComponentsList.filter(c => c.type === 'frontend').length})
                                            </button>
                                        )}
                                        {hasBackend && (
                                            <button
                                                onClick={() => setActiveUnmappedTab('backend')}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    backgroundColor: activeUnmappedTab === 'backend' ? 'rgba(0, 0, 0, 0.2)' : 'transparent',
                                                    color: '#fff',
                                                    fontSize: '13px',
                                                    fontWeight: activeUnmappedTab === 'backend' ? 700 : 500,
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s',
                                                    opacity: activeUnmappedTab === 'backend' ? 1 : 0.7
                                                }}
                                            >
                                                Бэкенд ({unmappedComponentsList.filter(c => c.type === 'backend').length})
                                            </button>
                                        )}
                                    </div>
                                )}

                                <div style={{ padding: '0 32px 32px' }}>
                                    <p style={{ margin: '0 0 24px', fontSize: '16px', lineHeight: '1.4', color: '#fff', opacity: 0.95 }}>
                                        Вы не связали некоторые компоненты с функциональными блоками Allure.
                                        Это может привести к неполному покрытию тестами в созданном запуске.
                                        <br />
                                        <strong style={{ fontSize: '17px' }}>Вы уверены, что хотите продолжить?</strong>
                                    </p>

                                    <div style={{
                                        maxHeight: '280px',
                                        overflowY: 'auto',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        borderRadius: '16px',
                                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                        padding: '8px 0'
                                    }}>
                                        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                                            {filteredList.length > 0 ? filteredList.map((comp, idx) => (
                                                <li key={idx} style={{
                                                    padding: '10px 24px',
                                                    fontSize: '14px',
                                                    color: '#fff',
                                                    borderBottom: idx < filteredList.length - 1 ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px'
                                                }}>
                                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#fff', opacity: 0.6, flexShrink: 0 }} />
                                                    <span style={{ fontWeight: 500 }}>{comp.name || comp.serviceName || 'Unnamed Component'}</span>
                                                </li>
                                            )) : (
                                                <li style={{ padding: '24px', textAlign: 'center', opacity: 0.6, fontSize: '14px' }}>
                                                    Все компоненты этого типа сопоставлены
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                </div>

                                <div style={{
                                    padding: '24px 32px',
                                    backgroundColor: 'rgba(0, 0, 0, 0.15)',
                                    display: 'flex',
                                    justifyContent: 'flex-end',
                                    gap: '16px'
                                }}>
                                    <button
                                        onClick={() => setShowUnmappedModal(false)}
                                        style={{
                                            padding: '12px 24px',
                                            borderRadius: '12px',
                                            border: '1px solid rgba(255, 255, 255, 0.3)',
                                            backgroundColor: 'transparent',
                                            color: '#fff',
                                            fontSize: '15px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'}
                                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        Вернуться к маппингу
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowUnmappedModal(false);
                                            handleOpenSplitModal(true);
                                        }}
                                        style={{
                                            padding: '12px 28px',
                                            borderRadius: '12px',
                                            border: 'none',
                                            backgroundColor: '#fff',
                                            color: '#dc2626',
                                            fontSize: '15px',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2)',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={(e) => {
                                            e.currentTarget.style.backgroundColor = '#fef2f2';
                                        }}
                                        onMouseOut={(e) => {
                                            e.currentTarget.style.backgroundColor = '#fff';
                                        }}
                                    >
                                        Продолжить без них
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()

            }

            {/* Модальное окно для пустых групп */}
            {
                showEmptyGroupsModal && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 12000,
                        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    }}>
                        <div style={{
                            backgroundColor: '#fff',
                            borderRadius: '24px',
                            width: '600px',
                            maxWidth: '90vw',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                            overflow: 'hidden'
                        }}>
                            <div style={{ padding: '32px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                                    <div style={{
                                        width: '48px',
                                        height: '48px',
                                        backgroundColor: '#fee2e2',
                                        color: '#ef4444',
                                        borderRadius: '12px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '24px',
                                        fontWeight: 'bold'
                                    }}>!</div>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1e293b' }}>
                                            Обнаружены пустые группы
                                        </h3>
                                        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '14px' }}>
                                            Allure не нашел тест-кейсов в следующих папках:
                                        </p>
                                    </div>
                                </div>

                                <div style={{
                                    backgroundColor: '#1e293b',
                                    borderRadius: '12px',
                                    padding: '16px',
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    marginBottom: '24px',
                                    border: '1px solid #334155'
                                }}>
                                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                                        {emptyGroupsData.map((group) => (
                                            <li key={group.id} style={{
                                                padding: '8px 0',
                                                borderBottom: '1px solid #334155',
                                                fontSize: '14px',
                                                color: '#fff',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>•</span>
                                                {group.name || `ID: ${group.id}`}
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.5' }}>
                                    Вы можете создать автоматические заглушки (Stub Test Cases) в этих группах, чтобы Allure смог запустить их.
                                </p>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
                                    <button
                                        onClick={() => setShowEmptyGroupsModal(false)}
                                        style={{
                                            padding: '12px 24px',
                                            borderRadius: '12px',
                                            border: '1px solid #cbd5e1',
                                            backgroundColor: '#fff',
                                            color: '#64748b',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Отмена
                                    </button>
                                    <button
                                        onClick={handleCreateStubs}
                                        disabled={isCreatingStubs}
                                        style={{
                                            padding: '12px 24px',
                                            borderRadius: '12px',
                                            border: 'none',
                                            backgroundColor: '#ef4444',
                                            color: '#fff',
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            cursor: isCreatingStubs ? 'not-allowed' : 'pointer',
                                            opacity: isCreatingStubs ? 0.7 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                    >
                                        {isCreatingStubs ? 'Создание...' : 'Создать заглушки и закрыть'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
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
