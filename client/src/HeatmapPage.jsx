import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, Label } from 'recharts';
import Select from 'react-select';
import { useNavigate } from 'react-router-dom'; // Added useNavigate
import config from './config.json';
import styles from './styles';

const COLORS = [
    '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d',
    '#ffc658', '#ff7300', '#8dd1e1', '#d084d0', '#ffb347', '#87ceeb',
    '#dda0dd', '#98d8c8', '#f7dc6f', '#bb8fce', '#85c1e2', '#f8c471',
    '#f1948a', '#85c1e9', '#f4d03f', '#a569bd', '#5dade2', '#f39c12',
    '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c', '#34495e',
];

const HeatmapPage = ({ projects }) => {
    const navigate = useNavigate(); // Hook for navigation
    const [projectId, setProjectId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedVersions, setSelectedVersions] = useState([]);
    const [side, setSide] = useState('frontend'); // 'frontend' or 'backend' (removed 'all')
    const [availableVersions, setAvailableVersions] = useState([]);
    const [isBugFix, setIsBugFix] = useState(null); // null - все, true - только баги, false - общий
    const [heatmapData, setHeatmapData] = useState(null);
    const [testCoverageData, setTestCoverageData] = useState(null);
    const [activeTab, setActiveTab] = useState('code'); // 'code' или 'test'
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [selectedComponent, setSelectedComponent] = useState(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importFiles, setImportFiles] = useState([]);
    const [importProcessing, setImportProcessing] = useState(false);
    const [importError, setImportError] = useState('');
    const [importLog, setImportLog] = useState([]);
    const [jiraPat, setJiraPat] = useState(localStorage.getItem('jiraPat') || '');
    const [issueTimeMap, setIssueTimeMap] = useState({});
    const [syncingJira, setSyncingJira] = useState(false);
    const [activeMetric, setActiveMetric] = useState('incidents'); // 'touches', 'incidents', 'time'

    // Для маппинга
    const [showMappingModal, setShowMappingModal] = useState(false);
    const [unmappedComponents, setUnmappedComponents] = useState([]);
    const [componentMappings, setComponentMappings] = useState({});
    const [folders, setFolders] = useState([]);
    const [folderNamesCache, setFolderNamesCache] = useState({}); // Кэш названий функц. блоков
    const [parsedHistoryItems, setParsedHistoryItems] = useState([]);

    // Состояния для подтверждения незамапленных
    const [showUnmappedConfirmation, setShowUnmappedConfirmation] = useState(false);
    const [unmappedList, setUnmappedList] = useState([]);

    // Состояния для нового UI маппинга (Split View)
    const [selectedComponentForMapping, setSelectedComponentForMapping] = useState(null);
    const [mappingFilter, setMappingFilter] = useState('');
    const [folderSearchTerm, setFolderSearchTerm] = useState('');
    const [expandedFolders, setExpandedFolders] = useState({});
    const [expandedComponentFolders, setExpandedComponentFolders] = useState({});
    const [expandedPageLists, setExpandedPageLists] = useState({});

    // Загрузка доступных версий при изменении проекта или дат
    useEffect(() => {
        if (projectId) {
            loadAvailableVersions();
        }
    }, [projectId, startDate, endDate]);

    // Загрузка данных тепловой карты при изменении фильтров
    useEffect(() => {
        if (projectId) {
            if (activeTab === 'code') {
                // Fetch both because Code Tab now includes Page Impact from testCoverageData
                loadHeatmapData();
                loadTestCoverageData();
            } else {
                loadTestCoverageData();
            }
        }
    }, [projectId, startDate, endDate, selectedVersions, isBugFix, activeTab, side]);

    // Синхронизация данных о времени из Jira
    useEffect(() => {
        const allKeys = new Set();
        if (heatmapData?.components) {
            heatmapData.components.forEach(c => c.issueKeys?.forEach(k => allKeys.add(k)));
        }
        if (testCoverageData?.functionalBlocks) {
            testCoverageData.functionalBlocks.forEach(fb => fb.issueKeys?.forEach(k => allKeys.add(k)));
        }
        if (testCoverageData?.pages) {
            testCoverageData.pages.forEach(p => p.issueKeys?.forEach(k => allKeys.add(k)));
        }

        const keysToFetch = Array.from(allKeys).filter(k => issueTimeMap[k] === undefined);
        if (keysToFetch.length > 0 && jiraPat) {
            fetchJiraTimeTracking(keysToFetch);
        }
    }, [heatmapData, testCoverageData, jiraPat]);

    // Загрузка структуры Allure при изменении проекта
    useEffect(() => {
        if (projectId) {
            fetchFolders();
        }
    }, [projectId]);


    const loadAvailableVersions = async () => {
        try {
            const params = new URLSearchParams({ projectId });
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);

            const response = await axios.get(`${config.TIAUrl}/api/heatmap/release-versions?${params}`);
            setAvailableVersions(response.data.versions || []);
        } catch (err) {
            console.error('Ошибка загрузки версий:', err);
        }
    };

    const fetchJiraTimeTracking = async (issueKeys) => {
        if (!jiraPat || !issueKeys.length) return;
        setSyncingJira(true);

        try {
            const chunkSize = 50;
            const newTimeMap = { ...issueTimeMap };

            for (let i = 0; i < issueKeys.length; i += chunkSize) {
                const chunk = issueKeys.slice(i, i + chunkSize);
                const jql = `key IN (${chunk.map(k => `"${k}"`).join(',')})`;

                const response = await axios.get(`${config.serverUrl}/jira/search`, {
                    params: {
                        pat: jiraPat,
                        jql,
                        fields: 'timetracking',
                        maxResults: chunk.length
                    }
                });

                if (response.data?.issues) {
                    response.data.issues.forEach(issue => {
                        newTimeMap[issue.key] = issue.fields?.timetracking?.timeSpentSeconds || 0;
                    });
                }
            }
            setIssueTimeMap(newTimeMap);
        } catch (err) {
            console.error('Ошибка при получении данных о времени из Jira:', err);
        } finally {
            setSyncingJira(false);
        }
    };

    const formatSeconds = (seconds) => {
        if (!seconds || seconds <= 0) return '0h';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    };

    const calculateTimeSpent = (issueKeys) => {
        if (!issueKeys || !issueKeys.length) return 0;
        return issueKeys.reduce((acc, key) => acc + (issueTimeMap[key] || 0), 0);
    };

    const loadHeatmapData = async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ projectId });
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (selectedVersions.length > 0) {
                selectedVersions.forEach(v => params.append('releaseVersions', v));
            }
            if (isBugFix !== null) {
                params.append('isBugFix', isBugFix.toString());
            }
            if (side !== 'all') {
                params.append('componentType', side);
            }

            const response = await axios.get(`${config.TIAUrl}/api/heatmap?${params}`);
            setHeatmapData(response.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка загрузки данных тепловой карты');
            console.error('Ошибка загрузки тепловой карты:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadTestCoverageData = async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ projectId });
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (selectedVersions.length > 0) {
                selectedVersions.forEach(v => params.append('releaseVersions', v));
            }
            if (isBugFix !== null) {
                params.append('isBugFix', isBugFix.toString());
            }
            if (side !== 'all') {
                params.append('componentType', side);
            }

            const response = await axios.get(`${config.TIAUrl}/api/heatmap/test-coverage?${params}`);
            setTestCoverageData(response.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Ошибка загрузки данных Test Coverage');
            console.error('Ошибка загрузки Test Coverage:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleVersionChange = (selectedOptions) => {
        setSelectedVersions(selectedOptions ? selectedOptions.map(opt => opt.value) : []);
    };

    // Глобальные агрегаты на основе загруженных данных и Jira-времени
    const stats = React.useMemo(() => {
        const currentData = activeTab === 'code' ? heatmapData : testCoverageData;
        if (!currentData) return { totalTouches: 0, totalIncidents: 0, totalTime: 0 };

        // Касания (общая сумма изменений)
        const totalTouches = currentData.totalDefects || 0;

        // Инциденты и Время (уникальные баги во всем представлении)
        const allKeys = new Set();
        if (activeTab === 'code' && currentData.components) {
            currentData.components.forEach(c => c.issueKeys?.forEach(k => allKeys.add(k)));
        } else if (activeTab === 'test' && currentData.functionalBlocks) {
            currentData.functionalBlocks.forEach(fb => fb.issueKeys?.forEach(k => allKeys.add(k)));
        }

        const totalIncidents = activeTab === 'code'
            ? (currentData.uniqueTotalIssuesCount || allKeys.size)
            : allKeys.size;

        const totalTime = Array.from(allKeys).reduce((acc, key) => acc + (issueTimeMap[key] || 0), 0);

        return { totalTouches, totalIncidents, totalTime };
    }, [heatmapData, testCoverageData, activeTab, issueTimeMap]);

    const versionOptions = availableVersions.map(v => ({ value: v, label: v }));

    // Загрузка функциональных блоков из БД для маппинга
    const fetchFolders = async () => {
        if (!projectId) return;
        setLoading(true); // Using existing loading state or structureLoading if preferred
        try {
            // Use /api/structure for tree view instead of flat list
            const response = await axios.get(`${config.TIAUrl}/api/structure`, {
                params: { projectId, skipCustomFieldIds: '-3' },
            });
            // /api/structure returns { folders: [...] }
            const folderList = response.data.folders || [];
            setFolders(folderList);

            // Populate folderNamesCache from structure
            const newNamesCache = {};
            const flatten = (items) => {
                items.forEach(item => {
                    newNamesCache[item.id.toString()] = item.customFieldName ? `${item.customFieldName} - ${item.name}` : item.name;
                    if (item.children) flatten(item.children);
                });
            };
            flatten(folderList);
            setFolderNamesCache(prev => ({ ...prev, ...newNamesCache }));
        } catch (err) {
            console.error('Ошибка при загрузке функциональных блоков:', err);
            setFolders([]);
        } finally {
            setLoading(false);
        }
    };

    const handleProcessFiles = async () => {
        if (importFiles.length === 0) return;

        setImportProcessing(true);
        setImportError('');
        setImportLog(['Начало обработки файлов...']);

        const allParsedItems = [];
        const uniqueComponentsSet = new Set();

        try {
            for (let i = 0; i < importFiles.length; i++) {
                const file = importFiles[i];
                const text = await file.text();
                const json = JSON.parse(text);

                // Извлекаем данные из нового формата JSON
                const item = {
                    change_date: json.change_date || json.merged_at,
                    is_bug_fix: json.is_bug_fix !== undefined ? json.is_bug_fix : true,
                    issue_key: json.issue_key || json.issue_bug,
                    mr_iid: json.mr_iid,
                    mr_title: json.mr_title,
                    source_branch: json.source_branch,
                    target_branch: json.target_branch,
                    merged_at: json.merged_at,
                    web_url: json.web_url,
                    release_version: json.project_version || json.release_version,
                    affected_components: [],
                    pages: json.pages || [], // Required for Page Statistics
                    component_details: {} // New: Store rich metadata
                };

                let componentsToProcess = [];
                const uniqueMap = json.unique_affected_components || {};

                if (json.unique_affected_components) {
                    componentsToProcess = Object.keys(json.unique_affected_components);
                } else if (json.global_risks && Array.isArray(json.global_risks)) {
                    // Поддержка формата с global_risks
                    componentsToProcess = json.global_risks
                        .map(risk => risk.source)
                        .filter(source => source);
                }

                componentsToProcess.forEach(compName => {
                    // Определяем тип компонента
                    let type = 'frontend'; // По умолчанию фронтенд
                    if (json.Controllers && json.Controllers[compName]) {
                        type = 'backend';
                    }

                    item.affected_components.push({ name: compName, type });
                    uniqueComponentsSet.add(compName);

                    // Собираем детали для компонента
                    const detail = uniqueMap[compName] || {};
                    item.component_details[compName] = {
                        risk: detail.risk_level || 'LOW',
                        file_path: detail.file_path || '',
                        change_source: detail.change_source || '',
                        type, // Сохраняем тип в деталях
                        pages_count: (json.pages || []).filter(p => (p.depends_on_components || []).includes(compName)).length,
                        pages: (json.pages || [])
                            .filter(p => (p.depends_on_components || []).includes(compName))
                            .map(p => p.page_meta?.name || 'Unknown')
                    };
                });

                allParsedItems.push(item);

                if (i % 20 === 0 || i === importFiles.length - 1) {
                    setImportLog(prev => [...prev, `Обработано ${i + 1} из ${importFiles.length} файлов...`]);
                }
            }

            setParsedHistoryItems(allParsedItems);

            // Теперь проверяем маппинги для всех найденных компонентов
            const componentNames = Array.from(uniqueComponentsSet);
            setImportLog(prev => [...prev, `Найдено ${componentNames.length} уникальных компонентов. Проверка маппингов...`]);

            // Запрашиваем существующие маппинги
            const mappingResponse = await axios.get(`${config.TIAUrl}/api/components?projectId=${projectId}`);
            const existingMappings = mappingResponse.data.mappings || [];

            const mappingsMap = {};
            const unmapped = [];
            const namesCache = {}; // Локальный кэш для этой партии

            componentNames.forEach(name => {
                const found = existingMappings.filter(m => m.component_name === name);
                if (found.length > 0) {
                    // Используем Set для того чтобы не дублировать ID
                    const blockIds = [...new Set(found.map(m => m.functional_block_id))];
                    mappingsMap[name] = blockIds;
                    // Кэшируем названия функциональных блоков
                    found.forEach(m => {
                        if (m.functional_block_id && m.functional_block_name) {
                            namesCache[m.functional_block_id] = m.functional_block_name;
                        }
                    });
                } else {
                    unmapped.push(name);
                }
            });

            setFolderNamesCache(prev => ({ ...prev, ...namesCache }));

            setComponentMappings(mappingsMap);
            setUnmappedComponents(unmapped);

            // Загружаем папки для маппинга
            await fetchFolders();

            setImportProcessing(false);
            setShowImportModal(false);
            setShowMappingModal(true);

        } catch (err) {
            console.error('Ошибка при парсинге файлов:', err);
            setImportError(`Ошибка: ${err.message}`);
            setImportProcessing(false);
        }
    };

    // --- Новая логика маппинга (Split View) ---

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

    // Форматирование customFieldName для отображения (для проекта 307 показываем Block/SubBlock вместо Feature)
    const formatCustomFieldName = (folder, level = 0) => {
        if (folder.customFieldName) {
            return `${folder.customFieldName} - ${folder.name}`;
        }
        return folder.name;
    };

    // Фильтрация папок для NoCode проектов (ID 1 и 307)
    const filterFoldersForProject = (folders, isRoot = true) => {
        const nocodeProjectIds = ['1', '307'];
        if (!nocodeProjectIds.includes(String(projectId))) {
            return folders;
        }

        const result = [];
        folders.forEach(folder => {
            const isBlockOrSubBlock = folder.customFieldName === 'Block' || folder.customFieldName === 'SubBlock';

            if (isRoot) {
                // На уровне корня показываем ТОЛЬКО Block и SubBlock
                if (isBlockOrSubBlock) {
                    const children = folder.children && folder.children.length > 0
                        ? filterFoldersForProject(folder.children, false) // Дальше не фильтруем корень
                        : [];
                    result.push({
                        ...folder,
                        children: children
                    });
                } else {
                    // Если это не Block/SubBlock на корне, заходим в его детей (вдруг блоки там?)
                    // Но по логике Allure - блоки обычно в корне. 
                    // Если пропустим узел, но заберем его детей - это "подъем" структуры.
                    if (folder.children && folder.children.length > 0) {
                        const children = filterFoldersForProject(folder.children, true); // Все еще ищем корень
                        result.push(...children);
                    }
                }
            } else {
                // Если мы уже ВНУТРИ блока - показываем всё без фильтрации типа
                const children = folder.children && folder.children.length > 0
                    ? filterFoldersForProject(folder.children, false)
                    : [];
                result.push({
                    ...folder,
                    children: children
                });
            }
        });
        return result;
    };

    // Рендер дерева фич для маппинга с возможностью выбора
    const renderFolderTreeForMapping = (folders, componentId, level = 0) => {
        if (!folders || folders.length === 0) {
            if (level === 0) {
                return <div style={{ color: '#6c757d', fontSize: '14px', padding: '20px', textAlign: 'center' }}>Нет доступных фич, измените параметры поиска</div>;
            }
            return null;
        }

        return folders.map((folder) => {
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
            const isFullSelected = allDescendantsSelected; // Полностью выбран
            // Частично выбран: не все выбраны, но есть выбранные потомки ИЛИ сам выбран но не дети
            const isPartiallySelected = !isFullSelected && (someDescendantsSelected || isDirectlySelected);

            const isSelected = isFullSelected || isDirectlySelected; // Для совместимости с предыдущим кодом стилей, но мы уточним цвета
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
                <div key={folder.id} style={{ marginBottom: '8px' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '8px 12px',
                            backgroundColor: bgColor,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                            marginLeft: `${level * 20}px`,
                            border: `2px solid ${borderColor}`,
                            ':hover': { backgroundColor: '#e9ecef' }
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!componentId) return;

                            // Single click: toggle ONLY current folder.id
                            if (isDirectlySelected) {
                                const newMappings = mappings.filter(id => id !== folderId);
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: newMappings
                                }));
                            } else {
                                // Add only self
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: [...mappings, folderId]
                                }));
                            }
                        }}
                        onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (!componentId) return;

                            // Double click: toggle ALL descendants
                            // Logic: If node AND all descendants are selected -> Deselect All. Otherwise -> Select All.

                            const allDescendantIds = getAllDescendantIds(folder); // Includes folder.id
                            const currentMappings = componentMappings[componentId] || [];

                            // Check if ALL are currently selected
                            const areAllSelected = allDescendantIds.every(id => currentMappings.includes(id));

                            if (areAllSelected) {
                                // Deselect all
                                const newMappings = currentMappings.filter(id => !allDescendantIds.includes(id));
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: newMappings
                                }));
                            } else {
                                // Select all
                                const newMappingsSet = new Set([...currentMappings, ...allDescendantIds]);
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: Array.from(newMappingsSet)
                                }));
                            }
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = isFullSelected ? '#c3e6cb' : isPartiallySelected ? '#ffeeba' : '#e9ecef';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = bgColor;
                        }}
                    >
                        {hasChildren && (
                            <div
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
                                    width: '32px', // Increased click area
                                    height: '32px', // Increased click area
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    flexShrink: 0
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                                {isExpanded ? '▼' : '►'}
                            </div>
                        )}
                        {!hasChildren && <span style={{ width: '32px', display: 'inline-block', flexShrink: 0 }} />}
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

    const buildComponentTree = (components) => {
        const root = { name: 'Root', children: {}, items: [] };
        components.forEach(name => {
            const parts = name.split('/');
            if (parts.length === 1) {
                root.items.push(name);
                return;
            }
            let current = root;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!current.children[part]) {
                    current.children[part] = { name: part, children: {}, items: [] };
                }
                current = current.children[part];
            }
            current.items.push(name);
        });
        return root;
    };

    const renderComponentItem = (compName, level = 0) => {
        const isSelected = selectedComponentForMapping === compName;
        const hasMapping = componentMappings[compName] && componentMappings[compName].length > 0;

        // Агрегируем детали по всем вхождениям компонента
        const details = parsedHistoryItems
            .filter(item => item.component_details && item.component_details[compName])
            .map(item => item.component_details[compName]);

        const maxRisk = details.some(d => d.risk === 'HIGH') ? 'HIGH' :
            details.some(d => d.risk === 'MEDIUM') ? 'MEDIUM' : 'LOW';
        const totalPages = details.reduce((sum, d) => sum + (d.pages_count || 0), 0);
        const firstFilePath = details.find(d => d.file_path)?.file_path || '';

        const riskColor = maxRisk === 'HIGH' ? '#dc3545' :
            maxRisk === 'MEDIUM' ? '#ffc107' : '#22c55e';
        const bgColor = isSelected ? '#eff6ff' : '#fff';

        return (
            <div
                key={compName}
                onClick={() => setSelectedComponentForMapping(compName)}
                style={{
                    padding: '12px',
                    marginBottom: '8px',
                    marginLeft: `${level * 16}px`,
                    borderRadius: '8px',
                    backgroundColor: bgColor,
                    border: isSelected ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    borderLeft: isSelected ? '4px solid #3b82f6' : '1px solid #e2e8f0',
                    boxShadow: isSelected ? '0 4px 6px -1px rgba(59, 130, 246, 0.1)' : 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b', wordBreak: 'break-all', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>{compName.split('/').pop()}</span>
                        {compName.includes('/') && (
                            <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 500 }}>
                                {compName.substring(0, compName.lastIndexOf('/'))}
                            </span>
                        )}
                    </div>
                    <div style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: riskColor,
                        color: '#fff',
                        fontSize: '9px',
                        fontWeight: 800,
                        marginLeft: '8px',
                        flexShrink: 0
                    }}>
                        {maxRisk}
                    </div>
                </div>

                {firstFilePath && (
                    <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '6px', fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.8 }}>
                        {firstFilePath.split('/').pop()}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: '10px', color: hasMapping ? '#22c55e' : '#dc3545', display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {hasMapping ? '✓ Связан' : '⚠️ Не связан'}
                            </div>
                            {hasMapping && (
                                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: 500, paddingLeft: '14px' }}>
                                    {(componentMappings[compName] || []).map(id => folderNamesCache[id] || id).join(', ')}
                                </div>
                            )}
                        </div>
                        {totalPages > 0 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedPageLists(prev => ({ ...prev, [compName]: !prev[compName] }));
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#3b82f6',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    padding: 0
                                }}
                            >
                                Pages: {totalPages} {expandedPageLists[compName] ? '▲' : '▼'}
                            </button>
                        )}
                    </div>

                    {expandedPageLists[compName] && (
                        <div style={{
                            marginTop: '8px',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '4px',
                            padding: '8px',
                            backgroundColor: '#f8fafc',
                            borderRadius: '6px',
                            border: '1px solid #e2e8f0',
                            maxHeight: '150px',
                            overflowY: 'auto'
                        }}>
                            {Array.from(new Set(details.flatMap(d => d.pages || []))).sort().map((pageName, pidx) => (
                                <span
                                    key={`${compName}-page-${pidx}`}
                                    style={{
                                        padding: '2px 6px',
                                        backgroundColor: '#e2e8f0',
                                        color: '#475569',
                                        borderRadius: '4px',
                                        fontSize: '9px',
                                        fontWeight: 600
                                    }}
                                >
                                    {pageName}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderComponentTree = (node, level = 0, path = '') => {
        const sortedChildren = Object.keys(node.children).sort();
        const sortedItems = node.items.sort();

        return (
            <div key={path || 'root'}>
                {sortedChildren.map(childName => {
                    const childPath = path ? `${path}/${childName}` : childName;
                    const isExpanded = expandedComponentFolders[childPath];
                    return (
                        <div key={childPath} style={{ marginBottom: '4px' }}>
                            <div
                                onClick={() => setExpandedComponentFolders(prev => ({ ...prev, [childPath]: !prev[childPath] }))}
                                style={{
                                    padding: '8px 12px',
                                    paddingLeft: `${level * 16 + 12}px`,
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    color: '#475569',
                                    backgroundColor: '#f1f5f9',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    userSelect: 'none',
                                    border: '1px solid #e2e8f0',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                            >
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>{isExpanded ? '▼' : '►'}</span>
                                <span style={{ fontSize: '14px' }}>📁</span>
                                {childName}
                            </div>
                            {isExpanded && (
                                <div style={{ marginTop: '4px' }}>
                                    {renderComponentTree(node.children[childName], level + 1, childPath)}
                                </div>
                            )}
                        </div>
                    );
                })}
                {sortedItems.map(compName => renderComponentItem(compName, level))}
            </div>
        );
    };

    const handleSaveBulkHistory = async (force = false) => {
        // Валидация незамапленных компонентов
        if (!force) {
            const allComponents = Array.from(new Set(parsedHistoryItems.flatMap(item =>
                item.affected_components.map(c => typeof c === 'string' ? c : c.name)
            )));
            const trulyUnmapped = allComponents.filter(name => !componentMappings[name] || componentMappings[name].length === 0);

            if (trulyUnmapped.length > 0) {
                setUnmappedList(trulyUnmapped.map(name => ({ name }))); // unmappedList expects objects with 'name' property for display
                setShowUnmappedConfirmation(true);
                return;
            }
        }

        setLoading(true);
        try {
            // Чтобы обойти ограничение Nginx 413 Payload Too Large, 
            // отправляем историю частями (чанками) по 100 записей.
            const chunkSize = 100;
            const totalItems = parsedHistoryItems.length;
            const chunksCount = Math.ceil(totalItems / chunkSize);

            console.log(`Начало импорта: ${totalItems} элементов, ${chunksCount} частей.`);

            for (let i = 0; i < chunksCount; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, totalItems);
                const chunk = parsedHistoryItems.slice(start, end);

                console.log(`Отправка части ${i + 1}/${chunksCount} (элементы ${start + 1}-${end})...`);

                await axios.post(`${config.TIAUrl}/api/heatmap/bulk-import`, {
                    projectId,
                    items: chunk,
                    mappings: componentMappings
                });
            }

            setShowMappingModal(false);
            alert(`История успешно импортирована (${totalItems} записей)!`);
            loadAvailableVersions();
            if (activeTab === 'code') {
                loadHeatmapData();
            } else {
                loadTestCoverageData();
            }
        } catch (err) {
            console.error('Ошибка при сохранении истории:', err);
            alert(`Ошибка при сохранении: ${err.response?.data?.error || err.message}`);
        } finally {
            setLoading(false);
        }
    };

    // Подготовка данных для графика (топ компонентов)
    const chartData = heatmapData?.components?.slice(0, 30).map((item, index) => ({
        name: item.componentName,
        value: item.count,
        percentage: parseFloat(item.percentage),
        color: COLORS[index % COLORS.length],
    })) || [];

    // Остальные компоненты (если больше 30)
    const otherComponents = heatmapData?.components?.slice(30) || [];
    const otherCount = otherComponents.reduce((sum, item) => sum + item.count, 0);
    const otherPercentage = heatmapData?.totalDefects > 0
        ? ((otherCount / heatmapData.totalDefects) * 100).toFixed(1)
        : '0.0';

    if (otherCount > 0) {
        chartData.push({
            name: 'Прочие',
            value: otherCount,
            percentage: parseFloat(otherPercentage),
            color: '#cccccc',
        });
    }

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div style={{
                    backgroundColor: '#fff',
                    padding: '12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                }}>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>{data.name}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                            Инциденты: <strong style={{ color: '#0f172a' }}>{data.uniqueIncidentCount || 0}</strong>
                        </p>
                        <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                            Касания: <strong style={{ color: '#0f172a' }}>{data.defectCount || data.value}</strong>
                        </p>
                        {calculateTimeSpent(data.issueKeys) > 0 && (
                            <p style={{ margin: 0, fontSize: '12px', color: '#6366f1' }}>
                                ⏱ Время: <strong>{formatSeconds(calculateTimeSpent(data.issueKeys))}</strong>
                            </p>
                        )}
                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', fontWeight: 700, color: '#3b82f6' }}>
                            Доля: {data.percentage}%
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    const MetricToggle = () => (
        <div style={{
            display: 'flex',
            backgroundColor: '#f1f5f9',
            padding: '4px',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            width: 'fit-content'
        }}>
            {[
                { id: 'incidents', label: 'Инциденты' },
                { id: 'touches', label: 'Касания' },
                { id: 'time', label: 'Время' }
            ].map(m => (
                <button
                    key={m.id}
                    onClick={() => setActiveMetric(m.id)}
                    style={{
                        padding: '8px 16px',
                        border: 'none',
                        borderRadius: '8px',
                        backgroundColor: activeMetric === m.id ? '#fff' : 'transparent',
                        color: activeMetric === m.id ? '#0f172a' : '#64748b',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: activeMetric === m.id ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                    }}
                >
                    {m.label}
                </button>
            ))}
        </div>
    );

    const getMetricValue = (item) => {
        if (activeMetric === 'touches') return item.count || item.defectCount || 0;
        if (activeMetric === 'incidents') return item.uniqueIncidentCount || 0;
        if (activeMetric === 'time') return calculateTimeSpent(item.issueKeys);
        return 0;
    };

    const getTotalMetricValue = (items) => {
        if (!items) return 0;
        if (activeMetric === 'time' || activeMetric === 'incidents') {
            const allKeys = new Set();
            items.forEach(item => {
                if (item.issueKeys) item.issueKeys.forEach(k => allKeys.add(k));
            });
            return activeMetric === 'time' ? calculateTimeSpent(Array.from(allKeys)) : allKeys.size;
        }
        return items.reduce((sum, i) => sum + getMetricValue(i), 0);
    };

    const calculatePriorityScore = (fb) => {
        const incidents = fb.uniqueIncidentCount || 0;
        const timeSpent = calculateTimeSpent(fb.issueKeys) / 3600; // hours

        // Веса: 60% инциденты, 40% время. Ранг до 100.
        // Для приоритизации: 1 инцидент ~ 2 часа времени.
        const score = (incidents * 15) + (timeSpent * 7);
        return Math.min(score, 100);
    };

    // Подготовка данных для Pareto (Топ-15 + Прочие)
    const prepareParetoData = (items, totalValue) => {
        if (!items) return [];
        const sorted = [...items].sort((a, b) => getMetricValue(b) - getMetricValue(a));
        const top = sorted.slice(0, 15);
        const others = sorted.slice(15);

        const result = top.map((item, index) => ({
            name: item.componentName || item.pageName || item.functionalBlockName,
            value: getMetricValue(item),
            defectCount: item.count || item.defectCount,
            uniqueIncidentCount: item.uniqueIncidentCount,
            percentage: totalValue > 0 ? ((getMetricValue(item) / totalValue) * 100).toFixed(1) : 0,
            issueKeys: item.issueKeys,
            url: item.url,
            color: COLORS[index % COLORS.length]
        }));

        if (others.length > 0) {
            let othersValue = 0;
            const othersKeys = new Set();
            others.forEach(i => i.issueKeys?.forEach(k => othersKeys.add(k)));

            if (activeMetric === 'time') {
                othersValue = calculateTimeSpent(Array.from(othersKeys));
            } else if (activeMetric === 'incidents') {
                othersValue = othersKeys.size;
            } else {
                othersValue = others.reduce((sum, i) => sum + getMetricValue(i), 0);
            }

            const othersDefects = others.reduce((sum, i) => sum + (i.count || i.defectCount || 0), 0);
            result.push({
                name: 'Прочие',
                value: othersValue,
                defectCount: othersDefects,
                uniqueIncidentCount: othersKeys.size,
                percentage: totalValue > 0 ? ((othersValue / totalValue) * 100).toFixed(1) : 0,
                color: '#94a3b8'
            });
        }
        return result;
    };


    const codeChartData = prepareParetoData(heatmapData?.components, getTotalMetricValue(heatmapData?.components));
    const pagesChartData = prepareParetoData(testCoverageData?.pages, getTotalMetricValue(testCoverageData?.pages));
    const fbChartData = prepareParetoData(testCoverageData?.functionalBlocks, getTotalMetricValue(testCoverageData?.functionalBlocks));

    return (
        <div style={{
            padding: '40px',
            maxWidth: '1440px',
            margin: '0 auto',
            fontFamily: '"Inter", "Outfit", "Roboto", sans-serif',
            color: '#1e293b',
            backgroundColor: '#f8fafc',
            minHeight: '100vh'
        }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '40px'
            }}>
                <h1 style={styles.title}>
                    Тепловая карта дефектов
                </h1>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            padding: '0 20px',
                            height: '52px',
                            backgroundColor: '#fff',
                            color: '#64748b',
                            border: '1px solid #e2e8f0',
                            borderRadius: '14px',
                            fontWeight: 600,
                            fontSize: '15px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.borderColor = '#cbd5e1', e.currentTarget.style.color = '#334155')}
                        onMouseOut={(e) => (e.currentTarget.style.borderColor = '#e2e8f0', e.currentTarget.style.color = '#64748b')}
                    >
                        Назад
                    </button>
                    <button
                        onClick={() => setShowImportModal(true)}
                        disabled={!projectId}
                        style={{
                            padding: '0 28px',
                            height: '52px',
                            backgroundColor: '#6366f1',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '14px',
                            fontWeight: 600,
                            fontSize: '15px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
                            opacity: !projectId ? 0.5 : 1,
                        }}
                        onMouseOver={(e) => !projectId ? null : (e.currentTarget.style.backgroundColor = '#4f46e5', e.currentTarget.style.transform = 'translateY(-2px)')}
                        onMouseOut={(e) => !projectId ? null : (e.currentTarget.style.backgroundColor = '#6366f1', e.currentTarget.style.transform = 'translateY(0)')}
                    >
                        Импорт истории TIA
                    </button>
                </div>
            </div>

            {/* Современные вкладки */}
            <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '32px',
                backgroundColor: '#f1f5f9',
                padding: '6px',
                borderRadius: '16px',
                width: 'fit-content',
                border: '1px solid #e2e8f0'
            }}>
                <button
                    onClick={() => setActiveTab('code')}
                    style={{
                        padding: '12px 28px',
                        border: 'none',
                        borderRadius: '12px',
                        backgroundColor: activeTab === 'code' ? '#fff' : 'transparent',
                        color: activeTab === 'code' ? '#0f172a' : '#64748b',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: activeTab === 'code' ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
                    }}
                >
                    Code Coverage
                </button>
                <button
                    onClick={() => setActiveTab('test')}
                    style={{
                        padding: '12px 28px',
                        border: 'none',
                        borderRadius: '12px',
                        backgroundColor: activeTab === 'test' ? '#fff' : 'transparent',
                        color: activeTab === 'test' ? '#0f172a' : '#64748b',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: activeTab === 'test' ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
                    }}
                >
                    Test Coverage
                </button>
            </div>

            {/* Фильтры и действия */}
            {/* Контейнер фильтров */}
            <div style={{
                backgroundColor: '#fff',
                padding: '32px',
                borderRadius: '24px',
                marginBottom: '40px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 24px rgba(0,0,0,0.02)',
            }}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                    gap: '24px',
                    alignItems: 'end'
                }}>
                    {/* Поле Проекта */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Целевой проект
                        </span>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0 20px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '14px',
                                fontSize: '15px',
                                backgroundColor: '#fcfdfe',
                                color: '#1e293b',
                                height: '52px',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                outline: 'none',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = '#6366f1', e.target.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)')}
                            onBlur={(e) => (e.target.style.borderColor = '#e2e8f0', e.target.style.boxShadow = 'none')}
                        >
                            <option value="">Проект</option>
                            {projects?.map(project => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Поле Периода */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Период данных
                        </span>
                        <div style={{
                            display: 'flex',
                            backgroundColor: '#fcfdfe',
                            border: '1px solid #e2e8f0',
                            borderRadius: '14px',
                            height: '52px',
                            overflow: 'hidden',
                            transition: 'all 0.2s ease'
                        }}>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '14px', color: '#1e293b', padding: '0 16px', outline: 'none' }}
                            />
                            <div style={{ width: '1px', height: '24px', backgroundColor: '#e2e8f0', alignSelf: 'center' }} />
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '14px', color: '#1e293b', padding: '0 16px', outline: 'none' }}
                            />
                        </div>
                    </div>

                    {/* Поле Релизов */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Версии продукта
                        </span>
                        <Select
                            isMulti
                            options={versionOptions}
                            value={selectedVersions.map(v => ({ value: v, label: v }))}
                            onChange={handleVersionChange}
                            placeholder="Любые версии"
                            isClearable
                            styles={{
                                control: (base, state) => ({
                                    ...base,
                                    borderColor: state.isFocused ? '#6366f1' : '#e2e8f0',
                                    borderRadius: '14px',
                                    fontSize: '14px',
                                    minHeight: '52px',
                                    backgroundColor: '#fcfdfe',
                                    boxShadow: state.isFocused ? '0 0 0 4px rgba(99, 102, 241, 0.1)' : 'none',
                                    '&:hover': { borderColor: state.isFocused ? '#6366f1' : '#cbd5e1' }
                                }),
                                multiValue: (base) => ({
                                    ...base,
                                    backgroundColor: '#eff6ff',
                                    borderRadius: '10px',
                                    padding: '2px 8px',
                                    border: '1px solid #dbeafe'
                                }),
                                multiValueLabel: (base) => ({ ...base, color: '#1e3a8a', fontWeight: 600 }),
                                placeholder: (base) => ({ ...base, color: '#94a3b8' })
                            }}
                        />
                    </div>

                    {/* Поле Типа */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Категория изменений
                        </span>
                        <select
                            value={isBugFix === null ? 'all' : isBugFix ? 'bugs' : 'general'}
                            onChange={(e) => {
                                const value = e.target.value;
                                setIsBugFix(value === 'all' ? null : value === 'bugs');
                            }}
                            style={{
                                width: '100%',
                                padding: '0 20px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '14px',
                                fontSize: '15px',
                                fontWeight: 500,
                                color: '#0f172a',
                                backgroundColor: '#fcfdfe',
                                height: '52px',
                                outline: 'none',
                                transition: 'all 0.2s ease',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = '#6366f1', e.target.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)')}
                            onBlur={(e) => (e.target.style.borderColor = '#e2e8f0', e.target.style.boxShadow = 'none')}
                        >
                            <option value="all">Все</option>
                            <option value="bugs">Только исправления багов</option>
                            <option value="general">Только новые функции</option>
                        </select>
                    </div>

                    {/* Поле Стороны (Front/Back) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Сторона системы
                        </span>
                        <select
                            value={side}
                            onChange={(e) => setSide(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0 20px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '14px',
                                fontSize: '15px',
                                fontWeight: 500,
                                color: '#0f172a',
                                backgroundColor: '#fcfdfe',
                                height: '52px',
                                outline: 'none',
                                transition: 'all 0.2s ease',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = '#6366f1', e.target.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)')}
                            onBlur={(e) => (e.target.style.borderColor = '#e2e8f0', e.target.style.boxShadow = 'none')}
                        >
                            <option value="frontend">Frontend</option>
                            <option value="backend">Backend</option>
                        </select>
                    </div>

                    {/* Поле Jira PAT */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Jira PAT
                            </span>
                            {syncingJira && (
                                <span style={{ fontSize: '10px', color: '#6366f1', fontWeight: 700, animation: 'pulse 1.5s infinite' }}>
                                    СИНХРОНИЗАЦИЯ...
                                </span>
                            )}
                        </div>
                        <input
                            type="password"
                            value={jiraPat}
                            placeholder="Введите Jira PAT для загрузки времени"
                            onChange={(e) => {
                                setJiraPat(e.target.value);
                                localStorage.setItem('jiraPat', e.target.value);
                            }}
                            style={{
                                width: '100%',
                                padding: '0 20px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '14px',
                                fontSize: '14px',
                                backgroundColor: '#fcfdfe',
                                color: '#1e293b',
                                height: '52px',
                                transition: 'all 0.2s ease',
                                outline: 'none',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = '#6366f1', e.target.style.boxShadow = '0 0 0 4px rgba(99, 102, 241, 0.1)')}
                            onBlur={(e) => (e.target.style.borderColor = '#e2e8f0', e.target.style.boxShadow = 'none')}
                        />
                    </div>
                </div>
            </div>

            {/* График и легенда */}
            {loading && (
                <div style={{ textAlign: 'center', padding: '100px', color: '#64748b' }}>
                    <div style={{ width: '40px', height: '40px', border: '3px solid #f1f5f9', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                    <div style={{ fontWeight: 600 }}>Загрузка данных...</div>
                </div>
            )}

            {error && (
                <div style={{
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fee2e2',
                    borderRadius: '16px',
                    padding: '24px',
                    marginBottom: '32px',
                    color: '#dc2626',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <span style={{ fontSize: '20px' }}>⚠️</span>
                    <div>
                        <div style={{ fontWeight: 700, marginBottom: '2px' }}>Ошибка загрузки</div>
                        <div style={{ fontSize: '14px', opacity: 0.8 }}>{error}</div>
                    </div>
                </div>
            )}

            {!loading && !error && (activeTab === 'code' ? heatmapData : testCoverageData) && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: '20px',
                    marginBottom: '40px'
                }}>
                    {[
                        { label: 'Касания', value: stats.totalTouches, sub: 'Объем изменений - количество изменений в коде', color: '#6366f1', description: 'Сколько раз трогали данную компоненту в коде' },
                        { label: 'Инциденты', value: stats.totalIncidents, sub: 'Уникальные баги - количество задач "Ошибка кода"', color: '#f43f5e', description: 'Крит. зоны для QA. Где чаще ломается — там нужнее автотесты.' },
                        { label: 'Время', value: formatSeconds(stats.totalTime), sub: 'Стоимость правок - время потраченное на тип задачи "Ошибка кода"', color: '#8b5cf6', description: 'Оценка выгоды от автоматизации регрессии этих блоков.' }
                    ].map((stat, i) => (
                        <div key={i} style={{
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            padding: '20px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                            borderLeft: `4px solid ${stat.color}`
                        }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>{stat.label}</div>
                            <div style={{ fontSize: '28px', fontWeight: 800, color: stat.color, marginBottom: '4px' }}>{stat.value}</div>
                            <div style={{ fontSize: '12px', color: '#475569', fontWeight: 500, marginBottom: '12px' }}>{stat.sub}</div>
                            <div style={{
                                fontSize: '11px',
                                color: '#64748b',
                                lineHeight: '1.4',
                                padding: '10px',
                                backgroundColor: '#f8fafc',
                                borderRadius: '8px'
                            }}>
                                <strong>Для автотестов:</strong> {stat.description}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!loading && !error && activeTab === 'code' && heatmapData && (
                <div style={{
                    backgroundColor: '#fff',
                    padding: '32px',
                    borderRadius: '24px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                    marginBottom: '40px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <h2 style={styles.subHeader}>
                                Импакт-анализ компонентов
                            </h2>
                            <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>
                                Распределение влияния по программным элементам
                            </p>
                        </div>
                        <MetricToggle />
                    </div>


                    <div style={{ height: '400px', width: '100%', marginBottom: '32px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={codeChartData}
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                            >
                                <XAxis type="number" hide />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={150}
                                    fontSize={11}
                                    tick={{ fill: '#475569', fontWeight: 600 }}
                                    tickFormatter={(value) => value.length > 20 ? value.substring(0, 18) + '...' : value}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                <Bar
                                    dataKey="value"
                                    radius={[0, 4, 4, 0]}
                                    onClick={(data) => setSelectedComponent(data.name)}
                                >
                                    {codeChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.color}
                                            style={{ cursor: 'pointer', filter: selectedComponent === entry.name ? 'brightness(0.9) contrast(1.2)' : 'none' }}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                        gap: '12px'
                    }}>
                        {codeChartData.map((item, index) => (
                            <div
                                key={item.name}
                                onClick={() => setSelectedComponent(item.name)}
                                style={{
                                    padding: '12px 16px',
                                    borderRadius: '12px',
                                    border: `1px solid ${selectedComponent === item.name ? '#6366f1' : '#f1f5f9'}`,
                                    backgroundColor: selectedComponent === item.name ? '#f8faff' : '#fff',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px',
                                    boxShadow: selectedComponent === item.name ? '0 4px 12px rgba(99, 102, 241, 0.08)' : 'none'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: item.color, flexShrink: 0 }} />
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {item.name}
                                    </span>
                                </div>
                                <div style={{ fontSize: '11px', color: '#64748b', paddingLeft: '16px' }}>
                                    {activeMetric === 'time' ? formatSeconds(item.value) : item.value} ({item.percentage}%)
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Статистика по Страницам (Перенесено в блок Code Coverage) */}
            {
                !loading && !error && activeTab === 'code' && testCoverageData?.pages && testCoverageData.pages.length > 0 && (
                    <div style={{
                        backgroundColor: '#fff',
                        padding: '32px',
                        borderRadius: '24px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                        marginBottom: '40px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <h2 style={styles.subHeader}>
                                    Влияние на страницы (Импакт)
                                </h2>
                                <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>
                                    Распределение связей между компонентами и страницами приложения
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
                            {/* Pie Chart on the Left (40%) */}
                            <div style={{ flex: '0 0 400px', height: '400px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{
                                    position: 'absolute',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    zIndex: 1,
                                    pointerEvents: 'none'
                                }}>
                                    <span style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', lineHeight: 1.2 }}>ПЛОТНОСТЬ</span>
                                    <span style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', lineHeight: 1.2 }}>МАППИНГА</span>
                                </div>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pagesChartData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={80}
                                            outerRadius={120}
                                            paddingAngle={0}
                                            stroke="none"
                                            dataKey="value"
                                        >
                                            {pagesChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Cards on the Right (60%) */}
                            <div style={{
                                flex: 1,
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: '12px',
                                maxHeight: '450px',
                                overflowY: 'auto',
                                paddingRight: '8px'
                            }}>
                                {pagesChartData.map((item, index) => (
                                    <div
                                        key={item.name}
                                        style={{
                                            padding: '16px',
                                            borderRadius: '16px',
                                            border: '1px solid #f1f5f9',
                                            backgroundColor: '#fff',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px',
                                            transition: 'all 0.2s',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                                            position: 'relative',
                                            paddingLeft: '32px'
                                        }}
                                    >
                                        <div style={{
                                            position: 'absolute',
                                            left: '12px',
                                            top: '20px',
                                            width: '10px',
                                            height: '10px',
                                            borderRadius: '50%',
                                            backgroundColor: item.color
                                        }} />

                                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.name}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#6366f1', fontWeight: 600 }}>
                                            {activeMetric === 'time' && <span>⏱</span>}
                                            {activeMetric === 'time' ? formatSeconds(item.value) : item.value}
                                            <span style={{ color: '#94a3b8', fontWeight: 400 }}>({item.percentage}%)</span>
                                        </div>

                                        {item.url && (
                                            <div style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {item.url}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>
                )}

            {/* Test Coverage визуализация */}
            {
                activeTab === 'test' && !loading && !error && testCoverageData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                        {/* Приоритезация функциональных блоков */}
                        <div style={{
                            backgroundColor: '#fff',
                            padding: '32px',
                            borderRadius: '24px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <h2 style={styles.subHeader}>
                                        Приоритезация функциональных блоков
                                    </h2>
                                    <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>
                                        Ранжирование по приоритету (Инциденты + Время)
                                    </p>
                                </div>
                                <MetricToggle />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                                {/* Pareto Chart for FB - Now Full Width like Code Coverage */}
                                <div style={{ height: '400px', width: '100%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart
                                            data={fbChartData}
                                            layout="vertical"
                                            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                                        >
                                            <XAxis type="number" hide />
                                            <YAxis
                                                type="category"
                                                dataKey="name"
                                                width={180}
                                                fontSize={11}
                                                tick={{ fill: '#475569', fontWeight: 600 }}
                                                tickFormatter={(value) => value.length > 25 ? value.substring(0, 23) + '...' : value}
                                            />
                                            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
                                            <Bar
                                                dataKey="value"
                                                radius={[0, 4, 4, 0]}
                                            >
                                                {fbChartData.map((entry, index) => (
                                                    <Cell key={`cell-fb-${index}`} fill={entry.color} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* Priority List - Now as a Grid of Cards like Code Coverage */}
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                    gap: '12px'
                                }}>
                                    {[...(testCoverageData?.functionalBlocks || [])]
                                        .map(fb => ({ ...fb, priorityScore: calculatePriorityScore(fb) }))
                                        .sort((a, b) => b.priorityScore - a.priorityScore)
                                        .slice(0, 20)
                                        .map((fb, idx) => {
                                            const entryColor = fbChartData.find(p => p.name === fb.functionalBlockName)?.color || '#94a3b8';
                                            const totalMetric = getTotalMetricValue(testCoverageData?.functionalBlocks);
                                            const percentage = totalMetric > 0
                                                ? (activeMetric === 'time'
                                                    ? (calculateTimeSpent(fb.issueKeys) / totalMetric * 100)
                                                    : (activeMetric === 'touches' ? fb.defectCount : fb.uniqueIncidentCount) / totalMetric * 100
                                                ).toFixed(1)
                                                : '0.0';
                                            const value = activeMetric === 'time' ? calculateTimeSpent(fb.issueKeys) : (activeMetric === 'touches' ? fb.defectCount : fb.uniqueIncidentCount);

                                            return (
                                                <div
                                                    key={fb.functionalBlockId}
                                                    onClick={() => setSelectedComponent(fb.functionalBlockName)}
                                                    style={{
                                                        padding: '12px 16px',
                                                        borderRadius: '12px',
                                                        border: `1px solid ${selectedComponent === fb.functionalBlockName ? '#6366f1' : '#f1f5f9'}`,
                                                        backgroundColor: selectedComponent === fb.functionalBlockName ? '#f8faff' : '#fff',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '2px',
                                                        transition: 'all 0.2s',
                                                        cursor: 'pointer',
                                                        boxShadow: selectedComponent === fb.functionalBlockName ? '0 4px 12px rgba(99, 102, 241, 0.08)' : 'none'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: entryColor, flexShrink: 0 }} />
                                                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {fb.functionalBlockName}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: '#64748b', paddingLeft: '16px' }}>
                                                        {activeMetric === 'time' ? formatSeconds(value) : value} ({percentage}%)
                                                        <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '10px' }}>Priority: {fb.priorityScore.toFixed(0)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            {/* Модальное окно массового импорта */}
            {showImportModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.4)',
                    backdropFilter: 'blur(8px)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 2000,
                    animation: 'fadeIn 0.2s ease-out',
                }}>
                    <div style={{
                        backgroundColor: '#fff',
                        width: '600px',
                        borderRadius: '24px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        overflow: 'hidden',
                        fontFamily: '"Inter", sans-serif'
                    }}>
                        <div style={{
                            padding: '24px 32px',
                            borderBottom: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: '#fcfdfe'
                        }}>
                            <h2 style={styles.subHeader}>Загрузка истории TIA</h2>
                            <button
                                onClick={() => setShowImportModal(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '24px',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'color 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.color = '#475569'}
                                onMouseOut={(e) => e.currentTarget.style.color = '#94a3b8'}
                            >х</button>
                        </div>

                        <div style={{ padding: '32px' }}>
                            <p style={{ marginBottom: '24px', color: '#64748b', fontSize: '14px', lineHeight: '1.6' }}>
                                Выберите файлы отчетов в формате JSON для массового импорта истории дефектов и привязки их к текущему проекту.
                            </p>

                            <div style={{
                                position: 'relative',
                                marginBottom: '24px',
                                border: '2px dashed #e2e8f0',
                                borderRadius: '16px',
                                padding: '40px 20px',
                                textAlign: 'center',
                                transition: 'all 0.2s ease',
                                backgroundColor: '#f8fafc',
                                cursor: 'pointer'
                            }}
                                onMouseOver={(e) => (e.currentTarget.style.borderColor = '#6366f1', e.currentTarget.style.backgroundColor = '#f1f5f9')}
                                onMouseOut={(e) => (e.currentTarget.style.borderColor = '#e2e8f0', e.currentTarget.style.backgroundColor = '#f8fafc')}
                            >
                                <input
                                    type="file"
                                    multiple
                                    accept=".json"
                                    onChange={(e) => setImportFiles(Array.from(e.target.files))}
                                    style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        width: '100%',
                                        height: '100%',
                                        opacity: 0,
                                        cursor: 'pointer'
                                    }}
                                />

                                <div style={{ fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
                                    {importFiles.length > 0 ? `Выбрано файлов: ${importFiles.length}` : 'Нажмите для выбора JSON файлов'}
                                </div>
                                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Перетащите файлы сюда или кликните для обзора</div>
                            </div>

                            {importProcessing && (
                                <div style={{
                                    padding: '20px',
                                    backgroundColor: '#0f172a',
                                    borderRadius: '12px',
                                    maxHeight: '180px',
                                    overflowY: 'auto',
                                    marginBottom: '24px',
                                    fontSize: '13px',
                                    fontFamily: '"SF Mono", "Fira Code", monospace',
                                    color: '#38bdf8',
                                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
                                }}>
                                    {importLog.map((log, i) => (
                                        <div key={i} style={{ marginBottom: '4px', opacity: i === importLog.length - 1 ? 1 : 0.7 }}>
                                            <span style={{ color: '#64748b' }}>[{new Date().toLocaleTimeString()}]</span> {log}
                                        </div>
                                    ))}
                                    <div id="import-log-end" />
                                </div>
                            )}

                            {importError && (
                                <div style={{
                                    padding: '16px',
                                    backgroundColor: '#fef2f2',
                                    border: '1px solid #fee2e2',
                                    borderRadius: '12px',
                                    color: '#dc2626',
                                    fontSize: '14px',
                                    marginBottom: '24px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px'
                                }}>
                                    <span>⚠️</span> {importError}
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button
                                    onClick={() => setShowImportModal(false)}
                                    style={{
                                        padding: '0 24px',
                                        height: '48px',
                                        backgroundColor: '#fff',
                                        color: '#64748b',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '12px',
                                        fontWeight: 600,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc', e.currentTarget.style.borderColor = '#cbd5e1')}
                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#fff', e.currentTarget.style.borderColor = '#e2e8f0')}
                                    disabled={importProcessing}
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={handleProcessFiles}
                                    disabled={importFiles.length === 0 || importProcessing}
                                    style={{
                                        padding: '0 24px',
                                        height: '48px',
                                        backgroundColor: '#6366f1',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '12px',
                                        fontWeight: 700,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
                                        transition: 'all 0.2s',
                                        opacity: (importFiles.length === 0 || importProcessing) ? 0.6 : 1
                                    }}
                                    onMouseOver={(e) => (importFiles.length > 0 && !importProcessing) && (e.currentTarget.style.backgroundColor = '#4f46e5', e.currentTarget.style.transform = 'translateY(-1px)')}
                                    onMouseOut={(e) => (importFiles.length > 0 && !importProcessing) && (e.currentTarget.style.backgroundColor = '#6366f1', e.currentTarget.style.transform = 'translateY(0)')}
                                >
                                    {importProcessing ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                                            Обработка...
                                        </span>
                                    ) : 'Начать импорт'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )
            }

            {/* Модальное окно маппинга для импорта */}
            {
                showMappingModal && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(15, 23, 42, 0.4)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 2000,
                        animation: 'fadeIn 0.2s ease-out',
                    }}>
                        <div style={{
                            backgroundColor: '#fff',
                            width: '1200px',
                            maxWidth: '95vw',
                            height: '90vh',
                            borderRadius: '24px',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            fontFamily: '"Inter", sans-serif'
                        }}>
                            <div style={{
                                padding: '24px 32px',
                                borderBottom: '1px solid #e2e8f0',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                background: '#fcfdfe'
                            }}>
                                <div>
                                    <h2 style={styles.subHeader}>Маппинг компонентов</h2>
                                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Свяжите компоненты из отчета с функциональными блоками Allure</div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <button
                                        onClick={() => setShowMappingModal(false)}
                                        style={{
                                            padding: '0 20px',
                                            height: '40px',
                                            backgroundColor: '#fff',
                                            color: '#64748b',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '10px',
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}
                                        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc', e.currentTarget.style.borderColor = '#cbd5e1')}
                                        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#fff', e.currentTarget.style.borderColor = '#e2e8f0')}
                                    >
                                        Назад к выбору файлов
                                    </button>

                                    <button
                                        onClick={() => setShowMappingModal(false)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            fontSize: '24px',
                                            color: '#94a3b8',
                                            cursor: 'pointer',
                                            padding: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'color 0.2s'
                                        }}
                                        onMouseOver={(e) => e.currentTarget.style.color = '#475569'}
                                        onMouseOut={(e) => e.currentTarget.style.color = '#94a3b8'}
                                    >×</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                                {/* Левая панель: Список компонентов */}
                                <div style={{
                                    width: '350px',
                                    borderRight: '1px solid #e2e8f0',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    backgroundColor: '#f8fafc'
                                }}>
                                    <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0' }}>
                                        <input
                                            type="text"
                                            placeholder="Поиск компонента..."
                                            value={mappingFilter}
                                            onChange={(e) => setMappingFilter(e.target.value)}
                                            style={{
                                                width: '100%',
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                border: '1px solid #cbd5e1',
                                                fontSize: '14px',
                                                outline: 'none',
                                                backgroundColor: '#fff',
                                                color: '#0f172a'
                                            }}
                                        />
                                    </div>
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                                        {renderComponentTree(
                                            buildComponentTree(
                                                Array.from(new Set(parsedHistoryItems.flatMap(item =>
                                                    item.affected_components.map(c => typeof c === 'string' ? c : c.name)
                                                )))
                                                    .sort()
                                                    .filter(name => name.toLowerCase().includes(mappingFilter.toLowerCase()))
                                            )
                                        )}
                                    </div>
                                </div>

                                {/* Правая панель: Дерево маппинга */}
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fff' }}>
                                    <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff' }}>
                                        <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                                                {selectedComponentForMapping ? `Маппинг для: ${selectedComponentForMapping}` : 'Выберите компонент слева'}
                                            </h3>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {selectedComponentForMapping && (
                                                    <div style={{ fontSize: '13px', color: '#64748b' }}>
                                                        {componentMappings[selectedComponentForMapping]?.length || 0} привязано
                                                    </div>
                                                )}
                                                <div
                                                    title="Подсказка по маппингу:&#10;• Один клик — выбрать/убрать текущий элемент&#10;• Двойной клик — выбрать/убрать элемент со всеми вложенными"
                                                    style={{
                                                        cursor: 'help',
                                                        fontSize: '16px',
                                                        backgroundColor: '#f8fafc',
                                                        width: '28px',
                                                        height: '28px',
                                                        borderRadius: '50%',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        border: '1px solid #e2e8f0',
                                                        transition: 'all 0.2s',
                                                        visibility: selectedComponentForMapping ? 'visible' : 'hidden'
                                                    }}
                                                    onMouseOver={(e) => {
                                                        e.currentTarget.style.backgroundColor = '#f1f5f9';
                                                        e.currentTarget.style.transform = 'scale(1.1)';
                                                    }}
                                                    onMouseOut={(e) => {
                                                        e.currentTarget.style.backgroundColor = '#f8fafc';
                                                        e.currentTarget.style.transform = 'scale(1)';
                                                    }}
                                                >
                                                    💡
                                                </div>
                                            </div>
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="Поиск по дереву фич..."
                                            value={folderSearchTerm}
                                            onChange={(e) => setFolderSearchTerm(e.target.value)}
                                            disabled={!selectedComponentForMapping}
                                            style={{
                                                width: '100%',
                                                padding: '10px 12px',
                                                borderRadius: '8px',
                                                border: '1px solid #cbd5e1',
                                                fontSize: '14px',
                                                outline: 'none',
                                                backgroundColor: !selectedComponentForMapping ? '#f1f5f9' : '#fff',
                                                color: '#0f172a'
                                            }}
                                        />
                                    </div>
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                                        {selectedComponentForMapping ? (
                                            renderFolderTreeForMapping(
                                                filterFolders(filterFoldersForProject(folders), folderSearchTerm),
                                                selectedComponentForMapping
                                            )
                                        ) : (
                                            <div style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                height: '100%',
                                                color: '#94a3b8'
                                            }}>

                                                <div style={{ fontSize: '16px' }}>Выберите компонент из списка слева,</div>
                                                <div style={{ fontSize: '14px' }}>чтобы настроить его связи с функциональными блоками</div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                padding: '16px 32px',
                                backgroundColor: '#fff',
                                borderTop: '1px solid #e2e8f0',
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '12px'
                            }}>

                                <button
                                    onClick={() => handleSaveBulkHistory(false)}
                                    style={{
                                        padding: '0 24px',
                                        height: '44px',
                                        backgroundColor: '#10b981',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '10px',
                                        fontWeight: 600,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#059669', e.currentTarget.style.transform = 'translateY(-1px)')}
                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#10b981', e.currentTarget.style.transform = 'translateY(0)')}
                                >
                                    <span>Завершить импорт и маппинг</span>
                                    {loading && <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Модальное окно подтверждения незамапленных компонентов */}
            {
                showUnmappedConfirmation && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2100, // Выше чем mapping modal
                        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    }}>
                        <div style={{
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            width: '600px', // Increased width
                            maxWidth: '90vw',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                            overflow: 'hidden',
                            animation: 'fadeIn 0.2s ease-out'
                        }}>
                            <div style={{
                                padding: '24px 28px',
                                borderBottom: '1px solid #fee2e2',
                                backgroundColor: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px'
                            }}>
                                {/* Emoji removed */}
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#111827' }}>
                                        Незамапленные компоненты
                                    </h3>
                                    <div style={{ fontSize: '14px', color: '#dc2626', marginTop: '4px', fontWeight: 500 }}>
                                        Требуется подтверждение действия
                                    </div>
                                </div>
                            </div>

                            <div style={{ padding: '28px' }}>
                                <p style={{ margin: '0 0 20px', fontSize: '15px', lineHeight: '1.6', color: '#374151' }}>
                                    Вы не связали следующие компоненты ({unmappedList.length}) с функциональными блоками Allure.
                                    <br />
                                    <strong>Вы уверены, что хотите сохранить историю без привязки этих компонентов?</strong>
                                </p>

                                <div style={{
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    backgroundColor: '#f9fafb'
                                }}>
                                    <ul style={{ margin: 0, padding: '8px 0', listStyle: 'none' }}>
                                        {unmappedList.map((comp, idx) => (
                                            <li key={idx} style={{
                                                padding: '10px 16px',
                                                marginBottom: '6px',
                                                fontSize: '14px',
                                                backgroundColor: '#334155',
                                                color: '#f8fafc',
                                                borderRadius: '10px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                border: '1px solid #475569',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                            }}>
                                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444', flexShrink: 0, boxShadow: '0 0 8px rgba(239, 68, 68, 0.4)' }} />
                                                <span style={{ fontWeight: 600 }}>{comp.name}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div style={{
                                padding: '20px 28px',
                                backgroundColor: '#f9fafb',
                                borderTop: '1px solid #e5e7eb',
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '12px'
                            }}>
                                <button
                                    onClick={() => setShowUnmappedConfirmation(false)}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: '1px solid #d1d5db',
                                        backgroundColor: '#fff',
                                        color: '#374151',
                                        fontSize: '14px',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#fff'}
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={() => {
                                        setShowUnmappedConfirmation(false);
                                        handleSaveBulkHistory(true);
                                    }}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: 'none',
                                        backgroundColor: '#dc2626',
                                        color: '#fff',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 6px rgba(220, 38, 38, 0.2)',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#b91c1c'}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                                >
                                    Продолжить без них
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default HeatmapPage;

