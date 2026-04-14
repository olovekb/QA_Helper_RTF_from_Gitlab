import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import Select from 'react-select';
import { useNavigate } from 'react-router-dom';
import config from './config';
import styles from './styles';
import { trackEvent } from './analytics';
import setupStyles from './components/TIAPage/styles/TIAStyles';


const COLORS = [
    '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d',
    '#ffc658', '#ff7300', '#8dd1e1', '#d084d0', '#ffb347', '#87ceeb',
    '#dda0dd', '#98d8c8', '#f7dc6f', '#bb8fce', '#85c1e2', '#f8c471',
    '#f1948a', '#85c1e9', '#f4d03f', '#a569bd', '#5dade2', '#f39c12',
    '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#1abc9c', '#34495e',
];

const HeatmapPage = ({ projects }) => {
    const navigate = useNavigate();
    const [projectId, setProjectId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [selectedVersions, setSelectedVersions] = useState([]);
    const [side, setSide] = useState('frontend');
    const [availableVersions, setAvailableVersions] = useState([]);
    const [isBugFix, setIsBugFix] = useState(null);
    const [heatmapData, setHeatmapData] = useState(null);
    const [testCoverageData, setTestCoverageData] = useState(null);
    const [activeTab, setActiveTab] = useState('code');
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
    const [activeMetric, setActiveMetric] = useState('incidents');
    const [loadingStructure, setLoadingStructure] = useState(false);

    const [showMappingModal, setShowMappingModal] = useState(false);
    const [unmappedComponents, setUnmappedComponents] = useState([]);
    const [componentMappings, setComponentMappings] = useState({});
    const [folders, setFolders] = useState([]);
    const [folderNamesCache, setFolderNamesCache] = useState({});
    const [parsedHistoryItems, setParsedHistoryItems] = useState([]);

    const [showUnmappedConfirmation, setShowUnmappedConfirmation] = useState(false);
    const [unmappedList, setUnmappedList] = useState([]);

    const [selectedComponentForMapping, setSelectedComponentForMapping] = useState(null);
    const [mappingFilter, setMappingFilter] = useState('');
    const [folderSearchTerm, setFolderSearchTerm] = useState('');
    const [expandedFolders, setExpandedFolders] = useState({});
    const [expandedComponentFolders, setExpandedComponentFolders] = useState({});
    const [expandedPageLists, setExpandedPageLists] = useState({});

    const [showAllCode, setShowAllCode] = useState(false);
    const [showAllPages, setShowAllPages] = useState(false);
    const [showAllFb, setShowAllFb] = useState(false);

    const [groupingType, setGroupingType] = useState('controller');

    useEffect(() => {
        if (projectId) {
            loadAvailableVersions();
        }
    }, [projectId, startDate, endDate]);

    useEffect(() => {
        if (projectId) {
            if (activeTab === 'code') {
                loadHeatmapData();
                loadTestCoverageData();
            } else {
                loadTestCoverageData();
            }
        }
    }, [projectId, startDate, endDate, selectedVersions, isBugFix, activeTab, side]);

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

    const stats = React.useMemo(() => {
        const currentData = activeTab === 'code' ? heatmapData : testCoverageData;
        if (!currentData) return { totalTouches: 0, totalIncidents: 0, totalTime: 0 };

        const totalTouches = currentData.totalDefects || 0;

        const totalIncidents = currentData.uniqueTotalIssuesCount || 0;

        const allKeys = new Set();
        if (activeTab === 'code' && currentData.components) {
            currentData.components.forEach(c => c.issueKeys?.forEach(k => allKeys.add(k)));
        } else if (activeTab === 'test' && currentData.allIssueKeys) {
            currentData.allIssueKeys.forEach(k => allKeys.add(k));
        }

        const totalTime = Array.from(allKeys).reduce((acc, key) => acc + (issueTimeMap[key] || 0), 0);

        return { totalTouches, totalIncidents, totalTime };
    }, [heatmapData, testCoverageData, activeTab, issueTimeMap]);

    const versionOptions = availableVersions.map(v => ({ value: v, label: v }));

    const fetchFolders = async () => {
        if (!projectId) return;
        setLoadingStructure(true);
        try {
            const response = await axios.get(`${config.TIAUrl}/api/structure`, {
                params: { projectId },
            });
            const folderList = response.data.folders || [];
            setFolders(folderList);

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
            setLoadingStructure(false);
        }
    };

    const handleProcessFiles = async () => {
        if (importFiles.length === 0) return;
        trackEvent('heatmap_process_files', { page: '/heatmap', projectId });

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
                    pages: json.pages || [],
                    component_details: {}
                };

                let componentsToProcess = [];
                const uniqueMap = json.unique_affected_components || {};

                if (json.backend_components && Array.isArray(json.backend_components)) {
                    const backendPages = [];
                    json.backend_components.forEach(backendComp => {
                        const compName = `${backendComp.service_name || 'unknown'}::${backendComp.controller_name || backendComp.name}`;
                        componentsToProcess.push(compName);
                        uniqueMap[compName] = {
                            risk_level: backendComp.risk_level || 'LOW',
                            type: 'backend'
                        };

                        if (backendComp.endpoints && Array.isArray(backendComp.endpoints)) {
                            backendComp.endpoints.forEach(ep => {
                                backendPages.push({
                                    page_meta: {
                                        name: backendComp.controller_name || compName,
                                        route: ep.route
                                    },
                                    depends_on_components: [compName]
                                });
                            });
                        }
                    });
                    item.pages = backendPages;
                } else if (json.unique_affected_components) {
                    componentsToProcess = Object.keys(json.unique_affected_components);
                } else if (json.global_risks && Array.isArray(json.global_risks)) {
                    componentsToProcess = json.global_risks
                        .map(risk => risk.source)
                        .filter(source => source);
                }

                componentsToProcess.forEach(compName => {
                    let type = 'frontend';
                    const detail = uniqueMap[compName] || {};
                    if (json.type === 'backend' || detail.type === 'backend') {
                        type = 'backend';
                    } else if (json.Controllers && json.Controllers[compName]) {
                        type = 'backend';
                    }

                    item.affected_components.push({ name: compName, type });
                    uniqueComponentsSet.add(compName);

                    item.component_details[compName] = {
                        risk: detail.risk_level || 'LOW',
                        file_path: detail.file_path || '',
                        change_source: detail.change_source || '',
                        type,
                        pages_count: (json.pages || []).filter(p => (p.depends_on_components || []).includes(compName)).length,
                        pages: (json.pages || [])
                            .filter(p => (p.depends_on_components || []).includes(compName))
                            .map(p => p.page_meta?.name || 'Unknown')
                    };
                });

                if (item.pages && Array.isArray(item.pages)) {
                    item.pages.forEach(page => {
                        if (page.page_meta && page.page_meta.controller && page.page_meta.name !== page.page_meta.controller) {
                            if (!page.page_meta.route || page.page_meta.route === page.page_meta.name) {
                                page.page_meta.route = page.page_meta.name;
                            }
                            page.page_meta.name = page.page_meta.controller;
                        }
                    });
                }

                allParsedItems.push(item);

                if (i % 20 === 0 || i === importFiles.length - 1) {
                    setImportLog(prev => [...prev, `Обработано ${i + 1} из ${importFiles.length} файлов...`]);
                }
            }

            setParsedHistoryItems(allParsedItems);

            const componentNames = Array.from(uniqueComponentsSet);
            setImportLog(prev => [...prev, `Найдено ${componentNames.length} уникальных компонентов. Проверка маппингов...`]);

            const mappingResponse = await axios.get(`${config.TIAUrl}/api/components?projectId=${projectId}`);
            const existingMappings = mappingResponse.data.mappings || [];

            const mappingsMap = {};
            const unmapped = [];
            const namesCache = {};

            componentNames.forEach(name => {
                const found = existingMappings.filter(m => m.component_name === name);
                if (found.length > 0) {
                    const blockIds = [...new Set(found.map(m => m.functional_block_allure_id))];
                    mappingsMap[name] = blockIds;
                    found.forEach(m => {
                        if (m.functional_block_allure_id && m.functional_block_name) {
                            namesCache[m.functional_block_allure_id] = m.functional_block_name;
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

    const getAllDescendantIds = (folder) => {
        const ids = [folder.id.toString()];
        if (folder.children && folder.children.length > 0) {
            folder.children.forEach(child => {
                ids.push(...getAllDescendantIds(child));
            });
        }
        return ids;
    };

    const areAllDescendantsSelected = (folder, mappings) => {
        const folderId = folder.id.toString();
        if (mappings.includes(folderId)) return true;

        if (!folder.children || folder.children.length === 0) {
            return mappings.includes(folderId);
        }

        return folder.children.every(child => areAllDescendantsSelected(child, mappings));
    };

    const filterFolders = (folders, searchTerm) => {
        if (!searchTerm) return folders;
        const lowerSearch = searchTerm.toLowerCase();

        return folders.reduce((acc, folder) => {
            const matches = folder.name.toLowerCase().includes(lowerSearch) ||
                (folder.customFieldName && folder.customFieldName.toLowerCase().includes(lowerSearch));

            if (matches) {
                acc.push(folder);
            } else {
                const filteredChildren = folder.children ? filterFolders(folder.children, searchTerm) : [];
                if (filteredChildren.length > 0) {
                    acc.push({
                        ...folder,
                        children: filteredChildren
                    });
                }
            }
            return acc;
        }, []);
    };

    const formatCustomFieldName = (folder, level = 0) => {
        if (folder.customFieldName) {
            return `${folder.customFieldName} - ${folder.name}`;
        }
        return folder.name;
    };

    const filterFoldersForProject = (folders, isRoot = true) => {
        const nocodeProjectIds = ['1', '307', '377'];
        if (!nocodeProjectIds.includes(String(projectId))) {
            return folders;
        }

        const result = [];
        folders.forEach(folder => {
            const isBlockOrSubBlock = folder.customFieldName === 'Block' || folder.customFieldName === 'SubBlock';

            if (isRoot) {
                if (isBlockOrSubBlock) {
                    const children = folder.children && folder.children.length > 0
                        ? filterFoldersForProject(folder.children, false)
                        : [];
                    result.push({
                        ...folder,
                        children: children
                    });
                } else {
                    if (folder.children && folder.children.length > 0) {
                        const children = filterFoldersForProject(folder.children, true);
                        result.push(...children);
                    }
                }
            } else {
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

    const renderFolderTreeForMapping = (folders, componentId, level = 0) => {
        if (!folders || folders.length === 0) {
            if (level === 0) {
                return <div style={{ color: 'var(--text-muted)', fontSize: '14px', padding: '20px', textAlign: 'center' }}>Нет доступных фич, измените параметры поиска</div>;
            }
            return null;
        }

        return folders.map((folder) => {
            const folderId = folder.id.toString();
            const mappings = componentId ? (componentMappings[componentId] || []) : [];
            const isDirectlySelected = mappings.includes(folderId);

            const allDescendantsSelected = areAllDescendantsSelected(folder, mappings);

            const someDescendantsSelected = folder.children && folder.children.length > 0 &&
                getAllDescendantIds(folder).some(id => mappings.includes(id) && id !== folderId);

            const isFullSelected = allDescendantsSelected;
            const isPartiallySelected = !isFullSelected && (someDescendantsSelected || isDirectlySelected);

            const isSelected = isFullSelected || isDirectlySelected;
            const hasChildren = folder.children && folder.children.length > 0;
            const isExpanded = expandedFolders[folder.id];

            const bgColor = isFullSelected
                ? 'var(--success-bg)'
                : isPartiallySelected
                    ? 'var(--warning-bg)'
                    : 'transparent';

            const borderColor = isFullSelected
                ? 'var(--success)'
                : isPartiallySelected
                    ? 'var(--warning)'
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
                            ':hover': { backgroundColor: 'var(--bg-input)' }
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!componentId) return;

                            if (isDirectlySelected) {
                                const newMappings = mappings.filter(id => id !== folderId);
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: newMappings
                                }));
                            } else {
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: [...mappings, folderId]
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
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: newMappings
                                }));
                            } else {
                                const newMappingsSet = new Set([...currentMappings, ...allDescendantIds]);
                                setComponentMappings(prev => ({
                                    ...prev,
                                    [componentId]: Array.from(newMappingsSet)
                                }));
                            }
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = isFullSelected ? 'color-mix(in srgb, var(--success) 30%, var(--bg-content))' : isPartiallySelected ? 'color-mix(in srgb, var(--warning) 30%, var(--bg-content))' : 'var(--bg-input)';
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
                                    color: 'var(--text-muted)',
                                    userSelect: 'none',
                                    width: '32px',
                                    height: '32px',
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
                            color: 'var(--text-primary)',
                            flex: 1
                        }}>
                            {formatCustomFieldName(folder, level)}
                        </span>
                        {isSelected && (
                            <>
                                <span style={{
                                    marginLeft: '8px',
                                    color: 'var(--success)',
                                    fontSize: '16px',
                                    fontWeight: 'bold'
                                }}>
                                    ✓
                                </span>
                                {hasChildren && allDescendantsSelected && !isDirectlySelected && (
                                    <span style={{
                                        marginLeft: '4px',
                                        color: 'var(--success)',
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
        const hasMapping = componentMappings[compName] && componentMappings[compName].filter(id => id !== null && id !== undefined && id !== '').length > 0;

        const details = parsedHistoryItems
            .filter(item => item.component_details && item.component_details[compName])
            .map(item => item.component_details[compName]);

        const maxRisk = details.some(d => d.risk === 'HIGH') ? 'HIGH' :
            details.some(d => d.risk === 'MEDIUM') ? 'MEDIUM' : 'LOW';
        const totalPages = details.reduce((sum, d) => sum + (d.pages_count || 0), 0);
        const firstFilePath = details.find(d => d.file_path)?.file_path || '';

        const riskColor = maxRisk === 'HIGH' ? 'var(--error)' :
            maxRisk === 'MEDIUM' ? 'var(--warning)' : 'var(--success)';
        const bgColor = isSelected ? 'color-mix(in srgb, var(--primary-accent) 12%, var(--bg-content))' : 'var(--bg-content)';

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
                    border: isSelected ? '1px solid var(--primary-accent)' : '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    borderLeft: isSelected ? '4px solid var(--primary-accent)' : '1px solid var(--border-color)',
                    boxShadow: isSelected ? '0 4px 6px -1px rgba(59, 130, 246, 0.1)' : 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-all', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span>{compName.split('/').pop()}</span>
                        {compName.includes('/') && (
                            <span style={{ fontSize: '10px', color: 'var(--text-placeholder)', fontWeight: 500 }}>
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
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', fontFamily: 'monospace', wordBreak: 'break-all', opacity: 0.8 }}>
                        {firstFilePath.split('/').pop()}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: '10px', color: hasMapping ? 'var(--success)' : 'var(--error)', display: 'flex', flexDirection: 'column', gap: '4px', fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {hasMapping ? 'Связан' : 'Не связан'}
                            </div>
                            {hasMapping && (
                                <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontWeight: 500, paddingLeft: '14px' }}>
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
                                    color: 'var(--primary-accent)',
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
                            backgroundColor: 'var(--bg-input)',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            maxHeight: '150px',
                            overflowY: 'auto'
                        }}>
                            {Array.from(new Set(details.flatMap(d => d.pages || []))).sort().map((pageName, pidx) => (
                                <span
                                    key={`${compName}-page-${pidx}`}
                                    style={{
                                        padding: '2px 6px',
                                        backgroundColor: 'var(--border-color)',
                                        color: 'var(--text-secondary)',
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
                                    color: 'var(--text-secondary)',
                                    backgroundColor: 'var(--bg-input)',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    userSelect: 'none',
                                    border: '1px solid var(--border-color)',
                                    transition: 'all 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-color)'}
                                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-input)'}
                            >
                                <span style={{ fontSize: '10px', color: 'var(--text-placeholder)' }}>{isExpanded ? '▼' : '►'}</span>
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
        trackEvent('heatmap_save_history', { page: '/heatmap', projectId, extra: { force, count: parsedHistoryItems?.length } });
        if (!force) {
            const allComponents = Array.from(new Set(parsedHistoryItems.flatMap(item =>
                item.affected_components.map(c => typeof c === 'string' ? c : c.name)
            )));
            const trulyUnmapped = allComponents.filter(name => !componentMappings[name] || componentMappings[name].length === 0);

            if (trulyUnmapped.length > 0) {
                setUnmappedList(trulyUnmapped.map(name => ({ name })));
                setShowUnmappedConfirmation(true);
                return;
            }
        }

        setLoading(true);
        try {
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

    const chartData = heatmapData?.components?.slice(0, 30).map((item, index) => ({
        name: item.componentName,
        value: item.count,
        percentage: parseFloat(item.percentage),
        color: COLORS[index % COLORS.length],
    })) || [];

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
                    backgroundColor: 'var(--bg-content)',
                    padding: '12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    boxShadow: 'var(--shadow-md)',
                }}>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>{data.name}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                            Инциденты: <strong style={{ color: 'var(--text-primary)' }}>{data.uniqueIncidentCount || 0}</strong>
                        </p>
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                            Касания: <strong style={{ color: 'var(--text-primary)' }}>{data.defectCount || data.value}</strong>
                        </p>
                        {calculateTimeSpent(data.issueKeys) > 0 && (
                            <p style={{ margin: 0, fontSize: '12px', color: 'var(--primary-accent)' }}>
                                ⏱ Время: <strong>{formatSeconds(calculateTimeSpent(data.issueKeys))}</strong>
                            </p>
                        )}
                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', fontWeight: 700, color: 'var(--primary-accent)' }}>
                            Доля: {data.percentage}%
                        </p>
                    </div>
                </div>
            );
        }
        return null;
    };

    const MetricToggle = () => (
        <div style={setupStyles.modeToggleContainer}>
            {[
                { id: 'incidents', label: 'Инциденты' },
                { id: 'touches', label: 'Касания' },
                { id: 'time', label: 'Время' }
            ].map(m => (
                <button
                    key={m.id}
                    onClick={() => setActiveMetric(m.id)}
                    style={setupStyles.modeToggleButton(activeMetric === m.id)}
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

        const score = (incidents * 15) + (timeSpent * 7);
        return Math.min(score, 100);
    };

    const prepareParetoData = (items, totalValue, isExpanded = false) => {
        if (!items) return [];
        const sorted = [...items].sort((a, b) => getMetricValue(b) - getMetricValue(a));
        const limit = isExpanded ? sorted.length : 15;
        const top = sorted.slice(0, limit);
        const others = sorted.slice(limit);

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
                color: 'var(--text-placeholder)'
            });
        }
        return result;
    };


    const processedPagesData = useMemo(() => {
        if (!testCoverageData?.pages) return [];
        if (side !== 'backend') return testCoverageData.pages;

        const map = new Map();
        testCoverageData.pages.forEach(page => {
            const key = groupingType === 'controller' ? (page.pageName || 'Unknown Controller') : (page.pageRoute || page.pageName);

            if (!map.has(key)) {
                map.set(key, {
                    pageName: key,
                    pageRoute: groupingType === 'method' ? page.pageRoute : '',
                    defectCount: 0,
                    uniqueIncidentCount: 0,
                    issueKeys: []
                });
            }
            const group = map.get(key);
            group.defectCount += (page.defectCount || 0);

            const allIssues = new Set([...group.issueKeys, ...(page.issueKeys || [])]);
            group.issueKeys = Array.from(allIssues);
            group.uniqueIncidentCount = group.issueKeys.length;
        });

        const totalDefects = Array.from(map.values()).reduce((sum, item) => sum + item.defectCount, 0);

        return Array.from(map.values())
            .map(item => ({
                ...item,
                percentage: totalDefects > 0 ? ((item.defectCount / totalDefects) * 100).toFixed(1) : '0.0'
            }))
            .sort((a, b) => b.defectCount - a.defectCount);

    }, [testCoverageData?.pages, side, groupingType]);

    const codeChartData = prepareParetoData(heatmapData?.components, getTotalMetricValue(heatmapData?.components), showAllCode);
    const pagesChartData = prepareParetoData(processedPagesData, getTotalMetricValue(processedPagesData), showAllPages);
    const fbChartData = prepareParetoData(testCoverageData?.functionalBlocks, getTotalMetricValue(testCoverageData?.functionalBlocks), showAllFb);

    return (
        <div style={{
            padding: '40px',
            maxWidth: '1440px',
            margin: '0 auto',
            fontFamily: 'var(--font-main), "Inter", "Outfit", "Roboto", sans-serif',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--bg-main)',
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
                            backgroundColor: 'var(--bg-content)',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border-color)',
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
                        onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)', e.currentTarget.style.color = 'var(--text-secondary)')}
                        onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)', e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                        Назад
                    </button>
                    <button
                        onClick={() => setShowImportModal(true)}
                        disabled={!projectId}
                        style={{
                            padding: '0 28px',
                            height: '52px',
                            backgroundColor: 'var(--primary-accent)',
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
                        onMouseOver={(e) => !projectId ? null : (e.currentTarget.style.backgroundColor = 'var(--primary-hover)')}
                        onMouseOut={(e) => !projectId ? null : (e.currentTarget.style.backgroundColor = 'var(--primary-accent)')}
                    >
                        Импорт истории TIA
                    </button>
                </div>
            </div>

            {/* Табы Code/Test Coverage */}
            <div style={{ ...setupStyles.modeToggleContainer, marginBottom: '32px' }}>
                <button
                    onClick={() => setActiveTab('code')}
                    style={setupStyles.modeToggleButton(activeTab === 'code')}
                >
                    Code Coverage
                </button>
                <button
                    onClick={() => setActiveTab('test')}
                    style={setupStyles.modeToggleButton(activeTab === 'test')}
                >
                    Test Coverage
                </button>
            </div>
            <div style={{
                backgroundColor: 'var(--bg-content)',
                padding: '32px',
                borderRadius: '24px',
                marginBottom: '40px',
                border: '1px solid var(--border-color)',
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
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Целевой проект
                        </span>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0 20px',
                                border: '1px solid var(--border-color)',
                                borderRadius: '14px',
                                fontSize: '15px',
                                backgroundColor: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                height: '52px',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                outline: 'none',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)', e.target.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--primary-accent) 20%, transparent)')}
                            onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)', e.target.style.boxShadow = 'none')}
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
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Период данных
                        </span>
                        <div style={{
                            display: 'flex',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '14px',
                            height: '52px',
                            overflow: 'hidden',
                            transition: 'all 0.2s ease'
                        }}>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '14px', color: 'var(--text-primary)', padding: '0 16px', outline: 'none' }}
                            />
                            <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)', alignSelf: 'center' }} />
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '14px', color: 'var(--text-primary)', padding: '0 16px', outline: 'none' }}
                            />
                        </div>
                    </div>

                    {/* Поле Релизов */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                                    borderColor: state.isFocused ? 'var(--border-focus)' : 'var(--border-color)',
                                    borderRadius: '14px',
                                    fontSize: '14px',
                                    minHeight: '52px',
                                    backgroundColor: 'var(--bg-input)',
                                    boxShadow: state.isFocused ? '0 0 0 4px color-mix(in srgb, var(--primary-accent) 20%, transparent)' : 'none',
                                    '&:hover': { borderColor: state.isFocused ? 'var(--border-focus)' : 'var(--border-focus)' }
                                }),
                                menu: (base) => ({
                                    ...base,
                                    backgroundColor: 'var(--bg-content)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '12px',
                                    overflow: 'hidden'
                                }),
                                menuList: (base) => ({
                                    ...base,
                                    backgroundColor: 'var(--bg-content)',
                                    padding: '4px'
                                }),
                                option: (base, state) => ({
                                    ...base,
                                    backgroundColor: state.isFocused ? 'var(--bg-input)' : 'var(--bg-content)',
                                    color: 'var(--text-primary)'
                                }),
                                multiValue: (base) => ({
                                    ...base,
                                    backgroundColor: 'color-mix(in srgb, var(--primary-accent) 12%, var(--bg-content))',
                                    borderRadius: '10px',
                                    padding: '2px 8px',
                                    border: '1px solid var(--border-color)'
                                }),
                                multiValueLabel: (base) => ({ ...base, color: 'var(--text-primary)', fontWeight: 600 }),
                                placeholder: (base) => ({ ...base, color: 'var(--text-placeholder)' }),
                                input: (base) => ({ ...base, color: 'var(--text-primary)' })
                            }}
                        />
                    </div>

                    {/* Поле Типа */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
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
                                border: '1px solid var(--border-color)',
                                borderRadius: '14px',
                                fontSize: '15px',
                                fontWeight: 500,
                                color: 'var(--text-primary)',
                                backgroundColor: 'var(--bg-input)',
                                height: '52px',
                                outline: 'none',
                                transition: 'all 0.2s ease',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)', e.target.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--primary-accent) 20%, transparent)')}
                            onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)', e.target.style.boxShadow = 'none')}
                        >
                            <option value="all">Все</option>
                            <option value="bugs">Только исправления багов</option>
                            <option value="general">Только новые функции</option>
                        </select>
                    </div>

                    {/* Поле типа фронт или бек */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Сторона системы
                        </span>
                        <select
                            value={side}
                            onChange={(e) => setSide(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0 20px',
                                border: '1px solid var(--border-color)',
                                borderRadius: '14px',
                                fontSize: '15px',
                                fontWeight: 500,
                                color: 'var(--text-primary)',
                                backgroundColor: 'var(--bg-input)',
                                height: '52px',
                                outline: 'none',
                                transition: 'all 0.2s ease',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)', e.target.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--primary-accent) 20%, transparent)')}
                            onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)', e.target.style.boxShadow = 'none')}
                        >
                            <option value="frontend">Frontend</option>
                            <option value="backend">Backend</option>
                        </select>
                    </div>

                    {/* Поле Jira PAT */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Jira PAT
                            </span>
                            {syncingJira && (
                                <span style={{ fontSize: '10px', color: 'var(--primary-accent)', fontWeight: 700, animation: 'pulse 1.5s infinite' }}>
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
                                border: '1px solid var(--border-color)',
                                borderRadius: '14px',
                                fontSize: '14px',
                                backgroundColor: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                height: '52px',
                                transition: 'all 0.2s ease',
                                outline: 'none',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)', e.target.style.boxShadow = '0 0 0 4px color-mix(in srgb, var(--primary-accent) 20%, transparent)')}
                            onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)', e.target.style.boxShadow = 'none')}
                        />
                    </div>
                </div>
            </div>

            {/* График и легенда */}
            {loadingStructure && (
                <div style={{ textAlign: 'center', padding: '100px', color: 'var(--text-muted)' }}>
                    <div style={{ width: '40px', height: '40px', border: '3px solid var(--bg-input)', borderTopColor: 'var(--primary-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                    <div style={{ fontWeight: 600 }}>Загрузка структуры из ТестОпс...</div>
                </div>
            )}

            {error && (
                <div style={{
                    backgroundColor: 'var(--error-bg)',
                    border: '1px solid var(--error)',
                    borderRadius: '16px',
                    padding: '24px',
                    marginBottom: '32px',
                    color: 'var(--error)',
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
                        { label: 'Касания', value: stats.totalTouches, sub: 'Объем изменений - количество изменений в коде', color: 'var(--primary-accent)', description: 'Сколько раз трогали данную компоненту в коде' },
                        { label: 'Инциденты', value: stats.totalIncidents, sub: 'Уникальные баги - количество задач "Ошибка кода"', color: 'var(--error)', description: 'Крит. зоны для QA. Где чаще ломается — там нужнее автотесты.' },
                        { label: 'Время', value: formatSeconds(stats.totalTime), sub: 'Стоимость правок - время потраченное на тип задачи "Ошибка кода"', color: 'var(--primary-accent)', description: 'Оценка выгоды от автоматизации регрессии этих блоков.' }
                    ].map((stat, i) => (
                        <div key={i} style={{
                            backgroundColor: 'var(--bg-content)',
                            borderRadius: '16px',
                            padding: '20px',
                            border: '1px solid var(--border-color)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                            borderLeft: `4px solid ${stat.color}`
                        }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>{stat.label}</div>
                            <div style={{ fontSize: '28px', fontWeight: 800, color: stat.color, marginBottom: '4px' }}>{stat.value}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '12px' }}>{stat.sub}</div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                                lineHeight: '1.4',
                                padding: '10px',
                                backgroundColor: 'var(--bg-input)',
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
                    backgroundColor: 'var(--bg-content)',
                    padding: '32px',
                    borderRadius: '24px',
                    border: '1px solid var(--border-color)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                    marginBottom: '40px'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <h2 style={styles.subHeader}>
                                Импакт-анализ компонентов
                            </h2>
                            <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                                Распределение влияния по программным элементам
                            </p>
                        </div>
                        <MetricToggle />
                    </div>


                    <div style={{ maxHeight: showAllCode ? '600px' : 'none', overflowY: showAllCode ? 'auto' : 'visible', marginBottom: '32px', paddingRight: showAllCode ? '4px' : '0' }}>
                        <div style={{ height: showAllCode ? `${Math.max(400, codeChartData.length * 30)}px` : '400px', width: '100%', transition: 'height 0.3s ease' }}>
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
                                        tick={{ fill: 'var(--text-secondary)', fontWeight: 600 }}
                                        tickFormatter={(value) => value.length > 20 ? value.substring(0, 18) + '...' : value}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-input)' }} />
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
                    </div>

                    <div style={{ maxHeight: showAllCode ? '600px' : 'none', overflowY: showAllCode ? 'auto' : 'visible', paddingRight: showAllCode ? '8px' : '0' }}>
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
                                        border: `1px solid ${selectedComponent === item.name ? 'var(--primary-accent)' : 'var(--border-color)'}`,
                                        backgroundColor: selectedComponent === item.name ? 'color-mix(in srgb, var(--primary-accent) 8%, var(--bg-content))' : 'var(--bg-content)',
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
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.name}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', paddingLeft: '16px' }}>
                                        {activeMetric === 'time' ? formatSeconds(item.value) : item.value} ({item.percentage}%)
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    {heatmapData?.components?.length > 15 && (
                        <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center' }}>
                            <button
                                onClick={() => setShowAllCode(!showAllCode)}
                                style={{
                                    padding: '10px 24px',
                                    backgroundColor: 'var(--bg-input)',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '12px',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}
                                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--border-color)', e.currentTarget.style.color = 'var(--text-primary)')}
                                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-input)', e.currentTarget.style.color = 'var(--text-secondary)')}
                            >
                                {showAllCode ? '▲ Свернуть "Прочее"' : '▼ Развернуть "Прочее"'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Статистика по Страницам */}
            {
                !loading && !error && activeTab === 'code' && testCoverageData?.pages && testCoverageData.pages.length > 0 && (
                    <div style={{
                        backgroundColor: 'var(--bg-content)',
                        padding: '32px',
                        borderRadius: '24px',
                        border: '1px solid var(--border-color)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                        marginBottom: '40px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <h2 style={styles.subHeader}>
                                    {side === 'backend' ? 'Влияние на контроллеры (Импакт)' : 'Влияние на страницы (Импакт)'}
                                </h2>
                                <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                                    {side === 'backend' ? 'Распределение связей между сервисами и эндпоинтами' : 'Распределение связей между компонентами и страницами приложения'}
                                </p>
                            </div>

                            {side === 'backend' && (
                                <div style={{
                                    display: 'flex',
                                    backgroundColor: 'var(--bg-input)',
                                    borderRadius: '12px',
                                    padding: '4px',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <button
                                        onClick={() => setGroupingType('controller')}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            backgroundColor: groupingType === 'controller' ? 'var(--bg-content)' : 'transparent',
                                            color: groupingType === 'controller' ? 'var(--primary-accent)' : 'var(--text-muted)',
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            cursor: 'pointer',
                                            boxShadow: groupingType === 'controller' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        Контроллеры
                                    </button>
                                    <button
                                        onClick={() => setGroupingType('method')}
                                        style={{
                                            padding: '8px 16px',
                                            borderRadius: '8px',
                                            border: 'none',
                                            backgroundColor: groupingType === 'method' ? 'var(--bg-content)' : 'transparent',
                                            color: groupingType === 'method' ? 'var(--primary-accent)' : 'var(--text-muted)',
                                            fontWeight: 600,
                                            fontSize: '13px',
                                            cursor: 'pointer',
                                            boxShadow: groupingType === 'method' ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        Методы API
                                    </button>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
                            <div style={{ flex: '0 0 400px', height: '400px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{
                                    position: 'absolute',
                                    textAlign: 'center',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    zIndex: 1,
                                    pointerEvents: 'none'
                                }}>
                                    <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', lineHeight: 1.2 }}>ПЛОТНОСТЬ</span>
                                    <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-muted)', lineHeight: 1.2 }}>МАППИНГА</span>
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
                                            border: '1px solid var(--border-color)',
                                            backgroundColor: 'var(--bg-content)',
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

                                        <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.name}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--primary-accent)', fontWeight: 600 }}>
                                            {activeMetric === 'time' && <span>⏱</span>}
                                            {activeMetric === 'time' ? formatSeconds(item.value) : item.value}
                                            <span style={{ color: 'var(--text-placeholder)', fontWeight: 400 }}>({item.percentage}%)</span>
                                        </div>

                                        {item.url && (
                                            <div style={{ fontSize: '10px', color: 'var(--text-placeholder)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {item.url}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {processedPagesData?.length > 15 && (
                            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center' }}>
                                <button
                                    onClick={() => setShowAllPages(!showAllPages)}
                                    style={{
                                        padding: '10px 24px',
                                        backgroundColor: 'var(--bg-input)',
                                        color: 'var(--text-secondary)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '12px',
                                        fontWeight: 600,
                                        fontSize: '13px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--border-color)', e.currentTarget.style.color = 'var(--text-primary)')}
                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-input)', e.currentTarget.style.color = 'var(--text-secondary)')}
                                >
                                    {showAllPages ? '▲ Свернуть "Прочее"' : '▼ Развернуть "Прочее"'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

            {/* Test Coverage визуализация */}
            {
                activeTab === 'test' && !loading && !error && testCoverageData && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                        {/* Приоритезация функциональных блоков */}
                        <div style={{
                            backgroundColor: 'var(--bg-content)',
                            padding: '32px',
                            borderRadius: '24px',
                            border: '1px solid var(--border-color)',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <h2 style={styles.subHeader}>
                                        Приоритезация функциональных блоков
                                    </h2>
                                    <p style={{ fontSize: '14px', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                                        Ранжирование по приоритету (Инциденты + Время)
                                    </p>
                                </div>
                                <MetricToggle />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                                <div style={{ maxHeight: showAllFb ? '600px' : 'none', overflowY: showAllFb ? 'auto' : 'visible', paddingRight: showAllFb ? '4px' : '0' }}>
                                    <div style={{ height: showAllFb ? `${Math.max(400, fbChartData.length * 30)}px` : '400px', width: '100%', transition: 'height 0.3s ease' }}>
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
                                                    tick={{ fill: 'var(--text-secondary)', fontWeight: 600 }}
                                                    tickFormatter={(value) => value.length > 25 ? value.substring(0, 23) + '...' : value}
                                                />
                                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-input)' }} />
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
                                </div>


                                <div style={{ maxHeight: showAllFb ? '600px' : 'none', overflowY: showAllFb ? 'auto' : 'visible', paddingRight: showAllFb ? '8px' : '0' }}>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                        gap: '12px'
                                    }}>
                                        {[...(testCoverageData?.functionalBlocks || [])]
                                            .map(fb => ({ ...fb, priorityScore: calculatePriorityScore(fb) }))
                                            .sort((a, b) => b.priorityScore - a.priorityScore)
                                            .slice(0, showAllFb ? undefined : 20)
                                            .map((fb, idx) => {
                                                const entryColor = fbChartData.find(p => p.name === fb.functionalBlockName)?.color || 'var(--text-placeholder)';
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
                                                            border: `1px solid ${selectedComponent === fb.functionalBlockName ? 'var(--primary-accent)' : 'var(--border-color)'}`,
                                                            backgroundColor: selectedComponent === fb.functionalBlockName ? 'color-mix(in srgb, var(--primary-accent) 8%, var(--bg-content))' : 'var(--bg-content)',
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
                                                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {fb.functionalBlockName}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', paddingLeft: '16px' }}>
                                                            {activeMetric === 'time' ? formatSeconds(value) : value} ({percentage}%)
                                                            <span style={{ marginLeft: '8px', color: 'var(--text-placeholder)', fontSize: '10px' }}>Priority: {fb.priorityScore.toFixed(0)}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                                {testCoverageData?.functionalBlocks?.length > 20 && (
                                    <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => setShowAllFb(!showAllFb)}
                                            style={{
                                                padding: '10px 24px',
                                                backgroundColor: 'var(--bg-input)',
                                                color: 'var(--text-secondary)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: '12px',
                                                fontWeight: 600,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}
                                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--border-color)', e.currentTarget.style.color = 'var(--text-primary)')}
                                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-input)', e.currentTarget.style.color = 'var(--text-secondary)')}
                                        >
                                            {showAllFb ? '▲ Свернуть "Прочее"' : '▼ Развернуть "Прочее"'}
                                        </button>
                                    </div>
                                )}
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
                        backgroundColor: 'var(--bg-content)',
                        width: '600px',
                        borderRadius: '24px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        overflow: 'hidden',
                        fontFamily: '"Inter", sans-serif'
                    }}>
                        <div style={{
                            padding: '24px 32px',
                            borderBottom: '1px solid var(--border-color)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'var(--bg-input)'
                        }}>
                            <h2 style={styles.subHeader}>Загрузка истории TIA</h2>
                            <button
                                onClick={() => setShowImportModal(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    fontSize: '24px',
                                    color: 'var(--text-placeholder)',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'color 0.2s'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                                onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-placeholder)'}
                            >х</button>
                        </div>

                        <div style={{ padding: '32px' }}>
                            <p style={{ marginBottom: '24px', color: 'var(--text-muted)', fontSize: '14px', lineHeight: '1.6' }}>
                                Выберите файлы отчетов в формате JSON для массового импорта истории дефектов и привязки их к текущему проекту.
                            </p>

                            <div style={{
                                position: 'relative',
                                marginBottom: '24px',
                                border: '2px dashed var(--border-color)',
                                borderRadius: '16px',
                                padding: '40px 20px',
                                textAlign: 'center',
                                transition: 'all 0.2s ease',
                                backgroundColor: 'var(--bg-input)',
                                cursor: 'pointer'
                            }}
                                onMouseOver={(e) => (e.currentTarget.style.borderColor = 'var(--border-focus)', e.currentTarget.style.backgroundColor = 'var(--bg-input)')}
                                onMouseOut={(e) => (e.currentTarget.style.borderColor = 'var(--border-color)', e.currentTarget.style.backgroundColor = 'var(--bg-input)')}
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

                                <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                    {importFiles.length > 0 ? `Выбрано файлов: ${importFiles.length}` : 'Нажмите для выбора JSON файлов'}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-placeholder)' }}>Перетащите файлы сюда или кликните для обзора</div>
                            </div>

                            {importProcessing && (
                                <div style={{
                                    padding: '20px',
                                    backgroundColor: 'var(--bg-main)',
                                    borderRadius: '12px',
                                    maxHeight: '180px',
                                    overflowY: 'auto',
                                    marginBottom: '24px',
                                    fontSize: '13px',
                                    fontFamily: '"SF Mono", "Fira Code", monospace',
                                    color: 'var(--primary-accent)',
                                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)'
                                }}>
                                    {importLog.map((log, i) => (
                                        <div key={i} style={{ marginBottom: '4px', opacity: i === importLog.length - 1 ? 1 : 0.7 }}>
                                            <span style={{ color: 'var(--text-muted)' }}>[{new Date().toLocaleTimeString()}]</span> {log}
                                        </div>
                                    ))}
                                    <div id="import-log-end" />
                                </div>
                            )}

                            {importError && (
                                <div style={{
                                    padding: '16px',
                                    backgroundColor: 'var(--error-bg)',
                                    border: '1px solid var(--error)',
                                    borderRadius: '12px',
                                    color: 'var(--error)',
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
                                        backgroundColor: 'var(--bg-content)',
                                        color: 'var(--text-muted)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '12px',
                                        fontWeight: 600,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-input)', e.currentTarget.style.borderColor = 'var(--border-focus)')}
                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-content)', e.currentTarget.style.borderColor = 'var(--border-color)')}
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
                                        backgroundColor: 'var(--primary-accent)',
                                        color: 'var(--bg-content)',
                                        border: 'none',
                                        borderRadius: '12px',
                                        fontWeight: 700,
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)',
                                        transition: 'all 0.2s',
                                        opacity: (importFiles.length === 0 || importProcessing) ? 0.6 : 1
                                    }}
                                    onMouseOver={(e) => (importFiles.length > 0 && !importProcessing) && (e.currentTarget.style.backgroundColor = 'var(--primary-hover)', e.currentTarget.style.transform = 'translateY(-1px)')}
                                    onMouseOut={(e) => (importFiles.length > 0 && !importProcessing) && (e.currentTarget.style.backgroundColor = 'var(--primary-accent)', e.currentTarget.style.transform = 'translateY(0)')}
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
                        backgroundColor: 'rgba(15, 23, 42, 0.6)',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 2000,
                        animation: 'fadeIn 0.2s ease-out',
                    }}>
                        <div style={{
                            backgroundColor: 'var(--bg-content)',
                            width: '1300px',
                            maxWidth: '96vw',
                            height: '92vh',
                            borderRadius: '32px',
                            boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.4)',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column',
                            fontFamily: '"Inter", sans-serif',
                            border: '1px solid var(--border-color)',
                            animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                        }}>
                            <div style={{
                                padding: '32px 40px',
                                borderBottom: '1px solid var(--border-color)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                background: 'linear-gradient(to right, var(--bg-content), var(--bg-input))',
                                position: 'relative'
                            }}>
                                <div>
                                    <h2 style={{
                                        ...styles.subHeader,
                                        fontSize: '24px',
                                        fontWeight: 800,
                                        margin: 0,
                                        background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        letterSpacing: '-0.02em'
                                    }}>Маппинг компонентов</h2>
                                    <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '6px', fontWeight: 500 }}>
                                        Свяжите импортируемые компоненты с функциональными блоками Allure для точной аналитики
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <button
                                        onClick={() => setShowMappingModal(false)}
                                        style={{
                                            padding: '0 24px',
                                            height: '46px',
                                            backgroundColor: 'var(--bg-content)',
                                            color: 'var(--text-secondary)',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '14px',
                                            fontWeight: 700,
                                            fontSize: '14px',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                                        }}
                                        onMouseOver={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--bg-input)';
                                            e.currentTarget.style.borderColor = 'var(--border-focus)';
                                            e.currentTarget.style.transform = 'translateY(-1px)';
                                        }}
                                        onMouseOut={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--bg-content)';
                                            e.currentTarget.style.borderColor = 'var(--border-color)';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                        }}
                                    >
                                        <span style={{ fontSize: '18px' }}>←</span>
                                        Назад к файлам
                                    </button>

                                    <button
                                        onClick={() => setShowMappingModal(false)}
                                        style={{
                                            background: 'var(--bg-input)',
                                            border: '1px solid var(--border-color)',
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '12px',
                                            fontSize: '24px',
                                            color: 'var(--text-placeholder)',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={(e) => {
                                            e.currentTarget.style.color = 'var(--error)';
                                            e.currentTarget.style.backgroundColor = 'var(--error-bg)';
                                            e.currentTarget.style.borderColor = 'var(--error)';
                                        }}
                                        onMouseOut={(e) => {
                                            e.currentTarget.style.color = 'var(--text-placeholder)';
                                            e.currentTarget.style.backgroundColor = 'var(--bg-input)';
                                            e.currentTarget.style.borderColor = 'var(--border-color)';
                                        }}
                                    >×</button>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', backgroundColor: 'var(--bg-main)' }}>
                                {/* Левая панель: Список компонентов */}
                                <div style={{
                                    width: '400px',
                                    borderRight: '1px solid var(--border-color)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    backgroundColor: 'var(--bg-input)',
                                    position: 'relative',
                                    zIndex: 10
                                }}>
                                    <div style={{ padding: '24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="text"
                                                placeholder="Поиск компонента..."
                                                value={mappingFilter}
                                                onChange={(e) => setMappingFilter(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '14px 16px 14px 40px',
                                                    borderRadius: '14px',
                                                    border: '1px solid var(--border-color)',
                                                    fontSize: '14px',
                                                    outline: 'none',
                                                    backgroundColor: 'var(--bg-content)',
                                                    color: 'var(--text-primary)',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                                    transition: 'all 0.2s'
                                                }}
                                                onFocus={(e) => e.target.style.borderColor = 'var(--primary-accent)'}
                                                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                                            />

                                        </div>
                                    </div>
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-content)' }}>
                                    <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-content)' }}>
                                        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                                                    {selectedComponentForMapping ? (
                                                        <>
                                                            Маппинг для: <span style={{ color: 'var(--primary-accent)' }}>{selectedComponentForMapping.split('/').pop()}</span>
                                                        </>
                                                    ) : 'Выберите компонент слева'}
                                                </h3>
                                                {selectedComponentForMapping && selectedComponentForMapping.includes('/') && (
                                                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                                        {selectedComponentForMapping}
                                                    </div>
                                                )}
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                {selectedComponentForMapping && (
                                                    <div style={{
                                                        padding: '6px 14px',
                                                        backgroundColor: 'var(--bg-input)',
                                                        borderRadius: '10px',
                                                        fontSize: '13px',
                                                        color: 'var(--primary-accent)',
                                                        fontWeight: 700,
                                                        border: '1px solid var(--border-color)'
                                                    }}>
                                                        {(componentMappings[selectedComponentForMapping] || []).filter(id => id).length} привязано
                                                    </div>
                                                )}
                                                <div
                                                    title="Подсказка по маппингу:\n• Один клик — выбрать/убрать текущий элемент\n• Двойной клик — выбрать/убрать элемент со всеми вложенными"
                                                    style={{
                                                        cursor: 'help',
                                                        fontSize: '18px',
                                                        backgroundColor: 'var(--bg-input)',
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '12px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        border: '1px solid var(--border-color)',
                                                        transition: 'all 0.2s',
                                                        visibility: selectedComponentForMapping ? 'visible' : 'hidden'
                                                    }}
                                                    onMouseOver={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'var(--bg-content)';
                                                        e.currentTarget.style.borderColor = 'var(--primary-accent)';
                                                        e.currentTarget.style.transform = 'scale(1.05)';
                                                    }}
                                                    onMouseOut={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'var(--bg-input)';
                                                        e.currentTarget.style.borderColor = 'var(--border-color)';
                                                        e.currentTarget.style.transform = 'scale(1)';
                                                    }}
                                                >
                                                    💡
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="text"
                                                placeholder="Поиск по дереву функциональных блоков..."
                                                value={folderSearchTerm}
                                                onChange={(e) => setFolderSearchTerm(e.target.value)}
                                                disabled={!selectedComponentForMapping}
                                                style={{
                                                    width: '100%',
                                                    padding: '14px 16px 14px 40px',
                                                    borderRadius: '14px',
                                                    border: '1px solid var(--border-color)',
                                                    fontSize: '14px',
                                                    outline: 'none',
                                                    backgroundColor: !selectedComponentForMapping ? 'var(--bg-input)' : 'var(--bg-content)',
                                                    color: 'var(--text-primary)',
                                                    transition: 'all 0.2s'
                                                }}
                                                onFocus={(e) => e.target.style.borderColor = 'var(--primary-accent)'}
                                                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                                            />
                                        </div>
                                    </div>
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '32px', background: 'var(--bg-content)' }}>
                                        {selectedComponentForMapping ? (
                                            <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                                                {renderFolderTreeForMapping(
                                                    filterFolders(filterFoldersForProject(folders), folderSearchTerm),
                                                    selectedComponentForMapping
                                                )}
                                            </div>
                                        ) : (
                                            <div style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                height: '100%',
                                                color: 'var(--text-placeholder)',
                                                gap: '16px'
                                            }}>
                                                <div style={{ textAlign: 'center' }}>
                                                    <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>Выберите компонент</div>
                                                    <div style={{ fontSize: '14px' }}>Выберите элемент из списка слева, чтобы настроить его связи</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div style={{
                                padding: '24px 40px',
                                backgroundColor: 'var(--bg-input)',
                                borderTop: '1px solid var(--border-color)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>
                                    {Object.keys(componentMappings).length} компонентов настроено
                                </div>

                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <button
                                        onClick={() => handleSaveBulkHistory(false)}
                                        disabled={loading}
                                        style={{
                                            padding: '0 32px',
                                            height: '52px',
                                            backgroundColor: 'var(--success)',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '16px',
                                            fontWeight: 700,
                                            fontSize: '15px',
                                            cursor: loading ? 'not-allowed' : 'pointer',
                                            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                                            boxShadow: '0 8px 16px -4px rgba(16, 185, 129, 0.3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px'
                                        }}
                                        onMouseOver={(e) => !loading && (e.currentTarget.style.backgroundColor = '#059669', e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 12px 20px -4px rgba(16, 185, 129, 0.4)')}
                                        onMouseOut={(e) => !loading && (e.currentTarget.style.backgroundColor = 'var(--success)', e.currentTarget.style.transform = 'translateY(0)', e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(16, 185, 129, 0.3)')}
                                    >
                                        <span>Завершить импорт и маппинг</span>
                                        {loading && <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />}
                                    </button>
                                </div>
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
                        zIndex: 2100,
                        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                    }}>
                        <div style={{
                            backgroundColor: 'var(--bg-content)',
                            borderRadius: '16px',
                            width: '600px',
                            maxWidth: '90vw',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                            overflow: 'hidden',
                            animation: 'fadeIn 0.2s ease-out'
                        }}>
                            <div style={{
                                padding: '24px 28px',
                                borderBottom: '1px solid var(--error)',
                                backgroundColor: 'var(--bg-content)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px'
                            }}>
                                {/* */}
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        Незамапленные компоненты
                                    </h3>
                                    <div style={{ fontSize: '14px', color: 'var(--error)', marginTop: '4px', fontWeight: 500 }}>
                                        Требуется подтверждение действия
                                    </div>
                                </div>
                            </div>

                            <div style={{ padding: '28px' }}>
                                <p style={{ margin: '0 0 20px', fontSize: '15px', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                                    Вы не связали следующие компоненты ({unmappedList.length}) с функциональными блоками Allure.
                                    <br />
                                    <strong>Вы уверены, что хотите сохранить историю без привязки этих компонентов?</strong>
                                </p>

                                <div style={{
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    backgroundColor: 'var(--bg-input)'
                                }}>
                                    <ul style={{ margin: 0, padding: '8px 0', listStyle: 'none' }}>
                                        {unmappedList.map((comp, idx) => (
                                            <li key={idx} style={{
                                                padding: '10px 16px',
                                                marginBottom: '6px',
                                                fontSize: '14px',
                                                backgroundColor: 'var(--bg-elevated)',
                                                color: 'var(--text-primary)',
                                                borderRadius: '10px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                                border: '1px solid var(--border-color)',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                            }}>
                                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--error)', flexShrink: 0, boxShadow: '0 0 8px color-mix(in srgb, var(--error) 50%, transparent)' }} />
                                                <span style={{ fontWeight: 600 }}>{comp.name}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div style={{
                                padding: '20px 28px',
                                backgroundColor: 'var(--bg-input)',
                                borderTop: '1px solid var(--border-color)',
                                display: 'flex',
                                justifyContent: 'flex-end',
                                gap: '12px'
                            }}>
                                <button
                                    onClick={() => setShowUnmappedConfirmation(false)}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'var(--bg-content)',
                                        color: 'var(--text-secondary)',
                                        fontSize: '14px',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-input)'}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-content)'}
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
                                        backgroundColor: 'var(--error)',
                                        color: '#fff',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 6px rgba(220, 38, 38, 0.2)',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--error) 85%, black)'}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--error)'}
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
