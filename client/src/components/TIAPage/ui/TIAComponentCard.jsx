import React, { useState } from 'react';
import TIAStyles from '../styles/TIAStyles';
import { useTIA } from '../context/TIAContext';
import { isNewTiaFormat, formatCustomFieldName, findFolderById } from '../utils/tiaUtils';

/**
 * Компонент карточки компонента для интерфейса маппинга
 * 
 * @param {Object} props
 * @param {Object} props.component - Данные компонента
 * @param {boolean} props.isSelected - Выбрана ли карточка
 * @param {Function} props.onSelect - Обработчик выбора
 * @returns {JSX.Element}
 */
const TIAComponentCard = ({ component, isSelected, onSelect }) => {
    const [showAllMappings, setShowAllMappings] = useState(false);
    const {
        componentMappings,
        setComponentMappings,
        handleRemoveMapping,
        folders,
        expandedScenarios,
        setExpandedScenarios,
        toggleInheritance,
        disabledInheritance,
        setDisabledInheritance,
        setPartialSaveMessage,
        tiaReport,
        pageMappings,
        autoMappedBlocks,
        expandedTechnicalDetails,
        setExpandedTechnicalDetails,
        expandedPageLists,
        setExpandedPageLists
    } = useTIA();

    const globalReportPages = tiaReport?.summary?.pages || tiaReport?.pages || [];

    const mappings = componentMappings[component.id] || [];
    const hasDirectMapping = mappings.length > 0;

    const getPagesUsingComponent = (componentName) => {
        if (!tiaReport || !isNewTiaFormat(tiaReport)) return [];
        return globalReportPages.filter(page =>
            (page.depends_on_components || []).includes(componentName)
        );
    };

    const pages = getPagesUsingComponent(component.name);
    const isInheritanceBlocked = !!disabledInheritance[component.id];
    const hasPageMapping = !isInheritanceBlocked && pages.some(page => {
        const pName = page.page_meta?.name?.trim();
        return pName && pageMappings[pName]?.length > 0;
    });

    const hasMapping = hasDirectMapping || hasPageMapping;

    const riskLevel = component.risk_score > 0.7 ? 'CRITICAL' :
        component.risk_score > 0.4 ? 'HIGH' :
            component.risk_score > 0.1 ? 'MEDIUM' : 'LOW';

    const riskColor = riskLevel === 'CRITICAL' ? '#991b1b' :
        riskLevel === 'HIGH' ? '#dc2626' :
            riskLevel === 'MEDIUM' ? '#d97706' : '#059669';

    /**
     * Отрисовка трассировки UI
     */
    const renderUITrace = (comp) => {
        if (!comp.uiContext || !comp.uiContext.uiElements || comp.uiContext.uiElements.length === 0) return null;

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
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#856404', marginBottom: '8px' }}>
                    UI Trace
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {comp.uiContext.uiElements.map((element, eidx) => (
                        <div key={`ui-element-${eidx}`} style={{
                            display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px',
                            backgroundColor: '#fff', borderRadius: '4px', border: '1px solid #ffc107'
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

    return (
        <div
            onClick={() => onSelect(component.id)}
            style={{
                ...TIAStyles.componentCard(isSelected, hasMapping),
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                padding: '16px'
            }}
        >
            {/* Заголовок с бейджем риска */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                        <h4 style={{
                            margin: 0,
                            fontSize: '16px',
                            fontWeight: 700,
                            color: '#1e293b',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }} title={component.name}>
                            {component.name}
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
                            {component.type}
                        </span>
                    </div>
                </div>
                <div style={{
                    padding: '4px 12px',
                    backgroundColor: riskColor,
                    color: '#fff',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}>
                    {riskLevel}
                </div>
            </div>

            {/* Окружение и JSDoc */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                    {component.envs?.map((env, i) => (
                        <span key={i} style={{ padding: '3px 8px', backgroundColor: '#6c757d', color: '#fff', borderRadius: '3px', fontSize: '11px', fontWeight: 500 }}>
                            {env}
                        </span>
                    ))}
                    {component.jsdoc && (
                        <span style={{ fontSize: '12px', color: '#495057', fontStyle: 'italic', padding: '4px 8px', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #dee2e6' }}>
                            {component.jsdoc}
                        </span>
                    )}
                </div>

                {component.type === 'backend' && component.serviceName && (
                    <div style={{ padding: '8px 12px', backgroundColor: '#f1f5f9', borderRadius: '6px', fontSize: '12px', color: '#475569', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>Сервис:</strong> {component.serviceName}
                    </div>
                )}
                {component.type === 'frontend' && component.serviceName && (
                    <div style={{ fontSize: '11px', color: '#6c757d', fontFamily: 'monospace', padding: '4px 8px', backgroundColor: '#f8f9fa', borderRadius: '4px', border: '1px solid #dee2e6', wordBreak: 'break-all' }}>
                        {component.serviceName}
                    </div>
                )}
            </div>

            {/* Endpoints */}
            {component.type === 'backend' && component.endpoints?.length > 0 && (
                <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: '#fef3c7', borderRadius: '8px', border: '1px solid #fbbf24' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#92400e', marginBottom: '8px' }}>
                        Endpoints ({component.endpoints.length}):
                    </div>
                    {component.endpoints.map((ep, i) => (
                        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace', backgroundColor: '#fff', padding: '6px 8px', borderRadius: '4px', marginBottom: '4px' }}>
                            <span style={{
                                fontWeight: 700,
                                fontSize: '10px',
                                color: '#fff',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                backgroundColor: (ep.HttpMethod || ep.method) === 'GET' ? '#10b981' : (ep.HttpMethod || ep.method) === 'POST' ? '#3b82f6' : (ep.HttpMethod || ep.method) === 'PUT' ? '#f59e0b' : (ep.HttpMethod || ep.method) === 'DELETE' ? '#ef4444' : '#6b7280'
                            }}>
                                {ep.HttpMethod || ep.method || 'N/A'}
                            </span>
                            <span style={{ fontFamily: 'monospace', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {ep.RoutePath || ep.path || ep.url || 'N/A'}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {/* Summary */}
            {(() => {
                const summaryRaw = component.change_summary || component.summaryText;
                if (!summaryRaw) return null;

                let summaryOutput = '';
                if (typeof summaryRaw === 'string') {
                    summaryOutput = summaryRaw;
                } else if (typeof summaryRaw === 'object') {
                    summaryOutput = summaryRaw.description || summaryRaw.summary || summaryRaw.advice || JSON.stringify(summaryRaw);
                }

                if (!summaryOutput) return null;

                return (
                    <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, margin: '8px 0' }}>
                        {summaryOutput}
                    </div>
                );
            })()}

            {/* UI Trace */}
            {renderUITrace(component)}

            {/* Тестирование */}
            {component.qaAdvice?.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setExpandedScenarios(prev => ({ ...prev, [component.id]: !prev[component.id] }));
                        }}
                        style={{
                            width: '100%',
                            padding: '10px 16px',
                            backgroundColor: expandedScenarios[component.id] ? '#10b981' : '#f0fdf4',
                            color: expandedScenarios[component.id] ? '#fff' : '#059669',
                            border: `1px solid ${expandedScenarios[component.id] ? '#10b981' : '#bcf0da'}`,
                            borderRadius: '12px',
                            fontSize: '13px',
                            fontWeight: 700,
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 0.2s ease',
                            boxShadow: expandedScenarios[component.id] ? '0 4px 12px rgba(16, 185, 129, 0.2)' : 'none'
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ transition: 'transform 0.2s ease', transform: expandedScenarios[component.id] ? 'rotate(180deg)' : 'rotate(0deg)', display: 'inline-block' }}>▼</span>
                            Сценарии тестирования
                            <span style={{ fontSize: '11px', backgroundColor: expandedScenarios[component.id] ? 'rgba(255, 255, 255, 0.3)' : 'rgba(16, 185, 129, 0.1)', padding: '2px 8px', borderRadius: '20px', marginLeft: '4px' }}>
                                {component.qaAdvice.reduce((sum, advice) => sum + (advice.scenarios?.length || 0), 0)}
                            </span>
                        </span>
                    </button>
                    {expandedScenarios[component.id] && (
                        <div style={{ marginTop: '12px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                            {component.qaAdvice.map((advice, i) => {
                                const priorityColor = advice.priority === 'HIGH' ? '#dc3545' : advice.priority === 'MEDIUM' ? '#ffc107' : '#28a745';
                                return (
                                    <div key={i} style={{ marginBottom: i < component.qaAdvice.length - 1 ? '16px' : '0', paddingBottom: i < component.qaAdvice.length - 1 ? '16px' : '0', borderBottom: i < component.qaAdvice.length - 1 ? '1px solid #b3d9ff' : 'none' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                            <span style={{ padding: '3px 8px', backgroundColor: priorityColor, color: '#fff', borderRadius: '3px', fontSize: '11px', fontWeight: 600 }}>{advice.priority}</span>
                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#111' }}>{advice.area}</span>
                                            {advice.scenarios && <span style={{ fontSize: '11px', color: '#6c757d' }}>({advice.scenarios.length} сценариев)</span>}
                                        </div>
                                        {advice.scenarios?.length > 0 && (
                                            <ol style={{ margin: '8px 0 0 0', paddingLeft: '0', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {advice.scenarios.map((s, si) => (
                                                    <li key={si} style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5, padding: '10px 14px', backgroundColor: '#ffffff', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', gap: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}>
                                                        <span style={{ fontWeight: 800, color: '#94a3b8', minWidth: '18px' }}>{si + 1}.</span>
                                                        <span>{s}</span>
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

            {/* Код */}
            {(component.nestedComponents?.[0]?.changed_methods?.length > 0 || component.nestedComponents?.[0]?.diff_snippet) && (
                <div style={{ marginBottom: '12px' }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setExpandedTechnicalDetails(prev => ({
                                ...prev,
                                [component.id]: !prev[component.id]
                            }));
                        }}
                        style={{ padding: '6px 12px', backgroundColor: '#6c757d', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        {expandedTechnicalDetails[component.id] ? '▼' : '▶  '}
                        Показать код
                    </button>
                    {expandedTechnicalDetails[component.id] && (
                        <div style={{ marginTop: '8px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #dee2e6' }}>
                            {component.nestedComponents?.[0]?.diff_snippet && (
                                <div>
                                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#495057', marginBottom: '8px' }}>
                                        Изменения в коде:
                                    </div>
                                    <pre style={{ margin: 0, padding: '12px', backgroundColor: '#2d2d2d', color: '#f8f8f2', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace', overflow: 'auto', maxHeight: '300px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                        {component.nestedComponents[0].diff_snippet}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Используется на страницах */}
            {pages.length > 0 && (
                <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '12px', marginBottom: '16px', border: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <h5 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#64748b' }}>
                            Используется на страницах:
                        </h5>
                        {pages.length > 10 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedPageLists(prev => ({ ...prev, [component.id]: !prev[component.id] }));
                                }}
                                style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '11px', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                            >
                                {expandedPageLists[component.id] ? 'Скрыть' : `Показать все (${pages.length})`}
                            </button>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {(expandedPageLists[component.id] ? pages : pages.slice(0, 10)).map((page, idx) => {
                            const pageName = page.page_meta?.name || 'Unknown';
                            const pageRoute = page.page_meta?.route;
                            const tooltipText = [
                                page.page_meta?.human_title,
                                pageRoute ? `Route: ${pageRoute}` : null,
                                page.page_meta?.file_path
                            ].filter(Boolean).join('\n');

                            const hasPageMappingForTag = pageMappings[pageName?.trim()]?.length > 0;
                            return (
                                <span
                                    key={`${component.id}-page-${idx}`}
                                    title={tooltipText}
                                    style={{
                                        padding: '4px 10px',
                                        backgroundColor: hasPageMappingForTag ? '#d1fae5' : '#e9ecef',
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                        color: hasPageMappingForTag ? '#065f46' : '#111',
                                        border: hasPageMappingForTag ? '1px solid #6ee7b7' : '1px solid transparent',
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
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Пакет маппинга (Покрыто) */}
            {hasMapping && (
                <div style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>
                            Покрыто:
                        </div>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (window.confirm(`Вы уверены, что хотите полностью очистить маппинг для компонента "${component.name}"?\n\nЭто удалит все привязки к тестам!`)) {
                                    setComponentMappings(prev => ({ ...prev, [component.id]: [] }));
                                    setDisabledInheritance(prev => ({ ...prev, [component.id]: true }));
                                    setPartialSaveMessage('');
                                }
                            }}
                            style={{
                                padding: '4px 10px',
                                backgroundColor: '#fff1f2',
                                color: '#e11d48',
                                border: '1px solid #fecdd3',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#ffe4e6';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#fff1f2';
                            }}
                        >
                            Очистить маппинг
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {(() => {
                            const directIds = componentMappings[component.id] || [];
                            const isInheritanceBlocked = !!disabledInheritance[component.id];
                            const folderToPages = {};
                            if (!isInheritanceBlocked) {
                                pages.forEach(page => {
                                    const pName = page.page_meta?.name?.trim();
                                    const mappings = pageMappings[pName] || [];
                                    mappings.forEach(m => {
                                        const folder = findFolderById(folders, m.functional_block_allure_id);
                                        if (folder) {
                                            const fId = folder.id.toString();
                                            if (!folderToPages[fId]) folderToPages[fId] = new Set();
                                            folderToPages[fId].add(pName);
                                        }
                                    });
                                });
                            }
                            const pageLevelIdsList = Object.keys(folderToPages);

                            const allIds = Array.from(new Set([...directIds, ...pageLevelIdsList]));
                            const displayIds = showAllMappings ? allIds : allIds.slice(0, 5);
                            const hasMore = allIds.length > 5;

                            return (
                                <>
                                    {displayIds.map(folderId => {
                                        const folder = findFolderById(folders, folderId);
                                        const isAutoMapped = autoMappedBlocks[component.id]?.includes(folderId.toString());
                                        const isPageLevel = !directIds.includes(folderId.toString());

                                        const tagStyles = TIAStyles.mappingTag(isPageLevel ? 'page' : (isAutoMapped ? 'auto' : 'direct'));
                                        const { textStyle, ...containerStyle } = tagStyles;

                                        const displayName = folder ? formatCustomFieldName(folder) : `Блок ${folderId}`;

                                        let tooltipText = displayName;
                                        if ((isPageLevel || isAutoMapped) && folderToPages[folderId.toString()]) {
                                            const sourcePages = Array.from(folderToPages[folderId.toString()]);
                                            tooltipText = `${displayName}\n\nЭта зависимость пришла от страниц:\n• ${sourcePages.join('\n• ')}`;
                                        }

                                        return (
                                            <div
                                                key={folderId}
                                                style={{ ...containerStyle, alignItems: 'center', padding: '4px 10px', borderRadius: '8px', display: 'flex' }}
                                                title={tooltipText}
                                            >
                                                <span style={{ ...textStyle, display: 'inline-block', verticalAlign: 'middle' }}>
                                                    {displayName}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        handleRemoveMapping(component.id, folderId);
                                                        if (isPageLevel || pageLevelIdsList.includes(folderId.toString())) {
                                                            toggleInheritance(component.id);
                                                        }
                                                    }}
                                                    style={{
                                                        border: 'none',
                                                        background: 'none',
                                                        padding: 0,
                                                        cursor: 'pointer',
                                                        color: '#f43f5e',
                                                        fontSize: '20px',
                                                        fontWeight: 800,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        width: '24px',
                                                        height: '24px',
                                                        marginLeft: '6px',
                                                        marginTop: '-4px',
                                                        transition: 'all 0.2s',
                                                        opacity: 0.7,
                                                        lineHeight: 1,
                                                        borderRadius: '50%'

                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.opacity = 1;
                                                        e.currentTarget.style.backgroundColor = 'rgba(244, 63, 94, 0.1)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.opacity = 0.7;
                                                        e.currentTarget.style.backgroundColor = 'transparent';
                                                    }}
                                                    title={isPageLevel ? "Блокировать наследование" : "Удалить привязку"}
                                                >×</button>
                                            </div>
                                        );
                                    })}

                                    {hasMore && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                setShowAllMappings(!showAllMappings);
                                            }}
                                            style={{
                                                padding: '4px 12px',
                                                borderRadius: '8px',
                                                fontSize: '12px',
                                                fontWeight: 700,
                                                backgroundColor: '#f1f5f9',
                                                border: '1px solid #e2e8f0',
                                                color: '#6366f1',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                marginTop: '0px'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#e2e8f0';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = '#f1f5f9';
                                            }}
                                        >
                                            {showAllMappings ? 'Скрыть ▴' : `Еще +${allIds.length - 5} ▾`}
                                        </button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TIAComponentCard;
