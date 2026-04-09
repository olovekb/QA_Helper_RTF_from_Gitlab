import React from 'react';
import { useTIA } from '../context/TIAContext';
import { findFolderById } from '../utils/tiaUtils';
import TIAStyles from '../styles/TIAStyles';
import TIAUITrace from '../ui/TIAUITrace';

/**
 * Компонент отображения списка компонентов для маппинга.
 * @param {Object} props - Свойства компонента
 * @param {Array} [props.componentsOverride] - Опциональный список компонентов для отображения
 * @returns {JSX.Element|null}
 */
const TIAComponentList = ({ componentsOverride }) => {
    const {
        components: contextComponents,
        componentMappings,
        autoMappedBlocks,
        handleRemoveMapping,
        selectedComponentId,
        setSelectedComponentId,
        folders,
        expandedCode,
        setExpandedCode,
        disabledInheritance,
        toggleInheritance,
        setComponentMappings
    } = useTIA();

    const components = componentsOverride || contextComponents;

    if (!components || components.length === 0) return null;

    /**
     * Очистка маппинга компонента с подтверждением
     */
    const handleClearMapping = (compId, e) => {
        e.stopPropagation();
        if (window.confirm('Вы уверены, что хотите полностью очистить маппинг для этого компонента? Все ручные привязки будут удалены.')) {
            setComponentMappings(prev => ({
                ...prev,
                [compId]: []
            }));
        }
    };

    /**
     * Рендеринг тегов маппинга с учетом типа
     */
    const renderMappingTags = (compId) => {
        const direct = componentMappings[compId] || [];
        const auto = autoMappedBlocks[compId] || [];
        const isBlocked = !!disabledInheritance[compId];

        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
                {direct.map(folderId => {
                    const folder = findFolderById(folders, folderId);
                    const isAuto = auto.includes(folderId);
                    const type = isAuto ? 'auto' : 'direct';

                    return (
                        <div key={folderId} style={TIAStyles.mappingTag(type)}>
                            <span>
                                {isAuto ? '[Auto] ' : ''}
                                {folder ? `[Block] ${folder.name}` : folderId}
                            </span>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveMapping(compId, folderId); }}
                                style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: '0 2px', fontSize: '14px', marginLeft: '4px' }}
                                title="Удалить маппинг"
                            >
                                ×
                            </button>
                        </div>
                    );
                })}
                {direct.length === 0 && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        Маппинг не задан
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {components.map((comp) => {
                const isSelected = selectedComponentId === comp.id;
                const isHighRisk = comp.riskLevel === 'HIGH';
                const showCode = expandedCode[comp.id];
                const isInheritanceBlocked = !!disabledInheritance[comp.id];

                const pages = comp.usedIn || comp.parents || [];
                const isPageListExpanded = !!expandedPageLists[comp.id];
                const displayedPages = isPageListExpanded ? pages : pages.slice(0, 10);
                const hasMorePages = pages.length > 10;

                return (
                    <div
                        key={comp.id}
                        onClick={() => setSelectedComponentId(comp.id)}
                        style={{
                            ...TIAStyles.componentCard,
                            ...(isSelected ? TIAStyles.componentCardSelected : {})
                        }}
                    >
                        {/* Риск-индикатор */}
                        <div style={{
                            ...TIAStyles.riskIndicator,
                            backgroundColor: isHighRisk ? 'var(--error)' : 'var(--success)'
                        }} />

                        {/* Заголовок компонента */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>
                                    {comp.name}
                                </div>
                                {isHighRisk && <span style={TIAStyles.badge('var(--error)')}>HIGH RISK</span>}
                                <span style={TIAStyles.badge('var(--text-muted)')}>{comp.type || 'component'}</span>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                                    {comp.filePath || comp.serviceName || 'No path'}
                                </div>
                            </div>

                            <button
                                onClick={(e) => handleClearMapping(comp.id, e)}
                                style={{
                                    padding: '6px 12px',
                                    backgroundColor: 'transparent',
                                    border: '1px solid var(--error)',
                                    color: 'var(--error)',
                                    borderRadius: '8px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                Очистить маппинг
                            </button>
                        </div>

                        {/* Описание изменений */}
                        <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '20px', lineHeight: 1.5 }}>
                            {comp.summaryText || 'Описание изменений отсутствует.'}
                        </div>

                        {/* Наследование */}
                        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)' }}>
                                НАСЛЕДОВАНИЕ:
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); toggleInheritance(comp.id); }}
                                style={{
                                    padding: '4px 12px',
                                    borderRadius: '20px',
                                    border: 'none',
                                    backgroundColor: isInheritanceBlocked ? 'var(--error)' : 'var(--success)',
                                    color: '#fff',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                }}
                            >
                                {isInheritanceBlocked ? 'ЗАБЛОКИРОВАНО' : 'РАЗРЕШЕНО'}
                            </button>
                            {isInheritanceBlocked && (
                                <span style={{ fontSize: '11px', color: 'var(--error)', fontStyle: 'italic' }}>
                                    Авто-маппинг со страниц игнорируется
                                </span>
                            )}
                        </div>

                        {/* Маппинг (Теги) */}
                        <div style={TIAStyles.cardSectionTitle}>Замапленные функции:</div>
                        {renderMappingTags(comp.id)}

                        {/* UI Trace */}
                        <TIAUITrace component={comp} />

                        {/* Кнопки действий */}
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setExpandedCode(prev => ({ ...prev, [comp.id]: !showCode })); }}
                                style={TIAStyles.backButton}
                            >
                                {showCode ? 'Скрыть детали' : 'Технические детали (Code)'}
                            </button>
                        </div>

                        {/* Блок кода */}
                        {showCode && (
                            <div style={{ marginBottom: '20px' }}>
                                {comp.changed_methods?.length > 0 && (
                                    <div style={{ marginBottom: '12px' }}>
                                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>
                                            ИЗМЕНЕННЫЕ МЕТОДЫ:
                                        </div>
                                        <ul style={{ margin: 0, paddingLeft: '20px' }}>
                                            {comp.changed_methods.map((m, mi) => (
                                                <li key={mi} style={{ marginBottom: '4px' }}>
                                                    <code style={{ fontSize: '13px', color: 'var(--primary-accent)' }}>{m}</code>
                                                    {comp.method_jsdoc?.[m] && (
                                                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px', fontStyle: 'italic' }}>
                                                            {comp.method_jsdoc[m]}
                                                        </span>
                                                    )}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                <pre style={TIAStyles.codeBlock}>
                                    {comp.codeSnippet || comp.diff_snippet || '// Нет фрагмента кода для отображения'}
                                </pre>
                            </div>
                        )}

                        {/* Используется на страницах */}
                        {pages.length > 0 && (
                            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '12px' }}>
                                    ИСПОЛЬЗУЕТСЯ НА СТРАНИЦАХ ({pages.length}):
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                                    {displayedPages.map((page, idx) => {
                                        const pageName = typeof page === 'string' ? page : (page.name || page.page_meta?.name || 'Unknown');
                                        const pageRoute = page.route || page.page_meta?.route || '';
                                        const pageTitle = page.human_title || page.page_meta?.human_title || '';
                                        const pagePath = page.file_path || page.page_meta?.file_path || '';

                                        const tooltip = `[Page] ${pageName}\nRoute: ${pageRoute}\nPath: ${pagePath}\nTitle: ${pageTitle}`;

                                        return (
                                            <div
                                                key={idx}
                                                title={tooltip}
                                                style={{
                                                    padding: '6px 10px',
                                                    backgroundColor: 'var(--bg-input)',
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: '6px',
                                                    fontSize: '11px',
                                                    fontWeight: 600,
                                                    color: 'var(--text-secondary)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    cursor: 'help'
                                                }}
                                            >
                                                {pageName}
                                            </div>
                                        );
                                    })}
                                    {hasMorePages && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setExpandedPageLists(prev => ({ ...prev, [comp.id]: !isPageListExpanded })); }}
                                            style={{
                                                padding: '4px 8px',
                                                border: '1px dashed var(--primary-accent)',
                                                backgroundColor: 'transparent',
                                                color: 'var(--primary-accent)',
                                                borderRadius: '6px',
                                                fontSize: '10px',
                                                fontWeight: 700,
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {isPageListExpanded ? 'СВЕРНУТЬ' : `ЕЩЕ ${pages.length - 10}...`}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default TIAComponentList;
