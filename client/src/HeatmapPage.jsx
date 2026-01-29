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
    const [parsedHistoryItems, setParsedHistoryItems] = useState([]);

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

    // Загрузка структуры Allure для маппинга
    const fetchFolders = async () => {
        if (!projectId) return;
        try {
            const response = await axios.get(`${config.structureUrl}/folders?projectId=${projectId}`);
            setFolders(response.data);
        } catch (err) {
            console.error('Ошибка при загрузке структуры Allure:', err);
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

                const componentsObj = json.unique_affected_components || {};
                Object.keys(componentsObj).forEach(compName => {
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

            componentNames.forEach(name => {
                const found = existingMappings.filter(m => m.component_name === name);
                if (found.length > 0) {
                    // Используем Set для того чтобы не дублировать ID
                    const blockIds = [...new Set(found.map(m => m.functional_block_id))];
                    mappingsMap[name] = blockIds;
                } else {
                    unmapped.push(name);
                }
            });

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

    const handleSaveBulkHistory = async () => {
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
        <div style={{ ...styles.container, padding: '24px' }}>
            <h1 style={{ ...styles.header, marginBottom: '24px' }}>
                3.2. Тепловая карта дефектов
            </h1>

            {/* Вкладки */}
            <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '24px',
                borderBottom: `2px solid ${styles.borderLight}`,
            }}>
                <button
                    onClick={() => setActiveTab('code')}
                    style={{
                        padding: '12px 24px',
                        border: 'none',
                        borderBottom: activeTab === 'code' ? `3px solid ${styles.primary}` : '3px solid transparent',
                        backgroundColor: 'transparent',
                        color: activeTab === 'code' ? styles.primary : '#666',
                        fontSize: '16px',
                        fontWeight: activeTab === 'code' ? 600 : 400,
                        cursor: 'pointer',
                    }}
                >
                    Code Coverage
                </button>
                <button
                    onClick={() => setActiveTab('test')}
                    style={{
                        padding: '12px 24px',
                        border: 'none',
                        borderBottom: activeTab === 'test' ? `3px solid ${styles.primary}` : '3px solid transparent',
                        backgroundColor: 'transparent',
                        color: activeTab === 'test' ? styles.primary : '#666',
                        fontSize: '16px',
                        fontWeight: activeTab === 'test' ? 600 : 400,
                        cursor: 'pointer',
                    }}
                >
                    Test Coverage
                </button>
            </div>

            {/* Фильтры и действия */}
            <div style={{
                backgroundColor: '#fff',
                padding: '24px',
                borderRadius: '12px',
                marginBottom: '24px',
                border: `1px solid ${styles.borderLight}`,
                boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
            }}>
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '24px',
                    alignItems: 'flex-start'
                }}>
                    {/* Выбор проекта */}
                    <div style={{ flex: '1 1 200px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontWeight: 600,
                            color: '#333',
                            fontSize: '14px'
                        }}>
                            Проект:
                        </label>
                        <select
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: `1px solid ${styles.borderLight}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                backgroundColor: '#fff',
                                color: '#000',
                                height: '42px',
                            }}
                        >
                            <option value="">Выберите проект</option>
                            {projects?.map(project => (
                                <option key={project.id} value={project.id}>
                                    {project.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Диапазон дат */}
                    <div style={{ flex: '2 1 350px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontWeight: 600,
                            color: '#333',
                            fontSize: '14px'
                        }}>
                            Диапазон дат (необязательно):
                        </label>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: '10px 12px',
                                    border: `1px solid ${styles.borderLight}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    height: '42px',
                                }}
                            />
                            <span style={{ color: '#666', fontWeight: 600 }}>—</span>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                style={{
                                    flex: 1,
                                    padding: '10px 12px',
                                    border: `1px solid ${styles.borderLight}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    height: '42px',
                                }}
                            />
                        </div>
                    </div>

                    {/* Версии релизов */}
                    <div style={{ flex: '1.5 1 250px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontWeight: 600,
                            color: '#333',
                            fontSize: '14px'
                        }}>
                            Версии релизов:
                        </label>
                        <Select
                            isMulti
                            options={versionOptions}
                            value={selectedVersions.map(v => ({ value: v, label: v }))}
                            onChange={handleVersionChange}
                            placeholder="Выберите версии..."
                            isClearable
                            styles={{
                                control: (base) => ({
                                    ...base,
                                    borderColor: styles.borderLight,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    minHeight: '42px',
                                    boxShadow: 'none',
                                }),
                            }}
                        />
                    </div>

                    {/* Тип */}
                    <div style={{ flex: '1 1 150px' }}>
                        <label style={{
                            display: 'block',
                            marginBottom: '8px',
                            fontWeight: 600,
                            color: '#333',
                            fontSize: '14px'
                        }}>
                            Тип:
                        </label>
                        <select
                            value={isBugFix === null ? 'all' : isBugFix ? 'bugs' : 'general'}
                            onChange={(e) => {
                                const value = e.target.value;
                                setIsBugFix(value === 'all' ? null : value === 'bugs');
                            }}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: `1px solid ${styles.borderLight}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                backgroundColor: '#fff',
                                height: '42px',
                            }}
                        >
                            <option value="all">Все</option>
                            <option value="bugs">Только баги</option>
                            <option value="general">Общий</option>
                        </select>
                    </div>

                    {/* Кнопка импорта */}
                    <div style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
                        <button
                            onClick={() => setShowImportModal(true)}
                            disabled={!projectId}
                            style={{
                                ...styles.submitButton,
                                padding: '10px 20px',
                                height: '42px',
                                backgroundColor: '#6f42c1', // Purple for history import
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <span>📅</span> Загрузить историю
                        </button>
                    </div>
                </div>
            </div>

            {/* График и легенда */}
            {loading && (
                <div style={{ textAlign: 'center', padding: '40px', color: '#000' }}>
                    Загрузка данных...
                </div>
            )}

            {error && (
                <div style={{
                    backgroundColor: '#fff5f5',
                    border: '1px solid #dc3545',
                    borderRadius: '8px',
                    padding: '16px',
                    marginBottom: '24px',
                    color: '#dc3545',
                }}>
                    {error}
                </div>
            )}

            {!loading && !error && activeTab === 'code' && heatmapData && (
                <div style={{
                    backgroundColor: '#fff',
                    padding: '24px',
                    borderRadius: '8px',
                    border: `1px solid ${styles.borderLight}`,
                }}>
                    <h2 style={{ ...styles.subHeader, marginBottom: '16px' }}>
                        Тепловая карта дефектов
                    </h2>

                    <div style={{
                        display: 'flex',
                        gap: '32px',
                        flexWrap: 'nowrap',
                        alignItems: 'flex-start'
                    }}>
                        {/* Donut Chart */}
                        <div style={{
                            flex: '0 0 500px',
                            width: '500px',
                            maxWidth: '100%'
                        }}>
                            <ResponsiveContainer width="100%" height={400}>
                                <PieChart>
                                    <Pie
                                        data={chartData}
                                        cx="50%"
                                        cy="50%"
                                        labelLine={false}
                                        label={renderCustomLabel}
                                        outerRadius={120}
                                        innerRadius={60}
                                        fill="#8884d8"
                                        dataKey="value"
                                        onClick={(data) => setSelectedComponent(data.name)}
                                    >
                                        {chartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={entry.color}
                                                style={{
                                                    cursor: 'pointer',
                                                    filter: selectedComponent === entry.name ? 'brightness(1.2)' : 'none',
                                                }}
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<CustomTooltip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{
                                textAlign: 'center',
                                marginTop: '16px',
                                fontSize: '24px',
                                fontWeight: 700,
                                color: '#000',
                            }}>
                                {heatmapData.totalDefects.toLocaleString()}
                            </div>
                            <div style={{
                                textAlign: 'center',
                                marginTop: '4px',
                                fontSize: '14px',
                                color: '#000',
                            }}>
                                Всего дефектов
                            </div>
                        </div>

                        {/* Легенда */}
                        <div style={{
                            flex: '1 1 auto',
                            minWidth: '300px',
                            maxHeight: '500px',
                            overflowY: 'auto',
                            overflowX: 'hidden'
                        }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                gap: '8px',
                                fontSize: '12px',
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
                                                gap: '8px',
                                                padding: '6px 8px',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                backgroundColor: isSelected ? '#f0f0f0' : 'transparent',
                                                border: isSelected ? `2px solid ${color}` : '1px solid transparent',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: '12px',
                                                    height: '12px',
                                                    borderRadius: '2px',
                                                    backgroundColor: color,
                                                    flexShrink: 0,
                                                }}
                                            />
                                            <span style={{
                                                flex: 1,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                color: '#000',
                                            }}>
                                                {item.componentName}
                                            </span>
                                            <span style={{
                                                fontWeight: 600,
                                                color: '#000',
                                                flexShrink: 0,
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
                            padding: '24px',
                            borderRadius: '8px',
                            border: `1px solid ${styles.borderLight}`,
                            flex: '1 1 0',
                            minWidth: '600px',
                        }}>
                            <h2 style={{ ...styles.subHeader, marginBottom: '16px' }}>
                                Test Coverage - Функциональные блоки
                            </h2>

                            <div style={{
                                display: 'flex',
                                gap: '32px',
                                flexWrap: 'nowrap',
                                alignItems: 'flex-start'
                            }}>
                                {/* Donut Chart для функциональных блоков */}
                                <div style={{
                                    flex: '0 0 400px',
                                    width: '400px',
                                    maxWidth: '100%'
                                }}>
                                    <ResponsiveContainer width="100%" height={400}>
                                        <PieChart>
                                            <Pie
                                                data={testCoverageChartData}
                                                cx="50%"
                                                cy="50%"
                                                labelLine={false}
                                                label={renderCustomLabel}
                                                outerRadius={120}
                                                innerRadius={60}
                                                fill="#8884d8"
                                                dataKey="value"
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
                                        textAlign: 'center',
                                        marginTop: '16px',
                                        fontSize: '24px',
                                        fontWeight: 700,
                                        color: '#000',
                                    }}>
                                        {testCoverageData.totalDefects.toLocaleString()}
                                    </div>
                                    <div style={{
                                        textAlign: 'center',
                                        marginTop: '4px',
                                        fontSize: '14px',
                                        color: '#000',
                                    }}>
                                        Всего дефектов
                                    </div>
                                </div>

                                {/* Легенда для функциональных блоков */}
                                <div style={{
                                    flex: '1 1 auto',
                                    minWidth: '250px',
                                    maxHeight: '500px',
                                    overflowY: 'auto',
                                    overflowX: 'hidden'
                                }}>
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                        gap: '8px',
                                        fontSize: '12px',
                                    }}>
                                        {testCoverageData.functionalBlocks.map((item, index) => {
                                            const color = index < COLORS.length ? COLORS[index] : '#cccccc';
                                            return (
                                                <div
                                                    key={item.functionalBlockId}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        padding: '6px 8px',
                                                        borderRadius: '4px',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: '12px',
                                                            height: '12px',
                                                            borderRadius: '2px',
                                                            backgroundColor: color,
                                                            flexShrink: 0,
                                                        }}
                                                    />
                                                    <span style={{
                                                        flex: 1,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        color: '#000',
                                                    }}>
                                                        {item.functionalBlockName}
                                                    </span>
                                                    <span style={{
                                                        fontWeight: 600,
                                                        color: '#000',
                                                        flexShrink: 0,
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
                                padding: '24px',
                                borderRadius: '8px',
                                border: `1px solid ${styles.borderLight}`,
                                flex: '1 1 0',
                                minWidth: '600px',
                            }}>
                                <h2 style={{ ...styles.subHeader, marginBottom: '16px' }}>
                                    Test Coverage - Роуты
                                </h2>

                                <div style={{
                                    display: 'flex',
                                    gap: '32px',
                                    flexWrap: 'nowrap',
                                    alignItems: 'flex-start'
                                }}>
                                    {/* Donut Chart для роутов */}
                                    <div style={{
                                        flex: '0 0 400px',
                                        width: '400px',
                                        maxWidth: '100%'
                                    }}>
                                        <ResponsiveContainer width="100%" height={400}>
                                            <PieChart>
                                                <Pie
                                                    data={routesChartData}
                                                    cx="50%"
                                                    cy="50%"
                                                    labelLine={false}
                                                    label={renderCustomLabel}
                                                    outerRadius={120}
                                                    innerRadius={60}
                                                    fill="#8884d8"
                                                    dataKey="value"
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
                                            textAlign: 'center',
                                            marginTop: '16px',
                                            fontSize: '24px',
                                            fontWeight: 700,
                                            color: '#000',
                                        }}>
                                            {testCoverageData.totalRoutesDefects.toLocaleString()}
                                        </div>
                                        <div style={{
                                            textAlign: 'center',
                                            marginTop: '4px',
                                            fontSize: '14px',
                                            color: '#000',
                                        }}>
                                            Всего дефектов по роутам
                                        </div>
                                    </div>

                                    {/* Легенда для роутов */}
                                    <div style={{
                                        flex: '1 1 auto',
                                        minWidth: '250px',
                                        maxHeight: '500px',
                                        overflowY: 'auto',
                                        overflowX: 'hidden'
                                    }}>
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                            gap: '8px',
                                            fontSize: '12px',
                                        }}>
                                            {testCoverageData.routes.map((item, index) => {
                                                const color = index < COLORS.length ? COLORS[index] : '#cccccc';
                                                return (
                                                    <div
                                                        key={item.route}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            padding: '6px 8px',
                                                            borderRadius: '4px',
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                width: '12px',
                                                                height: '12px',
                                                                borderRadius: '2px',
                                                                backgroundColor: color,
                                                                flexShrink: 0,
                                                            }}
                                                        />
                                                        <span style={{
                                                            flex: 1,
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                            color: '#000',
                                                        }}>
                                                            {item.route}
                                                        </span>
                                                        <span style={{
                                                            fontWeight: 600,
                                                            color: '#000',
                                                            flexShrink: 0,
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
                <div style={styles.modalOverlay}>
                    <div style={{ ...styles.modalContent, width: '600px' }}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>Загрузка истории TIA (JSON)</h2>
                            <button onClick={() => setShowImportModal(false)} style={styles.closeButton}>×</button>
                        </div>
                        <div style={{ padding: '20px' }}>
                            <p style={{ marginBottom: '15px', color: '#666' }}>
                                Выберите один или несколько JSON-отчетов TIA для импорта истории дефектов.
                            </p>

                            <input
                                type="file"
                                multiple
                                accept=".json"
                                onChange={(e) => setImportFiles(Array.from(e.target.files))}
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    border: `2px dashed ${styles.borderLight}`,
                                    borderRadius: '8px',
                                    marginBottom: '20px',
                                    cursor: 'pointer'
                                }}
                            />

                            {importFiles.length > 0 && (
                                <div style={{ marginBottom: '20px' }}>
                                    <strong>Выбрано файлов: {importFiles.length}</strong>
                                </div>
                            )}

                            {importProcessing && (
                                <div style={{
                                    padding: '15px',
                                    backgroundColor: '#f8f9fa',
                                    borderRadius: '8px',
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    marginBottom: '20px',
                                    fontSize: '12px',
                                    fontFamily: 'monospace'
                                }}>
                                    {importLog.map((log, i) => <div key={i}>{log}</div>)}
                                </div>
                            )}

                            {importError && (
                                <div style={{ color: 'red', marginBottom: '20px' }}>{importError}</div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                <button
                                    onClick={() => setShowImportModal(false)}
                                    style={styles.cancelButton}
                                    disabled={importProcessing}
                                >
                                    Отмена
                                </button>
                                <button
                                    onClick={handleProcessFiles}
                                    disabled={importFiles.length === 0 || importProcessing}
                                    style={{
                                        ...styles.submitButton,
                                        opacity: (importFiles.length === 0 || importProcessing) ? 0.6 : 1
                                    }}
                                >
                                    {importProcessing ? 'Обработка...' : 'Начать обработку'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Модальное окно маппинга для импорта */}
            {showMappingModal && (
                <div style={styles.modalOverlay}>
                    <div style={{ ...styles.modalContent, width: '900px', maxWidth: '95vw', maxHeight: '90vh' }}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>Маппинг компонентов</h2>
                            <button onClick={() => setShowMappingModal(false)} style={styles.closeButton}>×</button>
                        </div>
                        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                            <p style={{ marginBottom: '15px' }}>
                                Для корректного отображения <strong>Test Coverage</strong> необходимо связать найденные компоненты с функциональными блоками Allure.
                            </p>

                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: `2px solid ${styles.borderLight}`, textAlign: 'left' }}>
                                        <th style={{ padding: '10px' }}>Компонент</th>
                                        <th style={{ padding: '10px' }}>Функциональные блоки Allure</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[...unmappedComponents, ...Object.keys(componentMappings)].sort().map(compName => (
                                        <tr key={compName} style={{ borderBottom: `1px solid ${styles.borderLight}` }}>
                                            <td style={{ padding: '10px', fontWeight: 600 }}>{compName}</td>
                                            <td style={{ padding: '10px' }}>
                                                <Select
                                                    isMulti
                                                    options={folders.map(f => ({ value: f.id, label: f.name }))}
                                                    value={(componentMappings[compName] || []).map(id => {
                                                        const folder = folders.find(f => f.id === id);
                                                        return { value: id, label: folder ? folder.name : id };
                                                    })}
                                                    onChange={(selected) => {
                                                        setComponentMappings(prev => ({
                                                            ...prev,
                                                            [compName]: selected ? selected.map(s => s.value) : []
                                                        }));
                                                    }}
                                                    placeholder="Выберите блоки..."
                                                    styles={{
                                                        control: (base) => ({ ...base, fontSize: '13px' })
                                                    }}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '20px', borderTop: `1px solid ${styles.borderLight}`, display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button
                                onClick={() => setShowMappingModal(false)}
                                style={styles.cancelButton}
                            >
                                Отмена
                            </button>
                            <button
                                onClick={handleSaveBulkHistory}
                                disabled={loading}
                                style={styles.submitButton}
                            >
                                {loading ? 'Сохранение...' : 'Завершить импорт'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HeatmapPage;

