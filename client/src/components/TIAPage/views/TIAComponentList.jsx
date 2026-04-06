import { useTIA } from '../context/TIAContext';
import { findFolderById } from '../utils/tiaUtils';

/**
 * Компонент отображения списка компонентов для маппинга
 * @returns {JSX.Element|null}
 */
const TIAComponentList = () => {
    const {
        components,
        componentMappings,
        handleRemoveMapping,
        selectedComponentId,
        setSelectedComponentId,
        folders,
        expandedScenarios,
        setExpandedScenarios,
        expandedCode,
        setExpandedCode
    } = useTIA();

    if (components.length === 0) return null;

    /**
     * Переключение раскрытия сценариев
     */
    const toggleScenarios = (compId, e) => {
        e.stopPropagation();
        setExpandedScenarios(prev => ({ ...prev, [compId]: !prev[compId] }));
    };

    /**
     * Переключение раскрытия кода
     */
    const toggleCode = (compId, e) => {
        e.stopPropagation();
        setExpandedCode(prev => ({ ...prev, [compId]: !prev[compId] }));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {components.map((comp) => {
                const mappings = componentMappings[comp.id] || [];
                const isSelected = selectedComponentId === comp.id;
                const isHighRisk = comp.riskLevel === 'HIGH';
                const showScenarios = expandedScenarios[comp.id];
                const showCode = expandedCode[comp.id];

                return (
                    <div 
                        key={comp.id} 
                        onClick={() => setSelectedComponentId(comp.id)}
                        style={{ 
                            display: 'flex', 
                            flexDirection: 'column', 
                            backgroundColor: '#fff', 
                            borderRadius: '24px', 
                            border: isSelected ? '2px solid #6366f1' : '1px solid #e2e8f0',
                            borderTop: isHighRisk ? '6px solid #dc2626' : '1px solid #e2e8f0',
                            boxShadow: isSelected ? '0 20px 25px -5px rgba(99, 102, 241, 0.1)' : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                            transition: 'all 0.2s',
                            cursor: 'pointer',
                            overflow: 'hidden',
                            position: 'relative'
                        }}
                    >
                        <div style={{ padding: '32px' }}>
                            {/* Header Section */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <h3 style={{ 
                                            fontSize: '20px', 
                                            fontWeight: 900, 
                                            color: isHighRisk ? '#dc2626' : '#1e293b', 
                                            margin: 0,
                                            letterSpacing: '-0.01em',
                                            wordBreak: 'break-all'
                                        }}>
                                            {comp.name}
                                        </h3>
                                        {isHighRisk && (
                                            <span style={{ fontSize: '11px', fontWeight: 900, backgroundColor: '#dc2626', color: '#fff', padding: '2px 8px', borderRadius: '6px', textTransform: 'uppercase' }}>
                                                HIGH
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <span style={{ fontSize: '12px', fontWeight: 800, backgroundColor: '#f1f5f9', color: '#64748b', padding: '4px 10px', borderRadius: '8px' }}>
                                            {comp.type || 'component'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Path Block */}
                            <div style={{ 
                                backgroundColor: '#f8fafc', 
                                border: '1px solid #f1f5f9', 
                                borderRadius: '12px', 
                                padding: '12px 16px', 
                                marginBottom: '20px',
                                fontSize: '12px',
                                color: '#94a3b8',
                                fontWeight: 500,
                                fontFamily: 'monospace',
                                wordBreak: 'break-all'
                            }}>
                                {comp.filePath || 'Путь к файлу не указан'}
                            </div>

                            {/* Description */}
                            <div style={{ 
                                fontSize: '14px', 
                                lineHeight: '1.6', 
                                color: '#475569', 
                                marginBottom: '24px',
                                fontWeight: 500
                            }}>
                                {comp.summaryText || 'Описание изменений отсутствует.'}
                            </div>

                            {/* Mapped Features (Tags) */}
                            {mappings.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
                                    {mappings.map(folderId => {
                                        const folder = findFolderById(folders, folderId);
                                        return (
                                            <div key={folderId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', backgroundColor: '#eff6ff', border: '1px solid #dbeafe', borderRadius: '10px', fontSize: '12px', color: '#1e40af', fontWeight: 700 }}>
                                                <span>{folder ? `[Feature] ${folder.name}` : folderId}</span>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveMapping(comp.id, folderId); }}
                                                    style={{ border: 'none', background: 'none', color: '#3b82f6', cursor: 'pointer', padding: '0 2px', fontSize: '16px', lineHeight: 1 }}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                                <button 
                                    onClick={(e) => toggleScenarios(comp.id, e)}
                                    style={{ 
                                        backgroundColor: '#ecfdf5', 
                                        border: '1px solid #d1fae5', 
                                        borderRadius: '12px', 
                                        padding: '10px 16px', 
                                        color: '#059669', 
                                        fontSize: '13px', 
                                        fontWeight: 800, 
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    {showScenarios ? '▼' : '▶'} Сценарии тестирования
                                    <span style={{ backgroundColor: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: '20px', fontSize: '11px' }}>
                                        {comp.testScenariosCount || 10}
                                    </span>
                                </button>
                                <button 
                                    onClick={(e) => toggleCode(comp.id, e)}
                                    style={{ 
                                        backgroundColor: '#f1f5f9', 
                                        border: '1px solid #e2e8f0', 
                                        borderRadius: '12px', 
                                        padding: '10px 16px', 
                                        color: '#475569', 
                                        fontSize: '13px', 
                                        fontWeight: 800, 
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}
                                >
                                    {showCode ? '▼' : '▶'} Показать код
                                </button>
                            </div>

                            {/* Expanded Sections */}
                            {showCode && (
                                <div style={{ marginBottom: '24px', backgroundColor: '#1e293b', padding: '20px', borderRadius: '16px', overflow: 'hidden' }}>
                                    <pre style={{ margin: 0, fontSize: '12px', color: '#e2e8f0', fontFamily: 'monospace', overflowX: 'auto' }}>
                                        {comp.codeSnippet || '// Код компонента недоступен'}
                                    </pre>
                                </div>
                            )}

                            {/* Used In Section */}
                            {(comp.usedIn || comp.parents) && (
                                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#94a3b8', marginBottom: '12px' }}>Используется на страницах:</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                                        {(comp.usedIn || comp.parents || []).map((page, idx) => (
                                            <div key={idx} style={{ padding: '6px 12px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                                                {typeof page === 'string' ? page : (page.name + ' ' + (page.url || ''))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default TIAComponentList;
