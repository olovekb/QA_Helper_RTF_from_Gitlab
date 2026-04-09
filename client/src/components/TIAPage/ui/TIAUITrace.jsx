

/**
 * Компонент отображения трассировки UI для компонента
 * @param {Object} props - Свойства компонента
 * @param {Object} [props.component] - Компонент для отображения трассировки
 * @param {Object} [props.uiContext] - Контекст напрямую (для Light-режима)
 * @returns {JSX.Element|null}
 */
const TIAUITrace = ({ component, uiContext: directUiContext }) => {
    const uiContext = directUiContext || component?.uiContext || component?.ui_context;

    if (!uiContext || !uiContext.uiElements || uiContext.uiElements.length === 0) {
        return null;
    }

    /**
     * Возвращает человекочитаемый тип элемента
     * @param {string} type - Тип элемента из JSON
     * @returns {string}
     */
    const getElementTypeLabel = (type) => {
        switch (type?.toLowerCase()) {
            case 'button': return 'Кнопка';
            case 'form': return 'Форма';
            case 'input': return 'Поле ввода';
            case 'link': return 'Ссылка';
            case 'select': return 'Выпадающий список';
            case 'checkbox': return 'Флажок (Checkbox)';
            case 'radio': return 'Переключатель (Radio)';
            case 'text': return 'Текстовый блок';
            case 'icon': return 'Иконка';
            default: return type || 'Элемент';
        }
    };

    /**
     * Очищает лейбл элемента от Angular-шаблонов и пайпов
     * @param {string} label
     * @returns {string}
     */
    const getElementLabel = (label) => {
        if (!label) return 'Элемент';
        return label
            .replace(/\{\{[^}]+\}\}/g, '')
            .replace(/\|[^|]+\|/g, '')
            .trim() || 'Элемент';
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
            <div style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#856404',
                marginBottom: '8px'
            }}>
                UI Trace
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {uiContext.uiElements.map((element, eidx) => (
                    <div key={`ui-element-${eidx}`} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '8px',
                        backgroundColor: '#fff',
                        borderRadius: '4px',
                        border: '1px solid #ffc107'
                    }}>
                        <div style={{ flex: 1, fontSize: '13px', color: '#111' }}>
                            <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                                {getElementTypeLabel(element.type)}
                                {element.label && ` "${getElementLabel(element.label)}"`}
                            </div>

                            {element.method && (
                                <div style={{
                                    fontSize: '11px',
                                    color: '#6c757d',
                                    fontFamily: 'monospace',
                                    marginTop: '2px'
                                }}>
                                    Обработчик: {element.method}
                                </div>
                            )}

                            {element.attributes && Object.keys(element.attributes).length > 0 && (
                                <div style={{
                                    fontSize: '11px',
                                    color: '#6c757d',
                                    marginTop: '4px',
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '8px'
                                }}>
                                    {Object.entries(element.attributes).map(([key, value]) => (
                                        <span key={key}>
                                            <strong style={{ color: '#495057' }}>{key}:</strong>
                                            <code style={{
                                                backgroundColor: '#f8f9fa',
                                                padding: '1px 4px',
                                                borderRadius: '2px',
                                                marginLeft: '4px',
                                                border: '1px solid #e9ecef'
                                            }}>
                                                {String(value)}
                                            </code>
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

export default TIAUITrace;
