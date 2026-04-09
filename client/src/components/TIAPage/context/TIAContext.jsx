import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import config from '../../../config';
import {
    logError,
    isNewTiaFormat,
    findFolderById,
    getAllDescendantIds,
    extractComponents,
    buildPageDependencies
} from '../utils/tiaUtils';

/**
 * Контекст для страницы TIA
 * @type {React.Context}
 */
const TIAContext = createContext();

/**
 * Провайдер контекста TIA
 * @param {Object} props - Свойства
 * @param {Array} [props.projects] - Начальный список проектов
 * @returns {JSX.Element}
 */
export const TIAProvider = ({ children, projects: initialProjects }) => {
    // Состояния проекта
    const [projectId, setProjectId] = useState(config.projectId || '');
    const [mode, setMode] = useState('mapping');
    const [hasStarted, setHasStarted] = useState(false);
    const [folders, setFolders] = useState([]);
    const [expandedFolders, setExpandedFolders] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const [loadingState, setLoadingState] = useState({
        structure: false,
        mapping: false,
        launch: false,
        saving: false
    });
    const [structureLoading, setStructureLoading] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const [allureLink, setAllureLink] = useState('');
    const [isPartialSaving, setIsPartialSaving] = useState(false);
    const [partialSaveMessage, setPartialSaveMessage] = useState('');
    const [jiraLink, setJiraLink] = useState('');

    // Состояния отчета и JSON
    const [tiaReport, setTiaReport] = useState(null);
    const [frontendJSON, setFrontendJSON] = useState(null);
    const [backendJSON, setBackendJSON] = useState(null);
    const [frontendFileName, setFrontendFileName] = useState('');
    const [backendFileName, setBackendFileName] = useState('');

    // Состояния раскрытия деталей (для Лайт-режима и UI Trace)
    const [expandedScenarios, setExpandedScenarios] = useState({});
    const [expandedUniqueComponents, setExpandedUniqueComponents] = useState({});
    const [expandedPageComponents, setExpandedPageComponents] = useState({});
    const [expandedMethods, setExpandedMethods] = useState({});
    const [expandedPageLists, setExpandedPageLists] = useState({});
    const [expandedCode, setExpandedCode] = useState({});
    const [expandedTechnicalDetails, setExpandedTechnicalDetails] = useState({});

    // Состояния маппинга
    const [components, setComponents] = useState([]);
    const [componentMappings, setComponentMappings] = useState({});
    const [autoMappedBlocks, setAutoMappedBlocks] = useState({});
    const [showMappingModal, setShowMappingModal] = useState(false);
    const [isMappingLoading, setIsMappingLoading] = useState(false);
    const [selectedComponentType, setSelectedComponentType] = useState('frontend');
    const [selectedComponentId, setSelectedComponentId] = useState(null);
    const [folderSearchTerm, setFolderSearchTerm] = useState('');

    // Состояния разделения
    const [showSplitModal, setShowSplitModal] = useState(false);
    const [splitProgress, setSplitProgress] = useState(null);
    const [launchGroups, setLaunchGroups] = useState([{ id: 'launch-1', name: 'Регресс тестирование', folderIds: [] }]);
    const [unassignedFolderIds, setUnassignedFolderIds] = useState([]);
    const [expandedSplitFolders, setExpandedSplitFolders] = useState({});

    // Состояния наследования
    const [pageMappings, setPageMappings] = useState({});
    const [showUnmappedModal, setShowUnmappedModal] = useState(false);
    const [unmappedComponentsList, setUnmappedComponentsList] = useState([]);
    const [activeUnmappedTab, setActiveUnmappedTab] = useState('frontend');
    const [showEmptyGroupsModal, setShowEmptyGroupsModal] = useState(false);
    const [emptyGroupsData, setEmptyGroupsData] = useState([]);
    const [isCreatingStubs, setIsCreatingStubs] = useState(false);
    const [expandedMappedComponents, setExpandedMappedComponents] = useState({});
    const [disabledInheritance, setDisabledInheritance] = useState({});
    const [expandedDetails, setExpandedDetails] = useState({});
    const [dirtyComponents, setDirtyComponents] = useState({});
    const [projects, setProjects] = useState(initialProjects || []);

    const markComponentAsDirty = useCallback((id) => {
        setDirtyComponents(prev => ({ ...prev, [id]: true }));
    }, []);

    /**
     * Загрузка списка проектов
     */
    const loadProjects = useCallback(async () => {
        if (initialProjects && initialProjects.length > 0) return;
        try {
            const response = await axios.get(`${config.url}/projects`);
            const data = response.data;
            if (Array.isArray(data)) {
                setProjects(data);
            } else if (data && Array.isArray(data.data)) {
                setProjects(data.data);
            } else if (data && Array.isArray(data.projects)) {
                setProjects(data.projects);
            }
        } catch (err) {
            setError('Ошибка при загрузке проектов');
            logError('Load projects error', err.message, config);
        }
    }, [initialProjects]);

    /**
     * Синхронизация сброса состояний при размонтировании
     */
    const resetStates = useCallback(() => {
        setProjectId('');
        setBackendJSON(null);
        setFrontendFileName('');
        setBackendFileName('');
        setHasStarted(false);
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
    }, []);

    useEffect(() => {
        loadProjects();
        return resetStates;
    }, [loadProjects, resetStates]);

    /**
     * Загрузка существующих маппингов для проекта
     * @param {string|number} projectid - ID проекта
     */
    const fetchExistingMappings = useCallback(async (projectid) => {
        if (!projectid) return [];
        try {

            const response = await axios.get(`${config.TIAUrl}/api/components`, {
                params: { projectId: projectid },
            });
            return response.data.mappings || [];
        } catch (err) {
            logError('Fetch mappings error', err.message, config.TIAUrl);
            return [];
        }
    }, []);

    /**
     * Сохранение маппинга компонента
     * @param {Object} component - Компонент
     * @param {string[]} folderIds - ID функциональных блоков
     * @param {Array} allComponents 
     * @param {Array} allPageDependencies
     */
    const saveComponentMapping = useCallback(async (component, folderIds, allComponents, allPageDependencies, currentDisabledInheritance = {}) => {
        try {
            let report = null;
            if (component.type === 'frontend') {
                report = frontendJSON && isNewTiaFormat(frontendJSON) ? frontendJSON : null;
            } else if (component.type === 'backend') {
                report = backendJSON && isNewTiaFormat(backendJSON) ? backendJSON : null;
            }
            if (!report) {
                report = (frontendJSON && isNewTiaFormat(frontendJSON))
                    ? frontendJSON
                    : ((backendJSON && isNewTiaFormat(backendJSON)) ? backendJSON : null);
            }

            const releaseVersion = report?.release_version || null;
            const changeDate = report?.change_date || null;
            const isBugFix = report?.is_bug_fix || false;
            const issueKey = report?.issue_key || null;
            const mrIid = report?.mr_iid || null;

            const functionalBlocks = folderIds.length > 0 ? folderIds.map(id => id.toString()) : [];

            const isInheritanceBlocked = currentDisabledInheritance[component.id];
            const pageDeps = isInheritanceBlocked
                ? []
                : (allPageDependencies || []).filter(dep => dep.componentName === component.name);

            await axios.post(`${config.TIAUrl}/api/components`, {
                projectId,
                componentType: component.type,
                componentName: component.name,
                functionalBlock: functionalBlocks,
                pageDependencies: pageDeps,
                releaseVersion,
                changeDate,
                isBugFix,
                issueKey,
                mrIid,
            });
        } catch (err) {
            logError('Save component mapping error', err.message, config.TIAUrl);
            throw new Error(`Не удалось сохранить маппинг для компонента ${component.name}.`);
        }
    }, [projectId, frontendJSON, backendJSON]);

    /**
     * Обработка смены проекта
     * @param {Object} e - Событие изменения
     */
    const handleProjectChange = useCallback(async (e) => {
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
                logError('Fetch structure error', err.message, config.TIAUrl);
            } finally {
                setStructureLoading(false);
            }
        }
    }, []);

    /**
     * Загрузка JSON фронтенда
     * @param {Object} e - Событие изменения файла
     */
    const handleFrontendJSONUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;
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
                setFrontendJSON(json);
                setTiaReport(null);
                setError('');
            } catch (err) {
                setError('Неверный формат JSON-файла.');
                logError('Frontend JSON parse error', err.message, config.TIAUrl);
            }
        };
        reader.readAsText(file);
    }, []);

    /**
     * Загрузка JSON бэкенда
     * @param {Object} e - Событие изменения файла
     */
    const handleBackendJSONUpload = useCallback((e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target.result);
                setBackendFileName(file.name);
                if (isNewTiaFormat(json)) {
                    setTiaReport(json);
                    setBackendJSON(json);
                    setError('');
                    return;
                }
                setBackendJSON(json);
                setError('');
            } catch (err) {
                setError('Неверный формат JSON-файла для бэкенда.');
                logError('Backend JSON parse error', err.message, config.TIAUrl);
            }
        };
        reader.readAsText(file);
    }, []);


    /**
     * Переключение раскрытия папки
     * @param {string|number} folderId
     * @param {Object} event
     */
    const handleFolderToggle = useCallback((folderId, event) => {
        if (event) event.stopPropagation();
        setExpandedFolders((prev) => ({
            ...prev,
            [folderId]: !prev[folderId],
        }));
    }, []);

    /**
     * Переключение раскрытия блока деталей
     * @param {string} detailKey
     */
    const toggleDetails = useCallback((detailKey) => {
        setExpandedDetails(prev => ({
            ...prev,
            [detailKey]: !prev[detailKey],
        }));
    }, []);



    /**
     * Создание нескольких запусков Allure
     */
    const createMultipleLaunches = useCallback(async () => {
        setLoadingState(prev => ({ ...prev, launch: true }));
        setError('');
        setSuccessMessage('');
        setAllureLink('');

        const createdLaunches = [];
        const failedLaunches = [];
        const allEmptyGroups = [];

        try {
            for (let i = 0; i < launchGroups.length; i++) {
                const group = launchGroups[i];
                if (!group.folderIds || group.folderIds.length === 0) continue;

                setSplitProgress({ current: i + 1, total: launchGroups.length, launchName: group.name });

                try {
                    const requestBody = {
                        projectId,
                        jiraLink: group.jiraLink || '',
                        launchName: group.name,
                        groupsInclude: group.folderIds.map(id => parseInt(id, 10)),
                        componentMappings
                    };

                    const response = await axios.post(`${config.TIAUrl}/api/launch`, requestBody, {
                        headers: { 'Content-Type': 'application/json' },
                    });
                    const { id } = response.data;
                    createdLaunches.push({ name: group.name, id, link: `${config.url}/launch/${id}` });
                    setLaunchGroups(prev => prev.filter(g => g.id !== group.id));
                } catch (err) {
                    const errorData = err.response?.data;
                    const errorMsg = errorData?.details || errorData?.error || err.message;
                    failedLaunches.push({ name: group.name, error: errorMsg });

                    if (errorData?.code === 'EMPTY_GROUPS') {
                        if (errorData.emptyGroups && Array.isArray(errorData.emptyGroups) && errorData.emptyGroups.length > 0) {
                            allEmptyGroups.push(...errorData.emptyGroups);
                        } else if (group.folderIds) {
                            allEmptyGroups.push(...group.folderIds.map(id => {
                                const folder = findFolderById(folders, parseInt(id));
                                return { id, name: folder ? folder.name : `Блок ${id}` };
                            }));
                        }
                    }

                    logError(`Failed to create launch "${group.name}"`, errorMsg, config.TIAUrl);
                }
            }

            if (createdLaunches.length > 0) {
                if (createdLaunches.length === 1) {
                    setSuccessMessage(`Запуск "${createdLaunches[0].name}" успешно создан!`);
                    setAllureLink(createdLaunches[0].link);
                } else {
                    setSuccessMessage(`Успешно создано ${createdLaunches.length} запусков!`);
                    setAllureLink(createdLaunches[0].link);
                }
            }

            if (failedLaunches.length > 0) {
                const failedNames = failedLaunches.map(f => f.name).join(', ');
                setError(`Не удалось создать: ${failedNames}`);
            }

            if (createdLaunches.length > 0 && failedLaunches.length === 0) {
                setShowSplitModal(false);
            }

            if (allEmptyGroups.length > 0) {
                const uniqueEmptyGroups = Array.from(new Map(allEmptyGroups.map(item => [item.id, item])).values());
                setEmptyGroupsData(uniqueEmptyGroups);
                setShowEmptyGroupsModal(true);
            }
        } catch (err) {
            setError(`Ошибка при создании запусков: ${err.message}`);
            logError('Multiple launches creation error', err.message, config.TIAUrl);
        } finally {
            setLoadingState(prev => ({ ...prev, launch: false }));
            setIsLoading(false);
            setSplitProgress(null);
        }
    }, [projectId, launchGroups, componentMappings, folders]);

    /**
     * Создание заглушек для пустых групп
     */
    const handleCreateStubs = useCallback(async () => {
        setIsCreatingStubs(true);
        try {
            const jiraIssueKeyMatch = jiraLink?.match(/\/browse\/([A-Z]+-\d+)$/);
            const issueKey = jiraIssueKeyMatch ? jiraIssueKeyMatch[1] : (jiraLink?.includes('/') ? jiraLink.split('/').pop() : jiraLink) || null;

            const promises = emptyGroupsData.map(group =>
                axios.post(`${config.TIAUrl}/api/stub`, {
                    projectId,
                    parentId: group.id,
                    name: group.name || `Group ${group.id}`,
                    issueKey: issueKey || null
                })
            );

            await Promise.all(promises);
            setShowEmptyGroupsModal(false);
            setEmptyGroupsData([]);

            if (launchGroups.length > 0 && launchGroups[0].folderIds.length > 0) {
                createMultipleLaunches();
            } else {
                handleOpenMappingModal();
            }
        } catch (err) {
            logError('Stub creation error', err.message, config.TIAUrl);
            setError('Не удалось создать заглушки: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsCreatingStubs(false);
        }
    }, [projectId, emptyGroupsData, launchGroups, jiraLink, createMultipleLaunches]);

    /**
     * Обработка завершения перетаскивания днд
     */
    const onDragEnd = useCallback((result) => {
        const { source, destination, draggableId } = result;
        if (!destination) return;
        if (source.droppableId === destination.droppableId && source.index === destination.index) return;

        const folderId = draggableId.split('::').pop();
        const node = findFolderById(folders, folderId);

        const sourceIds = source.droppableId === 'unassigned-pool'
            ? unassignedFolderIds
            : launchGroups.find(g => `launch-${g.id}` === source.droppableId)?.folderIds || [];

        const potentialIds = node ? getAllDescendantIds(node) : [folderId];
        const idsToMove = potentialIds.filter(id =>
            sourceIds.some(sid => sid.toString() === id.toString())
        );

        if (idsToMove.length === 0) return;

        let newUnassigned = unassignedFolderIds.map(id => id.toString());
        let newLaunchGroups = launchGroups.map(g => ({
            ...g,
            folderIds: (g.folderIds || []).map(id => id.toString())
        }));

        newUnassigned = newUnassigned.filter(id => !idsToMove.includes(id));
        newLaunchGroups = newLaunchGroups.map(g => ({
            ...g,
            folderIds: g.folderIds.filter(id => !idsToMove.includes(id))
        }));

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
    }, [folders, launchGroups, unassignedFolderIds]);

    /**
     * Отмена разделения запусков
     */
    const handleSplitModalCancel = useCallback(() => {
        setShowSplitModal(false);
        setIsLoading(false);
        setLoadingState(prev => ({ ...prev, launch: false }));
        setSplitProgress(null);
        setIsMappingLoading(false);
    }, []);

    /**
     * Отмена маппинга
     */
    const handleMappingCancel = useCallback(() => {
        setShowMappingModal(false);
        setComponents([]);
        setComponentMappings({});
        setError('');
        setPartialSaveMessage('');
        setIsMappingLoading(false);
        setIsPartialSaving(false);
        setIsLoading(false);
    }, []);

    /**
     * Частичное сохранение маппинга
     */
    const handlePartialSave = useCallback(async () => {
        setIsPartialSaving(true);
        setError('');
        setPartialSaveMessage('');

        try {
            const dirtyIds = Object.keys(dirtyComponents);
            if (dirtyIds.length === 0) {
                setPartialSaveMessage('Нет изменений для сохранения.');
                setTimeout(() => setPartialSaveMessage(''), 3000);
                setIsPartialSaving(false);
                return;
            }

            const allComponents = extractComponents(frontendJSON, backendJSON, tiaReport);
            const allPageDependencies = buildPageDependencies(allComponents, frontendJSON, backendJSON);
            const chunkSize = 5;
            const dirtyComponentsList = components.filter(c => dirtyComponents[c.id]);

            for (let i = 0; i < dirtyComponentsList.length; i += chunkSize) {
                const chunk = dirtyComponentsList.slice(i, i + chunkSize);
                await Promise.all(chunk.map(c => {
                    const folderIds = componentMappings[c.id] || [];
                    return saveComponentMapping(c, folderIds, allComponents, allPageDependencies, disabledInheritance);
                }));
            }

            setDirtyComponents({});

            const hasNewFormat = (frontendJSON && isNewTiaFormat(frontendJSON)) || (backendJSON && isNewTiaFormat(backendJSON));
            if (hasNewFormat && allPageDependencies.length > 0) {
                try {
                    await axios.post(`${config.TIAUrl}/api/components/page-dependencies`, {
                        projectId,
                        pageDependencies: allPageDependencies,
                    });
                } catch (depErr) {
                    logError('Save page dependencies error', depErr.message, config.TIAUrl);
                }
            }

            setPartialSaveMessage('Маппинг успешно сохранён, можете продолжить.');
            setTimeout(() => setPartialSaveMessage(''), 5000);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsPartialSaving(false);
        }
    }, [projectId, components, componentMappings, frontendJSON, backendJSON, tiaReport, saveComponentMapping, disabledInheritance]);

    /**
     * Переключение блокировки наследования
     * @param {string} compId
     */
    const toggleInheritance = useCallback((compId) => {
        setDisabledInheritance(prev => ({
            ...prev,
            [compId]: !prev[compId]
        }));
        markComponentAsDirty(compId);
    }, [markComponentAsDirty]);

    /**
     * Поиск папки по Allure ID (вспомогательная для маппинга)
     * @param {string|number} allureId 
     * @returns {Object|null}
     */
    const findFolderAllureId = useCallback((allureId) => {
        if (!allureId || !folders) return null;
        const idStr = allureId.toString().trim();

        const traverse = (nodes) => {
            for (const node of nodes) {
                if (node.id?.toString().trim() === idStr) return node;
                if (node.children) {
                    const found = traverse(node.children);
                    if (found) return found;
                }
            }
            return null;
        };

        return traverse(folders);
    }, [folders]);

    /**
     * Обработка открытия модального окна маппинга
     */
    const handleOpenMappingModal = useCallback(async () => {
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

        if (jiraLink && !jiraLink.match(/^https?:\/\/jira\.abanking\.ru\/browse\/[A-Z]+-\d+$/)) {
            setError('Пожалуйста, введите корректную ссылку на задачу в Jira (например, https://jira.abanking.ru/browse/CTMM-528) или оставьте поле пустым.');
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccessMessage('');

        try {
            const extractedComp = extractComponents(frontendJSON, backendJSON, tiaReport);
            if (extractedComp.length === 0) {
                setError('Компоненты не найдены в загруженных JSON-файлах. Проверьте структуру файлов.');
                setIsLoading(false);
                return;
            }

            setComponents(extractedComp);
            const existingMappings = await fetchExistingMappings(projectId);

            const initialMappings = {};
            const autoMapped = {};

            extractedComp.forEach(component => {
                const mappingsForComponent = (Array.isArray(existingMappings) ? existingMappings : []).filter(
                    m => m.component_name === component.name
                );
                const folderIds = mappingsForComponent
                    .map(m => findFolderAllureId(m.functional_block_allure_id)?.id?.toString() || '')
                    .filter(id => id);
                initialMappings[component.id] = folderIds.length > 0 ? folderIds : [];
                autoMapped[component.id] = [];
            });

            const pageDeps = buildPageDependencies(extractedComp, frontendJSON, backendJSON);
            const allRelatedNames = new Set();
            pageDeps.forEach(dep => { if (dep.pageName?.trim()) allRelatedNames.add(dep.pageName.trim()); });
            extractedComp.forEach(comp => { if (comp.name?.trim()) allRelatedNames.add(comp.name.trim()); });

            const pageNames = Array.from(allRelatedNames);
            if (pageNames.length > 0) {
                const response = await axios.post(`${config.TIAUrl}/api/components/page-mappings`, {
                    projectId,
                    pageNames
                });
                const fetchedPageMappings = response.data.pageMappings || {};
                setPageMappings(fetchedPageMappings);

                extractedComp.forEach(component => {
                    const componentId = component.id;
                    const relatedPageNames = new Set(
                        pageDeps.filter(dep => dep.componentName === component.name).map(dep => dep.pageName?.trim()).filter(name => name)
                    );
                    if (component.name?.trim()) relatedPageNames.add(component.name.trim());

                    const autoFolderIds = new Set(initialMappings[componentId] || []);
                    const currentAuto = new Set();

                    relatedPageNames.forEach(pageName => {
                        const pageMapping = fetchedPageMappings[pageName] || [];
                        pageMapping.forEach(mapping => {
                            const folderId = findFolderAllureId(mapping.functional_block_allure_id)?.id?.toString();
                            if (folderId && !autoFolderIds.has(folderId)) {
                                autoFolderIds.add(folderId);
                                currentAuto.add(folderId);
                            }
                        });
                    });

                    initialMappings[componentId] = Array.from(autoFolderIds);
                    autoMapped[componentId] = Array.from(currentAuto);
                });
            }

            setComponentMappings(initialMappings);
            setAutoMappedBlocks(autoMapped);
            setDirtyComponents({});
            setShowMappingModal(true);
        } catch (err) {
            setError('Произошла ошибка при обработке компонентов. Проверьте данные и повторите попытку.');
            logError('Component mapping setup error', err.message, config.TIAUrl);
        } finally {
            setIsLoading(false);
        }
    }, [mode, projectId, frontendJSON, backendJSON, tiaReport, jiraLink, findFolderAllureId, fetchExistingMappings]);

    /**
     * Открытие сплит модалки с предзаполненными данными 
     * @param {boolean} [force=false] - Принудительное открытие без проверки незамапленных
     */
    const handleOpenSplitModal = useCallback(async (force = false) => {
        setIsMappingLoading(true);
        const allComponents = extractComponents(frontendJSON, backendJSON, tiaReport);
        const allPageDependencies = buildPageDependencies(allComponents, frontendJSON, backendJSON);

        if (!force) {
            const unmapped = components.filter(c => {
                if (componentMappings[c.id] && componentMappings[c.id].length > 0) return false;

                if (disabledInheritance[c.id]) return true;

                const relatedPageNames = allPageDependencies
                    .filter(dep => dep.componentName === c.name)
                    .map(dep => dep.pageName);

                relatedPageNames.push(c.name);

                const hasInheritance = relatedPageNames.some(pn => pageMappings[pn] && pageMappings[pn].length > 0);

                return !hasInheritance;
            });

            if (unmapped.length > 0) {
                setUnmappedComponentsList(unmapped);
                const hasFrontend = unmapped.some(c => c.type === 'frontend');
                const hasBackend = unmapped.some(c => c.type === 'backend');
                if (hasFrontend) setActiveUnmappedTab('frontend');
                else if (hasBackend) setActiveUnmappedTab('backend');
                setShowUnmappedModal(true);
                setIsMappingLoading(false);
                return;
            }
        }

        setLoadingState(prev => ({ ...prev, launch: true }));

        try {
            const dirtyComponentsList = components.filter(c => dirtyComponents[c.id]);
            const chunkSize = 5;
            for (let i = 0; i < dirtyComponentsList.length; i += chunkSize) {
                const chunk = dirtyComponentsList.slice(i, i + chunkSize);
                await Promise.all(chunk.map(component => {
                    const folderIds = componentMappings[component.id] || [];
                    return saveComponentMapping(component, folderIds, allComponents, allPageDependencies, disabledInheritance);
                }));
            }
            setDirtyComponents({});

            const allFolderIds = new Set();
            Object.values(componentMappings).forEach(ids => {
                if (Array.isArray(ids)) ids.forEach(id => allFolderIds.add(id.toString()));
            });
            const uniqueFolderIds = Array.from(allFolderIds);

            if (uniqueFolderIds.length === 0) {
                setError('Не выбрано ни одного функционального блока для запуска.');
                return;
            }

            let defaultName = 'Регресс тестирование';
            if (jiraLink) {
                const match = jiraLink.match(/\/browse\/([A-Z]+-\d+)$/);
                defaultName = `Регресс тестирование ${match ? match[1] : jiraLink.split('/').pop()}`;
            } else {
                defaultName = `Регресс тестирование ${new Date().toLocaleDateString('ru-RU')}`;
            }

            setUnassignedFolderIds(uniqueFolderIds);

            setLaunchGroups([{ id: 'launch-1', name: defaultName, folderIds: [], jiraLink: jiraLink || '' }]);

            setShowMappingModal(false);
            setShowUnmappedModal(false);
            setShowSplitModal(true);
        } catch (err) {
            setError(err.message);
            logError('Error preparing split modal', err.message, config.TIAUrl);
        } finally {
            setIsMappingLoading(false);
            setLoadingState(prev => ({ ...prev, launch: false }));
        }
    }, [components, componentMappings, disabledInheritance, pageMappings, frontendJSON, backendJSON, tiaReport, jiraLink, saveComponentMapping]);

    /**
     * Подтверждение маппинга и переход к созданию запусков
     */
    const handleMappingConfirm = useCallback(async (type = 'launch') => {
        if (type === 'split') {
            const activeGroups = launchGroups.filter(g => g.folderIds && g.folderIds.length > 0);
            const count = activeGroups.length;

            if (count === 0) {
                setError('Не выбрано ни одного блока для запуска.');
                return;
            }

            return await createMultipleLaunches();
        }

        await handleOpenSplitModal();
    }, [launchGroups, createMultipleLaunches, handleOpenSplitModal]);

    /**
     * Удаление привязки компонента к блоку
     * @param {string} compId
     * @param {string} folderId
     */
    const handleRemoveMapping = useCallback((compId, folderId) => {
        setComponentMappings(prev => ({
            ...prev,
            [compId]: (prev[compId] || []).filter(id => id.toString() !== folderId.toString())
        }));
        setAutoMappedBlocks(prev => ({
            ...prev,
            [compId]: (prev[compId] || []).filter(id => id.toString() !== folderId.toString())
        }));
        markComponentAsDirty(compId);
    }, [markComponentAsDirty]);

    const isCreateButtonDisabled = useCallback(() => {
        if (!projectId) return true;
        if (!frontendJSON && !backendJSON && !tiaReport) return true;
        if (isLoading || structureLoading || !folders || folders.length === 0) return true;
        return false;
    }, [projectId, frontendJSON, backendJSON, tiaReport, isLoading, structureLoading, folders]);

    /**
     * Получение причины недоступности кнопки
     * @returns {string}
     */
    const getCreateButtonDisabledReason = useCallback(() => {
        if (!projectId) return 'Выберите проект';
        if (!frontendJSON && !backendJSON && !tiaReport) return 'Загрузите JSON';
        if (isLoading) return 'Загрузка...';
        if (structureLoading || !folders || folders.length === 0) return 'Загрузка дерева проекта...';
        return '';
    }, [projectId, frontendJSON, backendJSON, tiaReport, isLoading, structureLoading, folders]);

    const value = {
        projectId, setProjectId,
        folders, setFolders,
        expandedFolders, setExpandedFolders,
        isLoading, setIsLoading,
        loadingState, setLoadingState,
        structureLoading, setStructureLoading,
        error, setError,
        successMessage, setSuccessMessage,
        allureLink, setAllureLink,
        isPartialSaving, setIsPartialSaving,
        partialSaveMessage, setPartialSaveMessage,
        tiaReport, setTiaReport,
        frontendJSON, setFrontendJSON,
        backendJSON, setBackendJSON,
        frontendFileName, setFrontendFileName,
        backendFileName, setBackendFileName,
        expandedScenarios, setExpandedScenarios,
        expandedUniqueComponents, setExpandedUniqueComponents,
        expandedPageComponents, setExpandedPageComponents,
        expandedMethods, setExpandedMethods,
        expandedPageLists, setExpandedPageLists,
        expandedTechnicalDetails, setExpandedTechnicalDetails,
        expandedCode, setExpandedCode,
        components, setComponents,
        componentMappings, setComponentMappings,
        autoMappedBlocks, setAutoMappedBlocks,
        showMappingModal, setShowMappingModal,
        isMappingLoading, setIsMappingLoading,
        selectedComponentType, setSelectedComponentType,
        selectedComponentId, setSelectedComponentId,
        folderSearchTerm, setFolderSearchTerm,
        showSplitModal, setShowSplitModal,
        splitProgress, setSplitProgress,
        launchGroups, setLaunchGroups,
        unassignedFolderIds, setUnassignedFolderIds,
        expandedSplitFolders, setExpandedSplitFolders,
        pageMappings, setPageMappings,
        showUnmappedModal, setShowUnmappedModal,
        unmappedComponentsList, setUnmappedComponentsList,
        activeUnmappedTab, setActiveUnmappedTab,
        showEmptyGroupsModal, setShowEmptyGroupsModal,
        emptyGroupsData, setEmptyGroupsData,
        isCreatingStubs, setIsCreatingStubs,
        expandedMappedComponents, setExpandedMappedComponents,
        expandedDetails, setExpandedDetails,
        toggleDetails,
        disabledInheritance, setDisabledInheritance,
        projects,
        loadProjects,
        handleProjectChange,
        handleFrontendJSONUpload,
        handleBackendJSONUpload,
        handleFolderToggle,
        onDragEnd,
        handleSplitModalCancel,
        handleMappingCancel,
        handlePartialSave,
        toggleInheritance,
        handleMappingConfirm,
        handleRemoveMapping,
        mode, setMode,
        hasStarted, setHasStarted,
        jiraLink, setJiraLink,
        handleOpenMappingModal,
        handleOpenSplitModal,
        handleCreateTestPlan: handleOpenMappingModal,
        handleCreateStubs,
        createMultipleLaunches,
        isCreateButtonDisabled,
        getCreateButtonDisabledReason,
        findFolderAllureId,
        markComponentAsDirty
    };

    return <TIAContext.Provider value={value}>{children}</TIAContext.Provider>;
};

/**
 * Хук для использования контекста TIA
 * @returns {Object}
 */
export const useTIA = () => {
    const context = useContext(TIAContext);
    if (!context) {
        throw new Error('useTIA must be used within a TIAProvider');
    }
    return context;
};
