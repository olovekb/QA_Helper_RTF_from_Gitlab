import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import Select from 'react-select';
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
    const [projectId, setProjectId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedVersions, setSelectedVersions] = useState([]);
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
                loadHeatmapData();
            } else {
                loadTestCoverageData();
            }
        }
    }, [projectId, startDate, endDate, selectedVersions, isBugFix, activeTab]);

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

    const versionOptions = availableVersions.map(v => ({ value: v, label: v }));

    // Загрузка функциональных блоков из БД для маппинга
    const fetchFolders = async () => {
        if (!projectId) return;
        try {
            const response = await axios.get(`${config.TIAUrl}/api/functional-blocks?projectId=${projectId}`);
            if (response.data && Array.isArray(response.data)) {
                setFolders(response.data);
            } else {
                setFolders([]);
                console.warn('Получен некорректный формат функциональных блоков:', response.data);
            }
        } catch (err) {
            console.error('Ошибка при загрузке функциональных блоков:', err);
            setFolders([]);
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
                    affected_components: []
                };

                let componentsToProcess = [];

                if (json.unique_affected_components) {
                    componentsToProcess = Object.keys(json.unique_affected_components);
                } else if (json.global_risks && Array.isArray(json.global_risks)) {
                    // Поддержка формата с global_risks
                    componentsToProcess = json.global_risks
                        .map(risk => risk.source)
                        .filter(source => source);
                }

                componentsToProcess.forEach(compName => {
                    item.affected_components.push(compName);
                    uniqueComponentsSet.add(compName);
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
        // Для всех проектов показываем как обычно
        return `${folder.customFieldName} - ${folder.name}`;
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

    const handleSaveBulkHistory = async (force = false) => {
        // Валидация незамапленных компонентов
        if (!force) {
            const allComponents = Array.from(new Set(parsedHistoryItems.flatMap(item => item.affected_components)));
            const trulyUnmapped = allComponents.filter(name => !componentMappings[name] || componentMappings[name].length === 0);

            if (trulyUnmapped.length > 0) {
                setUnmappedList(trulyUnmapped.map(name => ({ name }))); // unmappedList expects objects with 'name' property for display
                setShowUnmappedConfirmation(true);
                return;
            }
        }
        setLoading(true);
        try {
            await axios.post(`${config.TIAUrl}/api/heatmap/bulk-import`, {
                projectId,
                items: parsedHistoryItems,
                mappings: componentMappings
            });

            setShowMappingModal(false);
            alert('История успешно импортирована!');
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
            const data = payload[0];
            return (
                <div style={{
                    backgroundColor: '#fff',
                    padding: '10px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}>
                    <p style={{ margin: 0, fontWeight: 600, color: '#000' }}>{data.name}</p>
                    <p style={{ margin: '4px 0 0 0', color: '#000' }}>
                        Количество: <strong style={{ color: '#000' }}>{data.value}</strong>
                    </p>
                </div>
            );
        }
        return null;
    };

    const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
        if (percent < 0.02) return null; // Не показываем подписи для маленьких сегментов

        const RADIAN = Math.PI / 180;
        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        return (
            <text
                x={x}
                y={y}
                fill="white"
                textAnchor={x > cx ? 'start' : 'end'}
                dominantBaseline="central"
                fontSize={12}
                fontWeight={600}
            >
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    };

    // Подготовка данных для Test Coverage (функциональные блоки)
    const testCoverageChartData = testCoverageData?.functionalBlocks?.slice(0, 30).map((item, index) => ({
        name: item.functionalBlockName,
        value: item.defectCount,
        percentage: parseFloat(item.percentage),
        color: COLORS[index % COLORS.length],
        functionalBlockId: item.functionalBlockId,
    })) || [];

    const otherFunctionalBlocks = testCoverageData?.functionalBlocks?.slice(30) || [];
    const otherFbCount = otherFunctionalBlocks.reduce((sum, item) => sum + item.defectCount, 0);
    const otherFbPercentage = testCoverageData?.totalDefects > 0
        ? ((otherFbCount / testCoverageData.totalDefects) * 100).toFixed(1)
        : '0.0';

    if (otherFbCount > 0) {
        testCoverageChartData.push({
            name: 'Прочие',
            value: otherFbCount,
            percentage: parseFloat(otherFbPercentage),
            color: '#cccccc',
            functionalBlockId: null,
        });
    }

    // Подготовка данных для роутов
    const routesChartData = testCoverageData?.routes?.slice(0, 30).map((item, index) => ({
        name: item.route,
        value: item.defectCount,
        percentage: parseFloat(item.percentage),
        color: COLORS[index % COLORS.length],
    })) || [];

    const otherRoutes = testCoverageData?.routes?.slice(30) || [];
    const otherRoutesCount = otherRoutes.reduce((sum, item) => sum + item.defectCount, 0);
    const otherRoutesPercentage = testCoverageData?.totalRoutesDefects > 0
        ? ((otherRoutesCount / testCoverageData.totalRoutesDefects) * 100).toFixed(1)
        : '0.0';

    if (otherRoutesCount > 0) {
        routesChartData.push({
            name: 'Прочие',
            value: otherRoutesCount,
            percentage: parseFloat(otherRoutesPercentage),
            color: '#cccccc',
        });
    }

    return (
        <div style={{
            padding: '40px',
            maxWidth: '1440px',
            margin: '0 auto',
            fontFamily: '"Inter", -apple-system, sans-serif',
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
                <h1 style={{
                    fontSize: '36px',
                    fontWeight: 800,
                    color: '#0f172a',
                    margin: 0,
                    letterSpacing: '-0.02em'
                }}>
                    3.2. Тепловая карта дефектов
                </h1>
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
                    <span style={{ fontSize: '20px' }}>⚡</span> Импорт истории TIA
                </button>
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
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '32px',
                    alignItems: 'end'
                }}>
                    {/* Поле Проекта */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                            <option value="">Выберите проект для анализа</option>
                            {projects?.map(project => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Поле Периода */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                            <option value="all">Все (BugFix + New Feature)</option>
                            <option value="bugs">Только исправления багов</option>
                            <option value="general">Только новые функции</option>
                        </select>
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

            {!loading && !error && activeTab === 'code' && heatmapData && (
                <div style={{
                    backgroundColor: '#fff',
                    padding: '32px',
                    borderRadius: '24px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                    marginBottom: '40px'
                }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', marginBottom: '24px', letterSpacing: '-0.01em' }}>
                        Распределение дефектов по компонентам
                    </h2>

                    <div style={{
                        display: 'flex',
                        gap: '40px',
                        flexWrap: 'wrap',
                        alignItems: 'center'
                    }}>
                        {/* Donut Chart */}
                        <div style={{
                            flex: '0 0 400px',
                            width: '400px',
                            maxWidth: '100%',
                            position: 'relative'
                        }}>
                            <ResponsiveContainer width="100%" height={400}>
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={renderCustomLabel}
                                        outerRadius={140}
                                        innerRadius={85}
                                        fill="#8884d8"
                                        dataKey="value"
                                        stroke="none"
                                        onClick={(data) => setSelectedComponent(data.name)}
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.color}
                                                style={{ filter: selectedComponent === entry.name ? 'drop-shadow(0 0 8px rgba(0,0,0,0.2))' : 'none', cursor: 'pointer' }}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                textAlign: 'center',
                                pointerEvents: 'none'
                            }}>
                                <div style={{ fontSize: '40px', fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
                                    {heatmapData.totalDefects.toLocaleString()}
                                </div>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginTop: '4px', letterSpacing: '0.05em' }}>
                                    Дефектов
                                </div>
                            </div>
                        </div>

                        {/* Легенда */}
                        <div style={{
                            flex: '1 1 auto',
                            minWidth: '300px',
                            maxHeight: '500px',
                            overflowY: 'auto',
                            padding: '12px'
                        }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                                gap: '12px',
                            }}>
                                {heatmapData.components.map((item, index) => {
                                    const color = index < COLORS.length ? COLORS[index] : '#cccccc';
                                    const isSelected = selectedComponent === item.componentName;
                                    return (
                                        <div
                                            key={item.componentName}
                                            onClick={() => setSelectedComponent(item.componentName)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                padding: '12px 16px',
                                                borderRadius: '16px',
                                                cursor: 'pointer',
                                                backgroundColor: isSelected ? '#eff6ff' : '#fcfdfe',
                                                border: `1.5px solid ${isSelected ? '#6366f1' : '#e2e8f0'}`,
                                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                                boxShadow: isSelected ? '0 4px 12px rgba(99, 102, 241, 0.1)' : 'none',
                                            }}
                                            onMouseOver={(e) => !isSelected && (e.currentTarget.style.borderColor = '#cbd5e1', e.currentTarget.style.backgroundColor = '#f8fafc')}
                                            onMouseOut={(e) => !isSelected && (e.currentTarget.style.borderColor = '#e2e8f0', e.currentTarget.style.backgroundColor = '#fcfdfe')}
                                        >
                                            <div
                                                style={{
                                                    width: '14px',
                                                    height: '14px',
                                                    borderRadius: '50%',
                                                    backgroundColor: color,
                                                    flexShrink: 0,
                                                    boxShadow: `0 0 0 3px ${color}20`
                                                }}
                                            />
                                            <span style={{
                                                flex: 1,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                color: isSelected ? '#1e3a8a' : '#475569',
                                                fontWeight: isSelected ? 700 : 500,
                                                fontSize: '14px'
                                            }}>
                                                {item.componentName}
                                            </span>
                                            <span style={{
                                                fontWeight: 800,
                                                color: isSelected ? '#1e3a8a' : '#1e293b',
                                                fontSize: '13px'
                                            }}>
                                                {item.percentage}%
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Test Coverage визуализация */}
            {!loading && !error && activeTab === 'test' && testCoverageData && (
                <div>
                    {/* Функциональные блоки и Роуты рядом */}
                    <div style={{
                        display: 'flex',
                        gap: '24px',
                        flexWrap: 'wrap',
                        alignItems: 'flex-start'
                    }}>
                        {/* Функциональные блоки */}
                        <div style={{
                            backgroundColor: '#fff',
                            padding: '32px',
                            borderRadius: '24px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                            flex: '1 1 0',
                            minWidth: '500px',
                        }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '24px' }}>
                                Функциональные блоки
                            </h2>

                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '24px',
                                alignItems: 'center'
                            }}>
                                {/* Donut Chart */}
                                <div style={{
                                    width: '100%',
                                    maxWidth: '350px',
                                    position: 'relative'
                                }}>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <PieChart>
                                            <Pie
                                                data={testCoverageChartData}
                                                cx="50%"
                                                cy="50%"
                                                labelLine={false}
                                                outerRadius={110}
                                                innerRadius={70}
                                                fill="#8884d8"
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {testCoverageChartData.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-fb-${index}`}
                                                        fill={entry.color}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip content={<CustomTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div style={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: '50%',
                                        transform: 'translate(-50%, -50%)',
                                        textAlign: 'center',
                                        pointerEvents: 'none'
                                    }}>
                                        <div style={{ fontSize: '28px', fontWeight: 900, color: '#0f172a' }}>
                                            {testCoverageData.totalDefects}
                                        </div>
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                                            Дефектов
                                        </div>
                                    </div>
                                </div>

                                {/* Легенда */}
                                <div style={{
                                    width: '100%',
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    padding: '4px'
                                }}>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                        gap: '8px',
                                    }}>
                                        {testCoverageData.functionalBlocks.map((item, index) => {
                                            const color = index < COLORS.length ? COLORS[index] : '#cccccc';
                                            return (
                                                <div
                                                    key={item.functionalBlockId}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        padding: '10px 12px',
                                                        borderRadius: '12px',
                                                        backgroundColor: '#f8fafc',
                                                        border: '1px solid #f1f5f9'
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: '10px',
                                                            height: '10px',
                                                            borderRadius: '50%',
                                                            backgroundColor: color,
                                                            flexShrink: 0,
                                                        }}
                                                    />
                                                    <span style={{
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        color: '#475569',
                                                        fontWeight: 500,
                                                        fontSize: '13px'
                                                    }}>
                                                        {item.functionalBlockName}
                                                    </span>
                                                    <span style={{
                                                        fontWeight: 700,
                                                        color: '#1e293b',
                                                        fontSize: '12px'
                                                    }}>
                                                        {item.percentage}%
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Роуты */}
                        {testCoverageData.routes && testCoverageData.routes.length > 0 && (
                            <div style={{
                                backgroundColor: '#fff',
                                padding: '32px',
                                borderRadius: '24px',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                                flex: '1 1 0',
                                minWidth: '500px',
                            }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '24px' }}>
                                    Статистика по Роутам
                                </h2>

                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '24px',
                                    alignItems: 'center'
                                }}>
                                    {/* Donut Chart */}
                                    <div style={{
                                        width: '100%',
                                        maxWidth: '350px',
                                        position: 'relative'
                                    }}>
                                        <ResponsiveContainer width="100%" height={300}>
                                            <PieChart>
                                                <Pie
                                                    data={routesChartData}
                                                    cx="50%"
                                                    cy="50%"
                                                    labelLine={false}
                                                    outerRadius={110}
                                                    innerRadius={70}
                                                    fill="#8884d8"
                                                    dataKey="value"
                                                    stroke="none"
                                                >
                                                    {routesChartData.map((entry, index) => (
                                                        <Cell
                                                            key={`cell-route-${index}`}
                                                            fill={entry.color}
                                                        />
                                                    ))}
                                                </Pie>
                                                <Tooltip content={<CustomTooltip />} />
                                            </PieChart>
                                        </ResponsiveContainer>
                                        <div style={{
                                            position: 'absolute',
                                            top: '50%',
                                            left: '50%',
                                            transform: 'translate(-50%, -50%)',
                                            textAlign: 'center',
                                            pointerEvents: 'none'
                                        }}>
                                            <div style={{ fontSize: '28px', fontWeight: 900, color: '#0f172a' }}>
                                                {testCoverageData.totalRoutesDefects}
                                            </div>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                                                Дефектов
                                            </div>
                                        </div>
                                    </div>

                                    {/* Легенда */}
                                    <div style={{
                                        width: '100%',
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                        padding: '4px'
                                    }}>
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                            gap: '8px',
                                        }}>
                                            {testCoverageData.routes.map((item, index) => {
                                                const color = index < COLORS.length ? COLORS[index] : '#cccccc';
                                                return (
                                                    <div
                                                        key={item.route}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '10px',
                                                            padding: '10px 12px',
                                                            borderRadius: '12px',
                                                            backgroundColor: '#f8fafc',
                                                            border: '1px solid #f1f5f9'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                width: '10px',
                                                                height: '10px',
                                                                borderRadius: '50%',
                                                                backgroundColor: color,
                                                                flexShrink: 0,
                                                            }}
                                                        />
                                                        <span style={{
                                                            flex: 1,
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                            color: '#475569',
                                                            fontWeight: 500,
                                                            fontSize: '13px'
                                                        }}>
                                                            {item.route}
                                                        </span>
                                                        <span style={{
                                                            fontWeight: 700,
                                                            color: '#1e293b',
                                                            fontSize: '12px'
                                                        }}>
                                                            {item.percentage}%
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
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
                            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: 0 }}>Загрузка истории TIA</h2>
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
                            >©</button>
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
                                <div style={{ fontSize: '32px', marginBottom: '12px' }}>📁</div>
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
            )}

            {/* Модальное окно маппинга для импорта */}
            {showMappingModal && (
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
                                <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: 0 }}>Маппинг компонентов</h2>
                                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>Свяжите компоненты из отчета с функциональными блоками Allure</div>
                            </div>
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
                            >©</button>
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
                                            backgroundColor: '#fff'
                                        }}
                                    />
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                                    {Array.from(new Set(parsedHistoryItems.flatMap(item => item.affected_components)))
                                        .sort()
                                        .filter(name => name.toLowerCase().includes(mappingFilter.toLowerCase()))
                                        .map(compName => {
                                            const isSelected = selectedComponentForMapping === compName;
                                            const hasMapping = componentMappings[compName] && componentMappings[compName].length > 0;

                                            // Используем красный цвет для незамапленных, как в TIAPage
                                            const statusColor = hasMapping ? '#22c55e' : '#dc3545';
                                            const statusBorder = hasMapping ? '1px solid #22c55e' : '1px solid #dc3545';
                                            const bgColor = isSelected ? '#eff6ff' : '#fff';

                                            return (
                                                <div
                                                    key={compName}
                                                    onClick={() => setSelectedComponentForMapping(compName)}
                                                    style={{
                                                        padding: '12px',
                                                        marginBottom: '8px',
                                                        borderRadius: '8px',
                                                        backgroundColor: bgColor,
                                                        border: isSelected ? '1px solid #3b82f6' : '1px solid #e2e8f0',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.2s',
                                                        borderLeft: isSelected ? '4px solid #3b82f6' : '1px solid #e2e8f0',
                                                        boxShadow: isSelected ? '0 4px 6px -1px rgba(59, 130, 246, 0.1)' : 'none'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#334155', wordBreak: 'break-all' }}>
                                                            {compName}
                                                        </div>
                                                        <div style={{
                                                            width: '8px',
                                                            height: '8px',
                                                            borderRadius: '50%',
                                                            backgroundColor: statusColor,
                                                            flexShrink: 0,
                                                            marginLeft: '8px'
                                                        }} />
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: hasMapping ? '#22c55e' : '#dc3545', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        {hasMapping ? '✓ Связан' : '⚠️ Не связан'}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>

                            {/* Правая панель: Дерево маппинга */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#fff' }}>
                                <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff' }}>
                                    <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
                                            {selectedComponentForMapping ? `Маппинг для: ${selectedComponentForMapping}` : 'Выберите компонент слева'}
                                        </h3>
                                        {selectedComponentForMapping && (
                                            <div style={{ fontSize: '13px', color: '#64748b' }}>
                                                {componentMappings[selectedComponentForMapping]?.length || 0} привязано
                                            </div>
                                        )}
                                    </div>
                                    <div style={{
                                        marginBottom: '10px',
                                        fontSize: '12px',
                                        color: '#64748b',
                                        backgroundColor: '#f1f5f9',
                                        padding: '8px 12px',
                                        borderRadius: '6px',
                                        lineHeight: 1.4
                                    }}>
                                        💡 <b>Подсказка:</b>
                                        <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px' }}>
                                            <li><b>Один клик</b> — выбрать/убрать текущий элемент</li>
                                            <li><b>Двойной клик</b> — выбрать/убрать элемент со всеми вложенными</li>
                                        </ul>
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
                                            backgroundColor: !selectedComponentForMapping ? '#f1f5f9' : '#fff'
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
                                            <div style={{ fontSize: '48px', marginBottom: '16px' }}>👈</div>
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
                                onClick={() => setShowMappingModal(false)}
                                style={{
                                    padding: '0 24px',
                                    height: '44px',
                                    backgroundColor: '#fff',
                                    color: '#64748b',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    fontWeight: 600,
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc', e.currentTarget.style.borderColor = '#cbd5e1')}
                                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#fff', e.currentTarget.style.borderColor = '#e2e8f0')}
                            >
                                Назад к выбору файлов
                            </button>
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
            )}

            {/* Модальное окно подтверждения незамапленных компонентов */}
            {showUnmappedConfirmation && (
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
                        width: '500px',
                        maxWidth: '90vw',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        overflow: 'hidden',
                        animation: 'fadeIn 0.2s ease-out'
                    }}>
                        <div style={{
                            padding: '20px 24px',
                            borderBottom: '1px solid #fee2e2',
                            backgroundColor: '#fef2f2',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px'
                        }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                backgroundColor: '#fee2e2',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '20px',
                                flexShrink: 0
                            }}>
                                ⚠️
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#991b1b' }}>
                                    Незамапленные компоненты
                                </h3>
                                <div style={{ fontSize: '13px', color: '#b91c1c', marginTop: '2px' }}>
                                    Требуется подтверждение действия
                                </div>
                            </div>
                        </div>

                        <div style={{ padding: '24px' }}>
                            <p style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: '1.5', color: '#374151' }}>
                                Вы не связали следующие компоненты ({unmappedList.length}) с функциональными блоками Allure.
                                <br />
                                <strong>Вы уверены, что хотите сохранить историю без привязки этих компонентов?</strong>
                            </p>

                            <div style={{
                                maxHeight: '200px',
                                overflowY: 'auto',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                backgroundColor: '#f9fafb'
                            }}>
                                <ul style={{ margin: 0, padding: '8px 0', listStyle: 'none' }}>
                                    {unmappedList.map((comp, idx) => (
                                        <li key={idx} style={{
                                            padding: '6px 16px',
                                            fontSize: '13px',
                                            color: '#4b5563',
                                            borderBottom: idx < unmappedList.length - 1 ? '1px solid #f3f4f6' : 'none',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                                            {comp.name}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div style={{
                            padding: '16px 24px',
                            backgroundColor: '#f9fafb',
                            borderTop: '1px solid #e5e7eb',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '12px'
                        }}>
                            <button
                                onClick={() => setShowUnmappedConfirmation(false)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '6px',
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
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    backgroundColor: '#dc2626',
                                    color: '#fff',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
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
            )}
        </div>
    );
};

export default HeatmapPage;

