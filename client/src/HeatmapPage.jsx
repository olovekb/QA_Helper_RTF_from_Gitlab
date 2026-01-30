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
                        width: '1000px',
                        maxWidth: '95vw',
                        maxHeight: '90vh',
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
                                    padding: '4px'
                                }}
                            >©</button>
                        </div>

                        <div style={{ padding: '32px', overflowY: 'auto', flex: 1, backgroundColor: '#f8fafc' }}>
                            <div style={{
                                backgroundColor: '#fff',
                                borderRadius: '16px',
                                border: '1px solid #e2e8f0',
                                overflow: 'hidden',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                            }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ backgroundColor: '#fcfdfe' }}>
                                        <tr>
                                            <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>Компонент</th>
                                            <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: '13px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>Функциональные блоки Allure</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...unmappedComponents, ...Object.keys(componentMappings)].sort().map((compName, idx) => (
                                            <tr key={compName} style={{
                                                backgroundColor: idx % 2 === 0 ? '#fff' : '#fcfdfe',
                                                transition: 'background-color 0.2s'
                                            }}>
                                                <td style={{ padding: '16px 20px', fontWeight: 600, color: '#1e293b', fontSize: '14px', borderBottom: '1px solid #f1f5f9' }}>
                                                    {compName}
                                                </td>
                                                <td style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
                                                    <Select
                                                        isMulti
                                                        options={(folders || []).map(f => ({ value: f.id, label: f.name }))}
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
                                                        placeholder="Выберите блоки для привязки..."
                                                        styles={{
                                                            control: (base, state) => ({
                                                                ...base,
                                                                borderColor: state.isFocused ? '#6366f1' : '#e2e8f0',
                                                                borderRadius: '10px',
                                                                fontSize: '13px',
                                                                minHeight: '40px',
                                                                backgroundColor: state.isFocused ? '#fff' : '#fcfdfe',
                                                                boxShadow: state.isFocused ? '0 0 0 3px rgba(99, 102, 241, 0.1)' : 'none',
                                                            }),
                                                            multiValue: (base) => ({
                                                                ...base,
                                                                backgroundColor: '#eff6ff',
                                                                borderRadius: '6px',
                                                                border: '1px solid #dbeafe'
                                                            }),
                                                            multiValueLabel: (base) => ({ ...base, color: '#1e3a8a', fontWeight: 600 }),
                                                        }}
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style={{
                            padding: '24px 32px',
                            borderTop: '1px solid #e2e8f0',
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: '12px',
                            background: '#fcfdfe'
                        }}>
                            <button
                                onClick={() => setShowMappingModal(false)}
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
                            >
                                Назад к выбору файлов
                            </button>
                            <button
                                onClick={handleSaveBulkHistory}
                                disabled={loading}
                                style={{
                                    padding: '0 32px',
                                    height: '48px',
                                    backgroundColor: '#10b981',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '12px',
                                    fontWeight: 700,
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)',
                                    transition: 'all 0.2s',
                                    opacity: loading ? 0.6 : 1
                                }}
                                onMouseOver={(e) => !loading && (e.currentTarget.style.backgroundColor = '#059669', e.currentTarget.style.transform = 'translateY(-1px)')}
                                onMouseOut={(e) => !loading && (e.currentTarget.style.backgroundColor = '#10b981', e.currentTarget.style.transform = 'translateY(0)')}
                            >
                                {loading ? 'Сохранение...' : 'Завершить импорт и маппинг'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HeatmapPage;

