import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import config from '../config';
import '../style.css';

const RulesModal = ({
    isOpen,
    onClose,
    projectId,
    exportUrlSuffix = 'validation/rules/export',
    emptyTitleFallback = 'Правила ревью'
}) => {
    const [markdown, setMarkdown] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedSections, setExpandedSections] = useState({});
    const [allExpanded, setAllExpanded] = useState(false);

    // Загрузка markdown при открытии модалки или смене проекта
    useEffect(() => {
        if (!isOpen || !projectId) {
            return;
        }

        setLoading(true);
        setError('');
        setMarkdown('');
        setExpandedSections({});
        setAllExpanded(false);
        const base = String(config.serverUrl || '').replace(/\/+$/, '');
        const suffix = String(exportUrlSuffix || '').replace(/^\/+/, '');
        const exportUrl = base.endsWith('/api')
            ? `${base}/${suffix}`
            : `${base}/api/${suffix}`;

        axios.get(exportUrl, {
            params: { projectId }
        })
            .then(response => {
                if (response.data.success && response.data.markdown) {
                    setMarkdown(response.data.markdown);
                } else {
                    setError(response.data.error || 'Ошибка загрузки правил');
                }
            })
            .catch(err => {
                console.error('Ошибка загрузки правил:', err);
                setError('Ошибка загрузки правил: ' + err.message);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [isOpen, projectId, exportUrlSuffix]);

    // Парсинг markdown в структуру с секциями
    const parsedContent = useMemo(() => {
        if (!markdown) return null;

        const lines = markdown.split('\n');
        const structure = {
            header: '',
            description: [],
            sections: []
        };

        let currentH2 = null;
        let currentH3 = null;
        let currentH4 = null;
        let inDescription = false;
        let currentProjectH2 = null; // Текущий проект, если мы обрабатываем проекты
        let foundBaseRules = false; // Флаг, что мы нашли секцию "Базовые правила"
        let foundDivider = false; // Флаг, что мы нашли разделитель --- после базовых правил

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Пропускаем строки с ID и статусом "Включено"
            if (line.trim().match(/^ID:\s*`[^`]+`$/)) {
                continue;
            }
            if (line.trim().match(/^Включено:\s*(да|нет)$/i)) {
                continue;
            }

            // H1 - главный заголовок
            if (line.startsWith('# ')) {
                structure.header = line.replace('# ', '');
                inDescription = true;
                currentProjectH2 = null;
                foundBaseRules = false;
                foundDivider = false;
                continue;
            }

            // Разделитель ---
            if (line.trim() === '---') {
                inDescription = false;
                // Если мы уже нашли базовые правила, то следующий разделитель означает начало проектов
                if (foundBaseRules) {
                    foundDivider = true;
                    currentH2 = null; // Сбрасываем текущий H2, чтобы проекты не попадали в базовые правила
                }
                continue;
            }

            // H2 - основная категория (Базовые правила, Проекты)
            if (line.startsWith('## ')) {
                inDescription = false;
                const title = line.replace('## ', '');
                
                // Если это секция "Проекты", просто пропускаем (она не включается в экспорт)
                if (title.toLowerCase().includes('проект')) {
                    foundDivider = true; // Устанавливаем флаг, что мы в секции проектов
                    currentH2 = null;
                    currentProjectH2 = null;
                    currentH3 = null;
                    currentH4 = null;
                    continue;
                }
                
                // Если это "Базовые правила", устанавливаем флаг
                if (title.toLowerCase().includes('базов')) {
                    foundBaseRules = true;
                    foundDivider = false;
                }
                
                // Обычная секция H2
                currentH2 = {
                    id: `h2-${structure.sections.length}`,
                    title: title,
                    subsections: [],
                    content: []
                };
                structure.sections.push(currentH2);
                currentProjectH2 = null;
                currentH3 = null;
                currentH4 = null;
                continue;
            }

            // H3 - подкатегория в Базовых правилах или название проекта
            if (line.startsWith('### ')) {
                inDescription = false;
                const title = line.replace('### ', '').trim();
                
                // Если мы нашли разделитель после базовых правил, или нет текущего H2,
                // то это проект - создаем как H2 на том же уровне
                if (foundDivider || !currentH2) {
                    currentProjectH2 = {
                        id: `h2-project-${structure.sections.length}`,
                        title: title,
                        subsections: [],
                        content: []
                    };
                    structure.sections.push(currentProjectH2);
                    currentH2 = null; // Убеждаемся, что текущий H2 сброшен
                    currentH3 = null;
                    currentH4 = null;
                    continue;
                }
                
                // Проверяем, является ли текущий H2 "Базовыми правилами"
                // Если да, то это подсекция внутри базовых правил
                const isBaseRules = currentH2.title.toLowerCase().includes('базов');
                if (!isBaseRules) {
                    // Если это не базовые правила, значит мы после секции "Проекты"
                    // Создаем проект как H2 на том же уровне
                    currentProjectH2 = {
                        id: `h2-project-${structure.sections.length}`,
                        title: title,
                        subsections: [],
                        content: []
                    };
                    structure.sections.push(currentProjectH2);
                    currentH2 = null;
                    currentH3 = null;
                    currentH4 = null;
                    continue;
                }
                
                // Обычная логика для H3 внутри "Базовые правила"
                currentH3 = {
                    id: `h3-${currentH2.id}-${currentH2.subsections.length}`,
                    title: title,
                    subsections: [],
                    content: []
                };
                currentH2.subsections.push(currentH3);
                currentH4 = null;
                continue;
            }

            // H4 - подкатегория в проектах (например, "Кастомные поля")
            if (line.startsWith('#### ')) {
                inDescription = false;
                const title = line.replace('#### ', '');
                
                // Если есть текущий проект, создаем H3 внутри него
                if (currentProjectH2) {
                    currentH3 = {
                        id: `h3-${currentProjectH2.id}-${currentProjectH2.subsections.length}`,
                        title: title,
                        subsections: [],
                        content: []
                    };
                    currentProjectH2.subsections.push(currentH3);
                    currentH4 = null;
                    continue;
                }
                
                // Обычная логика для H4 внутри H3
                if (currentH3) {
                    currentH4 = {
                        id: `h4-${currentH3.id}-${currentH3.subsections.length}`,
                        title: title,
                        content: []
                    };
                    currentH3.subsections.push(currentH4);
                }
                continue;
            }

            // Контент
            if (inDescription) {
                structure.description.push(line);
            } else if (currentH4) {
                currentH4.content.push(line);
            } else if (currentH3) {
                // Контент для H3
                currentH3.content.push(line);
            } else if (currentProjectH2) {
                // Контент для проекта
                currentProjectH2.content.push(line);
            } else if (foundDivider && !currentH2) {
                // Если мы после разделителя и нет текущего H2, контент игнорируем
                // (он относится к заголовку секции "Проекты" или к проекту, который еще не создан)
                continue;
            } else if (currentH2) {
                currentH2.content.push(line);
            }
        }

        return structure;
    }, [markdown]);

    // Инициализация: "Базовые правила" всегда открыты
    useEffect(() => {
        if (parsedContent && !loading) {
            const baseRulesSection = parsedContent.sections.find(
                s => s.title.toLowerCase().includes('базов')
            );
            if (baseRulesSection) {
                setExpandedSections(prev => ({
                    ...prev,
                    [baseRulesSection.id]: true
                }));
            }
        }
    }, [parsedContent, loading]);

    // Подсветка [ERROR] и [WARNING] после рендеринга
    useEffect(() => {
        if (!parsedContent || loading) return;

        const highlightBadges = () => {
            const containers = document.querySelectorAll('.rules-section-text, .rules-subsection-text, .rules-h4-section-content, .rules-modal-description');
            
            containers.forEach(container => {
                const walker = document.createTreeWalker(
                    container,
                    NodeFilter.SHOW_TEXT,
                    null
                );
                const textNodes = [];
                let node;
                while (node = walker.nextNode()) {
                    if (node.textContent && (node.textContent.includes('[ERROR]') || node.textContent.includes('[WARNING]'))) {
                        if (!node.parentElement?.classList.contains('level-badge')) {
                            textNodes.push(node);
                        }
                    }
                }
                
                textNodes.forEach(textNode => {
                    const parent = textNode.parentNode;
                    const text = textNode.textContent;
                    const parts = text.split(/(\[ERROR\]|\[WARNING\])/);
                    if (parts.length > 1) {
                        const fragment = document.createDocumentFragment();
                        parts.forEach((part) => {
                            if (part === '[ERROR]') {
                                const span = document.createElement('span');
                                span.className = 'level-badge level-error';
                                span.textContent = '[ERROR]';
                                fragment.appendChild(span);
                            } else if (part === '[WARNING]') {
                                const span = document.createElement('span');
                                span.className = 'level-badge level-warning';
                                span.textContent = '[WARNING]';
                                fragment.appendChild(span);
                            } else if (part) {
                                fragment.appendChild(document.createTextNode(part));
                            }
                        });
                        parent.replaceChild(fragment, textNode);
                    }
                });
            });
        };

        // requestAnimationFrame для синхронизации с браузером
        const rafId = requestAnimationFrame(highlightBadges);
        
        return () => cancelAnimationFrame(rafId);
    }, [parsedContent, loading, expandedSections]);

    // Переключение раскрытия секции с автоскроллом
    const toggleSection = (sectionId) => {
        const isExpanding = !expandedSections[sectionId];
        setExpandedSections(prev => ({
            ...prev,
            [sectionId]: !prev[sectionId]
        }));
        
        // Автоскролл при открытии секции
        if (isExpanding) {
            setTimeout(() => {
                const contentElement = document.getElementById(`content-${sectionId}`);
                if (contentElement) {
                    const modalContent = document.querySelector('.rules-modal-content');
                    if (modalContent) {
                        const offsetTop = contentElement.offsetTop - modalContent.offsetTop - 20;
                        modalContent.scrollTo({
                            top: offsetTop,
                            behavior: 'smooth'
                        });
                    }
                }
            }, 50);
        }
    };

    // Переключение всех секций
    const toggleAllSections = () => {
        if (!parsedContent) return;
        
        if (allExpanded) {
            // Свернуть все, кроме "Базовых правил"
            const baseRulesSection = parsedContent.sections.find(
                s => s.title.toLowerCase().includes('базов')
            );
            const newState = {};
            if (baseRulesSection) {
                newState[baseRulesSection.id] = true;
            }
            setExpandedSections(newState);
            setAllExpanded(false);
        } else {
            // Развернуть все секции
            const allSections = {};
            parsedContent.sections.forEach(section => {
                allSections[section.id] = true;
                section.subsections.forEach(sub => {
                    allSections[sub.id] = true;
                    if (sub.subsections) {
                        sub.subsections.forEach(h4 => {
                            allSections[h4.id] = true;
                        });
                    }
                });
            });
            setExpandedSections(allSections);
            setAllExpanded(true);
        }
    };

    // Проверка, является ли секция "Базовыми правилами"
    const isBaseRulesSection = (sectionTitle) => {
        return sectionTitle.toLowerCase().includes('базов');
    };

    if (!isOpen) return null;

    return (
        <div className="rules-modal-overlay" onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
        }}>
            <div className="rules-modal-container" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="rules-modal-header">
                    <h2 className="rules-modal-title">
                        {parsedContent?.header || emptyTitleFallback}
                    </h2>
                    <div className="rules-modal-header-actions">
                        {!loading && !error && parsedContent && (
                            <button
                                onClick={toggleAllSections}
                                className="rules-modal-toggle-btn"
                            >
                                <span dangerouslySetInnerHTML={{
                                    __html: allExpanded 
                                        ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l3 4 3-4"/></svg>'
                                        : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2l4 3-4 3"/></svg>'
                                }} />
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="rules-modal-close-btn"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="rules-modal-content">
                    {loading && (
                        <div className="rules-modal-loading">
                            <div className="spinner" style={{ margin: '0 auto' }}></div>
                            <div style={{ marginTop: '12px' }}>Загрузка правил...</div>
                        </div>
                    )}

                    {error && (
                        <div className="rules-modal-error">
                            {error}
                        </div>
                    )}

                    {!loading && !error && parsedContent && (
                        <div>
                            {/* Описание (если есть) */}
                            {parsedContent.description.some(line => line.trim()) && (
                                <div className="rules-modal-description">
                                    <ReactMarkdown
                                        components={{
                                            p: ({node, ...props}) => <p {...props} />,
                                            code: ({node, inline, ...props}) => inline 
                                                ? <code {...props} />
                                                : null
                                        }}
                                    >
                                        {parsedContent.description.join('\n')}
                                    </ReactMarkdown>
                                </div>
                            )}

                            {/* Секции */}
                            {parsedContent.sections.map((section) => {
                                const isBaseRules = isBaseRulesSection(section.title);
                                const isExpanded = expandedSections[section.id] || isBaseRules;
                                
                                return (
                                    <div key={section.id} className="rules-section">
                                        {/* H2 Header */}
                                        <button
                                            id={`section-${section.id}`}
                                            onClick={() => !isBaseRules && toggleSection(section.id)}
                                            className={`rules-section-header ${isBaseRules ? 'always-open' : ''} ${isExpanded ? 'expanded' : ''}`}
                                            disabled={isBaseRules}
                                        >
                                            <span>{section.title}</span>
                                            {!isBaseRules && (
                                                <span className="rules-section-toggle-icon" dangerouslySetInnerHTML={{
                                                    __html: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l3 4 3-4"/></svg>'
                                                }} />
                                            )}
                                        </button>

                                        {/* H2 Content */}
                                        {isExpanded && (
                                            <div className="rules-section-content" id={`content-${section.id}`}>
                                                {/* Контент секции (если есть, до подсекций) */}
                                                {section.content.length > 0 && section.content.some(line => line.trim()) && (
                                                    <div className="rules-section-text">
                                                        <ReactMarkdown
                                                            components={{
                                                                p: ({node, ...props}) => <p {...props} />,
                                                                ul: ({node, ...props}) => <ul {...props} />,
                                                                ol: ({node, ...props}) => <ol {...props} />,
                                                                li: ({node, ...props}) => <li {...props} />,
                                                                strong: ({node, ...props}) => <strong {...props} />,
                                                                code: ({node, inline, ...props}) => inline 
                                                                    ? <code {...props} />
                                                                    : null
                                                            }}
                                                        >
                                                            {section.content.join('\n')}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}

                                                {/* Подсекции (H3) */}
                                                {section.subsections.map((subsection) => {
                                                    const isSubExpanded = expandedSections[subsection.id];
                                                    
                                                    return (
                                                        <div key={subsection.id} className="rules-subsection" id={`section-${subsection.id}`}>
                                                            {/* H3 Header */}
                                                            <button
                                                                onClick={() => toggleSection(subsection.id)}
                                                                className="rules-subsection-header"
                                                            >
                                                                <span>{subsection.title}</span>
                                                                <span className="rules-section-toggle-icon" dangerouslySetInnerHTML={{
                                                                    __html: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l3 4 3-4"/></svg>'
                                                                }} />
                                                            </button>

                                                            {/* H3 Content */}
                                                            {isSubExpanded && (
                                                                <div className="rules-subsection-content">
                                                                    {/* Контент H3 (если есть) */}
                                                                    {subsection.content.length > 0 && subsection.content.some(line => line.trim()) && (
                                                                        <div className="rules-subsection-text">
                                                                            <ReactMarkdown
                                                                                components={{
                                                                                    p: ({node, ...props}) => <p {...props} />,
                                                                                    ul: ({node, ...props}) => <ul {...props} />,
                                                                                    ol: ({node, ...props}) => <ol {...props} />,
                                                                                    li: ({node, ...props}) => <li {...props} />,
                                                                                    strong: ({node, ...props}) => <strong {...props} />,
                                                                                    code: ({node, inline, ...props}) => inline 
                                                                                        ? <code {...props} />
                                                                                        : null
                                                                                }}
                                                                            >
                                                                                {subsection.content.join('\n')}
                                                                            </ReactMarkdown>
                                                                        </div>
                                                                    )}

                                                                    {/* Подсекции H4 (для проектов) */}
                                                                    {subsection.subsections && subsection.subsections.length > 0 && subsection.subsections.map((h4section) => {
                                                                        const isH4Expanded = expandedSections[h4section.id];
                                                                        
                                                                        return (
                                                                            <div key={h4section.id} className="rules-h4-section" id={`section-${h4section.id}`}>
                                                                                {/* H4 Header */}
                                                                                <button
                                                                                    onClick={() => toggleSection(h4section.id)}
                                                                                    className="rules-h4-section-header"
                                                                                >
                                                                                    <span>{h4section.title}</span>
                                                                                    <span className="rules-section-toggle-icon" dangerouslySetInnerHTML={{
                                                                                        __html: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3l3 4 3-4"/></svg>'
                                                                                    }} />
                                                                                </button>

                                                                                {/* H4 Content */}
                                                                                {isH4Expanded && (
                                                                                    <div className="rules-h4-section-content">
                                                                                        <ReactMarkdown
                                                                                            components={{
                                                                                                p: ({node, ...props}) => <p {...props} />,
                                                                                                ul: ({node, ...props}) => <ul {...props} />,
                                                                                                ol: ({node, ...props}) => <ol {...props} />,
                                                                                                li: ({node, ...props}) => <li {...props} />,
                                                                                                strong: ({node, ...props}) => <strong {...props} />,
                                                                                                code: ({node, inline, ...props}) => inline 
                                                                                                    ? <code {...props} />
                                                                                                    : null
                                                                                            }}
                                                                                        >
                                                                                            {h4section.content.join('\n')}
                                                                                        </ReactMarkdown>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="rules-modal-footer">
                    <button
                        onClick={onClose}
                        className="rules-modal-footer-btn"
                    >
                        Закрыть
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RulesModal;
