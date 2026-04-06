import { useTIA } from '../context/TIAContext';

/**
 * Компонент отображения трассировки UI для компонента
 * @param {Object} props - Свойства компонента
 * @param {Object} props.component - Компонент для отображения трассировки
 * @returns {JSX.Element|null}
 */
const TIAUITrace = ({ component }) => {
    const { expandedPageLists, setExpandedPageLists } = useTIA();

    if (!component.uiTrace || !Array.isArray(component.uiTrace)) return null;

    /**
     * Переключение раскрытия списка страниц для конкретного трейса
     * @param {string} key - Ключ трейса
     * @param {Object} e - Событие клика
     */
    const togglePageList = (key, e) => {
        if (e) e.stopPropagation();
        setExpandedPageLists(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    return (
        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '16px' }}>🔍</span> UI TRACE (Affected Pages)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {component.uiTrace.map((trace, idx) => {
                    const key = `${component.id}-${idx}`;
                    const isExpanded = expandedPageLists[key];
                    const pages = trace.pages || [];

                    return (
                        <div key={key} style={{ fontSize: '12px', backgroundColor: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #f1f5f9' }}>
                            <div 
                                onClick={(e) => togglePageList(key, e)}
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                            >
                                <span style={{ fontWeight: 600, color: '#6366f1' }}>{trace.action || 'Action'}</span>
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>{isExpanded ? '▼' : '▶'}</span>
                            </div>
                            
                            {isExpanded && (
                                <div style={{ marginTop: '6px', paddingLeft: '8px', borderLeft: '2px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {pages.length > 0 ? pages.map((page, pIdx) => (
                                        <div key={pIdx} style={{ color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ color: '#94a3b8' }}>•</span> {page}
                                        </div>
                                    )) : <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No pages tracked</div>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default TIAUITrace;
