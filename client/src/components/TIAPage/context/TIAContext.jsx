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
    const [mode, setMode] = useState('mapping'); // 'mapping' | 'light'
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

    // Состояния отчета и JSON
    const [tiaReport, setTiaReport] = useState(null);
    const [frontendJSON, setFrontendJSON] = useState(null);
    const [backendJSON, setBackendJSON] = useState(null);
    const [frontendFileName, setFrontendFileName] = useState('');
    const [backendFileName, setBackendFileName] = useState('');

    // Состояния раскрытия деталей
    const [expandedScenarios, setExpandedScenarios] = useState({});
    const [expandedCode, setExpandedCode] = useState({});

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
    const [launchGroups, setLaunchGroups] = useState([{ name: 'Main', folderIds: [] }]);
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

    const [projects, setProjects] = useState(initialProjects || []);

    /**
     * Загрузка списка проектов (fallback если пропсы пусты)
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
        if (!projectid) return {};
        try {
            const response = await axios.get(`${config.TIAUrl}/api/components/mappings`, {
                params: { projectId: projectid },
            });
            const mappings = response.data.mappings || {};
            setComponentMappings(mappings);
            return mappings;
        } catch (err) {
            logError('Fetch mappings error', err.message, config.TIAUrl);
            return {};
        }
    }, []);

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
                await fetchExistingMappings(selectedProjectId);
            } catch (err) {
                setError('Не удалось загрузить структуру проекта. Попробуйте позже.');
                logError('Fetch structure error', err.message, config.TIAUrl);
            } finally {
                setStructureLoading(false);
            }
        }
    }, [fetchExistingMappings]);

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
     * @param {string|number} folderId - ID папки
     * @param {Object} event - Событие клика
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
     * @param {string} detailKey - Ключ блока
     */
    const toggleDetails = useCallback((detailKey) => {
        setExpandedDetails(prev => ({
            ...prev,
            [detailKey]: !prev[detailKey],
        }));
    }, []);

    /**
     * Сохранение маппинга компонента
     * @param {Object} component - Компонент
     * @param {string[]} folderIds - Список ID функциональных блоков
     * @param {Array} allComponents - Все компоненты (для контекста)
     * @param {Array} allPageDependencies - Все зависимости (для контекста)
     */
    const saveComponentMapping = useCallback(async (component, folderIds, allComponents, allPageDependencies) => {
        try {
            const report = (component.type === 'frontend' ? frontendJSON : backendJSON) || tiaReport;
            const releaseVersion = report?.release_version || null;
            const changeDate = report?.change_date || null;
            const isBugFix = report?.is_bug_fix || false;
            const issueKey = report?.issue_key || null;
            const mrIid = report?.mr_iid || null;

            const functionalBlocks = folderIds.length > 0 ? folderIds.map(id => id.toString()) : [];
            const isInheritanceBlocked = disabledInheritance[component.id];
            const pageDeps = isInheritanceBlocked ? [] : allPageDependencies.filter(dep => dep.componentName === component.name);

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
    }, [projectId, frontendJSON, backendJSON, tiaReport, disabledInheritance]);

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
                        jiraLink: '',
                        launchName: group.name,
                        groupsInclude: group.folderIds.map(id => parseInt(id, 10)),
                        componentMappings
                    };

                    const response = await axios.post(`${config.TIAUrl}/api/launch`, requestBody);
                    const { id } = response.data;
                    createdLaunches.push({ name: group.name, id, link: `${config.url}/launch/${id}` });
                    setLaunchGroups(prev => prev.filter(g => g.id !== group.id));
                } catch (err) {
                    const errorData = err.response?.data;
                    const errorMsg = errorData?.details || errorData?.error || err.message;
                    failedLaunches.push({ name: group.name, error: errorMsg });

                    if (errorData?.code === 'EMPTY_GROUPS') {
                        if (errorData.emptyGroups) allEmptyGroups.push(...errorData.emptyGroups);
                        else allEmptyGroups.push(...group.folderIds.map(id => ({ id, name: `Блок ${id}` })));
                    }
                }
            }

            if (createdLaunches.length > 0) {
                setSuccessMessage(createdLaunches.length === 1 ? `Запуск "${createdLaunches[0].name}" успешно создан!` : `Успешно создано ${createdLaunches.length} запусков!`);
                setAllureLink(createdLaunches[0].link);
                if (failedLaunches.length === 0) setShowSplitModal(false);
            }

            if (failedLaunches.length > 0) {
                setError(`Не удалось создать: ${failedLaunches.map(f => f.name).join(', ')}`);
            }

            if (allEmptyGroups.length > 0) {
                const uniqueEmptyGroups = Array.from(new Map(allEmptyGroups.map(item => [item.id, item])).values());
                setEmptyGroupsData(uniqueEmptyGroups);
                setShowEmptyGroupsModal(true);
            }
        } catch (err) {
            setError(`Ошибка при создании запусков: ${err.message}`);
        } finally {
            setLoadingState(prev => ({ ...prev, launch: false }));
        }
    }, [projectId, launchGroups, componentMappings]);

    /**
     * Создание заглушек для пустых групп
     */
    const handleCreateStubs = useCallback(async () => {
        setIsCreatingStubs(true);
        try {
            const issueKey = null;
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
            }
        } catch (err) {
            setError('Не удалось создать заглушки');
            logError('Stub creation error', err.message, config.TIAUrl);
        } finally {
            setIsCreatingStubs(false);
        }
    }, [projectId, emptyGroupsData, launchGroups, createMultipleLaunches]);

    /**
     * Обработка завершения перетаскивания (Drag & Drop)
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
    }, []);

    /**
     * Отмена маппинга
     */
    const handleMappingCancel = useCallback(() => {
        setShowMappingModal(false);
        setSelectedComponentId(null);
    }, []);

    /**
     * Частичное сохранение маппинга
     */
    const handlePartialSave = useCallback(async () => {
        if (!projectId) return;
        setIsPartialSaving(true);
        setPartialSaveMessage('Сохранение маппинга...');
        try {
            await axios.post(`${config.TIAUrl}/api/mapping/save`, {
                projectId,
                mappings: componentMappings
            });
            setSuccessMessage('Маппинг успешно сохранен');
        } catch (err) {
            setError('Ошибка при сохранении маппинга');
            logError('Partial save error', err.message, config.TIAUrl);
        } finally {
            setIsPartialSaving(false);
            setPartialSaveMessage('');
        }
    }, [projectId, componentMappings]);

    /**
     * Переключение блокировки наследования
     * @param {string} compId - ID компонента
     */
    const toggleInheritance = useCallback((compId) => {
        setDisabledInheritance(prev => ({
            ...prev,
            [compId]: !prev[compId]
        }));
    }, []);

    /**
     * Подтверждение маппинга и открытие Split Modal
     * @param {string} type - Тип действия
     */
    const handleMappingConfirm = useCallback(async (type = 'launch') => {
        if (type === 'split') {
            await createMultipleLaunches();
            return;
        }

        setIsMappingLoading(true);
        setLoadingState(prev => ({ ...prev, launch: true }));

        try {
            const allComponents = extractComponents(frontendJSON, backendJSON, tiaReport);
            const allPageDependencies = buildPageDependencies(allComponents, frontendJSON, backendJSON);

            const chunkSize = 5;
            for (let i = 0; i < allComponents.length; i += chunkSize) {
                const chunk = allComponents.slice(i, i + chunkSize);
                await Promise.all(chunk.map(component => {
                    const folderIds = componentMappings[component.id] || [];
                    return saveComponentMapping(component, folderIds, allComponents, allPageDependencies);
                }));
            }

            const allSelectedFolderIds = [];
            Object.values(componentMappings).forEach(ids => allSelectedFolderIds.push(...ids));
            const uniqueFolderIds = [...new Set(allSelectedFolderIds)];

            if (uniqueFolderIds.length === 0) {
                setError('Не выбрано ни одного функционального блока для запуска.');
                return;
            }

            const defaultName = `Регресс тестирование ${new Date().toLocaleDateString('ru-RU')}`;
            setUnassignedFolderIds(uniqueFolderIds.map(id => id.toString()));
            setLaunchGroups([{ id: 'launch-1', name: defaultName, folderIds: [], jiraLink: '' }]);
            setShowMappingModal(false);
            setShowSplitModal(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsMappingLoading(false);
            setLoadingState(prev => ({ ...prev, launch: false }));
        }
    }, [frontendJSON, backendJSON, tiaReport, componentMappings, saveComponentMapping, createMultipleLaunches]);

    /**
     * Удаление привязки компонента к блоку
     * @param {string} compId - ID компонента
     * @param {string} folderId - ID блока
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
    }, []);

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
        expandedScenarios,
        setExpandedScenarios,
        expandedCode,
        setExpandedCode,
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
        mode,
        setMode,
        hasStarted,
        setHasStarted,
        frontendFileName,
        setFrontendFileName,
        backendFileName,
        setBackendFileName,
        handleCreateStubs,
        createMultipleLaunches
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
